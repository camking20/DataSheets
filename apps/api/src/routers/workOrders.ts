/**
 * Phase 2 MES — work order / operator execution API.
 *
 * Wired in root.ts as: workOrders: workOrdersRouter
 */
import { z } from "zod";
import {
  eq,
  and,
  asc,
  desc,
  count,
  inArray,
  isNull,
  ne,
} from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  workOrders,
  workOrderOperations,
  operationExecutions,
  workOrderOperationDocuments,
  routingOperations,
  routingRevisions,
  routings,
  parts,
  partRevisions,
  documents,
  documentRevisions,
  nonconformances,
  dataSheets,
  auditLogs,
} from "@datasheets/db";
import {
  WorkOrderStatusSchema,
  assertWorkOrderTransition,
  assertCanStartOperation,
  assertCanRecordExecution,
  availableQtyForOperation,
  isOperationQtyComplete,
  allOperationsComplete,
  type WorkOrderStatus,
  type OpProgress,
  type PriorOpYield,
} from "@datasheets/core";
import { router, tenantProcedure, requireRoles, asTenant } from "../trpc.js";
import { nextNumber } from "../services/numbering.js";

const WO_ENTITY_TYPE = "work_order";

const CreateWorkOrderSchema = z.object({
  partId: z.string().uuid(),
  qty: z.number().int().min(1).max(100_000),
  lotNumber: z.string().max(200).optional(),
  routingRevisionId: z.string().uuid().optional(),
});

function toBadRequest(err: unknown): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: err instanceof Error ? err.message : "Invalid request",
  });
}

function assertTransition(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
): void {
  try {
    assertWorkOrderTransition(from, to);
  } catch (err) {
    toBadRequest(err);
  }
}

type Tx = Parameters<Parameters<typeof asTenant>[2]>[0];

async function loadWoOrThrow(tx: Tx, id: string) {
  const [wo] = await tx
    .select()
    .from(workOrders)
    .where(eq(workOrders.id, id))
    .limit(1);
  if (!wo) throw new TRPCError({ code: "NOT_FOUND" });
  return wo;
}

async function loadOpProgress(tx: Tx, workOrderId: string): Promise<OpProgress[]> {
  const rows = await tx
    .select({
      opNumber: routingOperations.opNumber,
      startedAt: workOrderOperations.startedAt,
      completedAt: workOrderOperations.completedAt,
    })
    .from(workOrderOperations)
    .innerJoin(
      routingOperations,
      and(
        eq(routingOperations.companyId, workOrderOperations.companyId),
        eq(routingOperations.id, workOrderOperations.routingOperationId),
      ),
    )
    .where(eq(workOrderOperations.workOrderId, workOrderId))
    .orderBy(asc(routingOperations.opNumber));

  return rows.map((r) => ({
    opNumber: r.opNumber,
    started: r.startedAt != null,
    completed: r.completedAt != null,
  }));
}

async function auditWo(
  tx: Tx,
  companyId: string,
  actorId: string,
  action: string,
  entityId: string,
  metadata?: Record<string, unknown>,
) {
  await tx.insert(auditLogs).values({
    companyId,
    actorId,
    action,
    entityType: WO_ENTITY_TYPE,
    entityId,
    metadata: metadata ?? {},
  });
}

async function transitionWo(
  tx: Tx,
  wo: typeof workOrders.$inferSelect,
  to: WorkOrderStatus,
  actorId: string,
  companyId: string,
  extra?: Partial<typeof workOrders.$inferInsert>,
) {
  assertTransition(wo.status as WorkOrderStatus, to);
  const [updated] = await tx
    .update(workOrders)
    .set({
      status: to,
      updatedAt: new Date(),
      ...extra,
    })
    .where(
      and(eq(workOrders.id, wo.id), eq(workOrders.status, wo.status)),
    )
    .returning();
  if (!updated) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Work order status changed concurrently (expected ${wo.status})`,
    });
  }

  await auditWo(tx, companyId, actorId, `work_order.${to}`, wo.id, {
    from: wo.status,
    to,
  });

  return updated;
}

async function freezeReleasedDoc(
  tx: Tx,
  args: {
    companyId: string;
    workOrderOperationId: string;
    documentId: string;
    role: "wi" | "drawing" | "procedure";
  },
) {
  const [doc] = await tx
    .select()
    .from(documents)
    .where(eq(documents.id, args.documentId))
    .limit(1);
  if (!doc) return null;

  const [rev] = await tx
    .select()
    .from(documentRevisions)
    .where(
      and(
        eq(documentRevisions.documentId, args.documentId),
        eq(documentRevisions.status, "released"),
      ),
    )
    .limit(1);
  if (!rev) return null;

  const snapshot = {
    docNumber: doc.docNumber,
    title: doc.title,
    rev: rev.rev,
  };

  const [row] = await tx
    .insert(workOrderOperationDocuments)
    .values({
      companyId: args.companyId,
      workOrderOperationId: args.workOrderOperationId,
      documentId: doc.id,
      documentRevisionId: rev.id,
      role: args.role,
      snapshot,
    })
    .onConflictDoNothing()
    .returning();

  if (row) return row;

  // Already frozen for this op/doc/role — treat as success.
  const [existing] = await tx
    .select()
    .from(workOrderOperationDocuments)
    .where(
      and(
        eq(
          workOrderOperationDocuments.workOrderOperationId,
          args.workOrderOperationId,
        ),
        eq(workOrderOperationDocuments.documentId, doc.id),
        eq(workOrderOperationDocuments.role, args.role),
      ),
    )
    .limit(1);

  return existing ?? null;
}

/** Fail-closed: ops that require a data sheet must have at least one linked sheet. */
async function assertDataSheetIfRequired(
  tx: Tx,
  args: {
    workOrderOperationId: string;
    requiresDataSheet: boolean;
  },
) {
  if (!args.requiresDataSheet) return;

  // Prefer a completed sheet; any linked sheet satisfies the gate.
  const [completed] = await tx
    .select({ id: dataSheets.id })
    .from(dataSheets)
    .where(
      and(
        eq(dataSheets.workOrderOperationId, args.workOrderOperationId),
        eq(dataSheets.status, "completed"),
      ),
    )
    .limit(1);

  if (completed) return;

  const [anySheet] = await tx
    .select({ id: dataSheets.id })
    .from(dataSheets)
    .where(eq(dataSheets.workOrderOperationId, args.workOrderOperationId))
    .limit(1);

  if (!anySheet) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Cannot complete operation: routing requires a data sheet but none is linked",
    });
  }
}

export const workOrdersRouter = router({
  list: tenantProcedure
    .input(
      z
        .object({
          status: WorkOrderStatusSchema.optional(),
          partId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const conditions = [];
        if (input?.status) conditions.push(eq(workOrders.status, input.status));
        if (input?.partId) conditions.push(eq(workOrders.partId, input.partId));

        return tx
          .select({
            id: workOrders.id,
            woNumber: workOrders.woNumber,
            status: workOrders.status,
            partId: workOrders.partId,
            partNumber: parts.partNumber,
            qty: workOrders.qty,
            lotNumber: workOrders.lotNumber,
            routingRevisionId: workOrders.routingRevisionId,
            releasedAt: workOrders.releasedAt,
            completedAt: workOrders.completedAt,
            createdAt: workOrders.createdAt,
            updatedAt: workOrders.updatedAt,
          })
          .from(workOrders)
          .innerJoin(
            parts,
            and(
              eq(parts.companyId, workOrders.companyId),
              eq(parts.id, workOrders.partId),
            ),
          )
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(workOrders.createdAt));
      });
    }),

  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [row] = await tx
          .select({
            workOrder: workOrders,
            partNumber: parts.partNumber,
            partDescription: parts.description,
          })
          .from(workOrders)
          .innerJoin(
            parts,
            and(
              eq(parts.companyId, workOrders.companyId),
              eq(parts.id, workOrders.partId),
            ),
          )
          .where(eq(workOrders.id, input.id))
          .limit(1);

        if (!row) throw new TRPCError({ code: "NOT_FOUND" });

        const ops = await tx
          .select({
            operation: workOrderOperations,
            opNumber: routingOperations.opNumber,
            name: routingOperations.name,
            workCenter: routingOperations.workCenter,
            requiresDataSheet: routingOperations.requiresDataSheet,
            wiDocumentId: routingOperations.wiDocumentId,
          })
          .from(workOrderOperations)
          .innerJoin(
            routingOperations,
            and(
              eq(routingOperations.companyId, workOrderOperations.companyId),
              eq(routingOperations.id, workOrderOperations.routingOperationId),
            ),
          )
          .where(eq(workOrderOperations.workOrderId, input.id))
          .orderBy(asc(routingOperations.opNumber));

        const opIds = ops.map((o) => o.operation.id);

        const executions =
          opIds.length === 0
            ? []
            : await tx
                .select()
                .from(operationExecutions)
                .where(inArray(operationExecutions.workOrderOperationId, opIds))
                .orderBy(asc(operationExecutions.performedAt));

        const frozenDocs =
          opIds.length === 0
            ? []
            : await tx
                .select()
                .from(workOrderOperationDocuments)
                .where(
                  inArray(workOrderOperationDocuments.workOrderOperationId, opIds),
                );

        const executionsByOp = new Map<string, typeof executions>();
        for (const ex of executions) {
          const list = executionsByOp.get(ex.workOrderOperationId) ?? [];
          list.push(ex);
          executionsByOp.set(ex.workOrderOperationId, list);
        }

        const docsByOp = new Map<string, typeof frozenDocs>();
        for (const doc of frozenDocs) {
          const list = docsByOp.get(doc.workOrderOperationId) ?? [];
          list.push(doc);
          docsByOp.set(doc.workOrderOperationId, list);
        }

        const [ncRow] = await tx
          .select({ count: count() })
          .from(nonconformances)
          .where(eq(nonconformances.workOrderId, input.id));

        return {
          workOrder: row.workOrder,
          partNumber: row.partNumber,
          partDescription: row.partDescription,
          linkedNcCount: ncRow?.count ?? 0,
          operations: ops.map((o) => ({
            ...o.operation,
            opNumber: o.opNumber,
            name: o.name,
            workCenter: o.workCenter,
            requiresDataSheet: o.requiresDataSheet,
            wiDocumentId: o.wiDocumentId,
            executions: executionsByOp.get(o.operation.id) ?? [],
            documents: docsByOp.get(o.operation.id) ?? [],
          })),
        };
      });
    }),

  create: requireRoles("engineer", "admin")
    .input(CreateWorkOrderSchema)
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [part] = await tx
          .select()
          .from(parts)
          .where(eq(parts.id, input.partId))
          .limit(1);
        if (!part) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Part not found" });
        }

        const [partRev] = await tx
          .select()
          .from(partRevisions)
          .where(
            and(
              eq(partRevisions.partId, input.partId),
              eq(partRevisions.status, "released"),
            ),
          )
          .limit(1);
        if (!partRev) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Part has no released revision",
          });
        }

        let routingRev: typeof routingRevisions.$inferSelect;

        if (input.routingRevisionId) {
          const [rev] = await tx
            .select({
              revision: routingRevisions,
              partId: routings.partId,
            })
            .from(routingRevisions)
            .innerJoin(
              routings,
              and(
                eq(routings.companyId, routingRevisions.companyId),
                eq(routings.id, routingRevisions.routingId),
              ),
            )
            .where(eq(routingRevisions.id, input.routingRevisionId))
            .limit(1);

          if (!rev) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Routing revision not found",
            });
          }
          if (rev.partId !== input.partId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Routing revision does not belong to this part",
            });
          }
          if (rev.revision.status !== "released") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Routing revision must be released",
            });
          }
          routingRev = rev.revision;
        } else {
          const [rev] = await tx
            .select({ revision: routingRevisions })
            .from(routingRevisions)
            .innerJoin(
              routings,
              and(
                eq(routings.companyId, routingRevisions.companyId),
                eq(routings.id, routingRevisions.routingId),
              ),
            )
            .where(
              and(
                eq(routings.partId, input.partId),
                eq(routings.isActive, true),
                eq(routingRevisions.status, "released"),
              ),
            )
            .orderBy(desc(routingRevisions.releasedAt))
            .limit(1);

          if (!rev) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "No released routing found for this part",
            });
          }
          routingRev = rev.revision;
        }

        const routeOps = await tx
          .select()
          .from(routingOperations)
          .where(eq(routingOperations.routingRevisionId, routingRev.id))
          .orderBy(asc(routingOperations.opNumber));

        if (routeOps.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Routing revision has no operations",
          });
        }

        const woNumber = await nextNumber(tx, ctx.companyId, "WO");

        const [wo] = await tx
          .insert(workOrders)
          .values({
            companyId: ctx.companyId,
            woNumber,
            partId: input.partId,
            partRevisionId: partRev.id,
            routingRevisionId: routingRev.id,
            qty: input.qty,
            lotNumber: input.lotNumber ?? null,
            status: "planned",
            createdBy: ctx.auth.user.id,
          })
          .returning();

        await tx.insert(workOrderOperations).values(
          routeOps.map((op) => ({
            companyId: ctx.companyId,
            workOrderId: wo!.id,
            routingOperationId: op.id,
          })),
        );

        await auditWo(
          tx,
          ctx.companyId,
          ctx.auth.user.id,
          "work_order.create",
          wo!.id,
          {
            woNumber,
            partId: input.partId,
            qty: input.qty,
            routingRevisionId: routingRev.id,
          },
        );

        return wo!;
      });
    }),

  release: requireRoles("engineer", "admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const wo = await loadWoOrThrow(tx, input.id);
        return transitionWo(tx, wo, "released", ctx.auth.user.id, ctx.companyId, {
          releasedAt: new Date(),
          releasedBy: ctx.auth.user.id,
        });
      });
    }),

  startOperation: requireRoles("operator", "engineer", "admin")
    .input(z.object({ workOrderOperationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [opRow] = await tx
          .select({
            operation: workOrderOperations,
            opNumber: routingOperations.opNumber,
            wiDocumentId: routingOperations.wiDocumentId,
            workOrder: workOrders,
          })
          .from(workOrderOperations)
          .innerJoin(
            routingOperations,
            and(
              eq(routingOperations.companyId, workOrderOperations.companyId),
              eq(routingOperations.id, workOrderOperations.routingOperationId),
            ),
          )
          .innerJoin(
            workOrders,
            and(
              eq(workOrders.companyId, workOrderOperations.companyId),
              eq(workOrders.id, workOrderOperations.workOrderId),
            ),
          )
          .where(eq(workOrderOperations.id, input.workOrderOperationId))
          .limit(1);

        if (!opRow) throw new TRPCError({ code: "NOT_FOUND" });

        const { operation, opNumber, wiDocumentId, workOrder: wo } = opRow;
        const status = wo.status as WorkOrderStatus;

        if (
          status !== "released" &&
          status !== "in_progress" &&
          status !== "on_hold"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot start operation while work order is ${status}`,
          });
        }

        if (operation.completedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Operation is already completed",
          });
        }

        const progress = await loadOpProgress(tx, wo.id);
        try {
          assertCanStartOperation(progress, opNumber);
        } catch (err) {
          toBadRequest(err);
        }

        const now = new Date();
        let currentWo = wo;

        if (status === "released" || status === "on_hold") {
          currentWo = await transitionWo(
            tx,
            wo,
            "in_progress",
            ctx.auth.user.id,
            ctx.companyId,
          );
        }

        const [updatedOp] = await tx
          .update(workOrderOperations)
          .set({
            startedAt: operation.startedAt ?? now,
            startedBy: operation.startedBy ?? ctx.auth.user.id,
            updatedAt: now,
          })
          .where(eq(workOrderOperations.id, operation.id))
          .returning();

        const frozen: Array<typeof workOrderOperationDocuments.$inferSelect> =
          [];

        if (wiDocumentId) {
          const wi = await freezeReleasedDoc(tx, {
            companyId: ctx.companyId,
            workOrderOperationId: operation.id,
            documentId: wiDocumentId,
            role: "wi",
          });
          if (!wi) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Cannot start operation: work instruction has no released revision to freeze",
            });
          }
          frozen.push(wi);
        }

        const [drawing] = await tx
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.partId, currentWo.partId),
              eq(documents.docType, "drw"),
              eq(documents.isActive, true),
            ),
          )
          .orderBy(asc(documents.docNumber))
          .limit(1);

        // Drawing freeze is optional — skip silently if no released rev.
        if (drawing) {
          const drw = await freezeReleasedDoc(tx, {
            companyId: ctx.companyId,
            workOrderOperationId: operation.id,
            documentId: drawing.id,
            role: "drawing",
          });
          if (drw) frozen.push(drw);
        }

        await auditWo(
          tx,
          ctx.companyId,
          ctx.auth.user.id,
          "work_order.start_operation",
          wo.id,
          {
            workOrderOperationId: operation.id,
            opNumber,
            frozenDocumentIds: frozen.map((d) => d.id),
          },
        );

        return {
          workOrder: currentWo,
          operation: updatedOp!,
          documents: frozen,
        };
      });
    }),

  recordExecution: requireRoles("operator", "engineer", "admin")
    .input(
      z
        .object({
          workOrderOperationId: z.string().uuid(),
          qtyGood: z.number().int(),
          qtyScrap: z.number().int(),
          note: z.string().max(5000).optional(),
          reason: z.string().max(5000).optional(),
        })
        .superRefine((val, ctx) => {
          if ((val.qtyGood < 0 || val.qtyScrap < 0) && !val.reason?.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "reason is required when recording a negative adjustment",
              path: ["reason"],
            });
          }
        }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        // Lock the WO operation row so concurrent executions serialize on qty.
        const [lockedOp] = await tx
          .select()
          .from(workOrderOperations)
          .where(eq(workOrderOperations.id, input.workOrderOperationId))
          .for("update")
          .limit(1);

        if (!lockedOp) throw new TRPCError({ code: "NOT_FOUND" });

        const [opRow] = await tx
          .select({
            opNumber: routingOperations.opNumber,
            requiresDataSheet: routingOperations.requiresDataSheet,
            workOrder: workOrders,
          })
          .from(workOrderOperations)
          .innerJoin(
            workOrders,
            and(
              eq(workOrders.companyId, workOrderOperations.companyId),
              eq(workOrders.id, workOrderOperations.workOrderId),
            ),
          )
          .innerJoin(
            routingOperations,
            and(
              eq(routingOperations.companyId, workOrderOperations.companyId),
              eq(routingOperations.id, workOrderOperations.routingOperationId),
            ),
          )
          .where(eq(workOrderOperations.id, input.workOrderOperationId))
          .limit(1);

        if (!opRow) throw new TRPCError({ code: "NOT_FOUND" });

        const { workOrder: wo, opNumber, requiresDataSheet } = opRow;
        const operation = lockedOp;

        if (wo.status !== "in_progress") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot record execution while work order is ${wo.status}`,
          });
        }
        if (!operation.startedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Operation has not been started",
          });
        }
        if (operation.completedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Operation is already completed",
          });
        }

        // Prior ops (lower op_number) for yield-chained available qty.
        const priorRows = await tx
          .select({
            qtyComplete: workOrderOperations.qtyComplete,
            qtyScrap: workOrderOperations.qtyScrap,
            completedAt: workOrderOperations.completedAt,
            opNumber: routingOperations.opNumber,
          })
          .from(workOrderOperations)
          .innerJoin(
            routingOperations,
            and(
              eq(routingOperations.companyId, workOrderOperations.companyId),
              eq(routingOperations.id, workOrderOperations.routingOperationId),
            ),
          )
          .where(eq(workOrderOperations.workOrderId, wo.id))
          .orderBy(asc(routingOperations.opNumber));

        const priorOps: PriorOpYield[] = priorRows
          .filter((r) => r.opNumber < opNumber)
          .map((r) => ({
            qtyComplete: r.qtyComplete,
            qtyScrap: r.qtyScrap,
            completed: r.completedAt != null,
          }));

        const availableQty = availableQtyForOperation(wo.qty, priorOps);

        const qtyState = {
          woQty: wo.qty,
          availableQty,
          qtyComplete: operation.qtyComplete,
          qtyScrap: operation.qtyScrap,
        };

        try {
          assertCanRecordExecution(qtyState, input.qtyGood, input.qtyScrap);
        } catch (err) {
          toBadRequest(err);
        }

        const nextGood = operation.qtyComplete + input.qtyGood;
        const nextScrap = operation.qtyScrap + input.qtyScrap;
        const now = new Date();

        const [execution] = await tx
          .insert(operationExecutions)
          .values({
            companyId: ctx.companyId,
            workOrderOperationId: operation.id,
            qtyGood: input.qtyGood,
            qtyScrap: input.qtyScrap,
            performedBy: ctx.auth.user.id,
            performedAt: now,
            note: input.note ?? null,
            reason: input.reason ?? null,
          })
          .returning();

        const opComplete = isOperationQtyComplete(qtyState, nextGood, nextScrap);

        if (opComplete) {
          await assertDataSheetIfRequired(tx, {
            workOrderOperationId: operation.id,
            requiresDataSheet,
          });
        }

        // Conditional update based on locked-row qty values (optimistic CAS).
        const [updatedOp] = await tx
          .update(workOrderOperations)
          .set({
            qtyComplete: nextGood,
            qtyScrap: nextScrap,
            ...(opComplete
              ? {
                  completedAt: now,
                  completedBy: ctx.auth.user.id,
                }
              : {}),
            updatedAt: now,
          })
          .where(
            and(
              eq(workOrderOperations.id, operation.id),
              eq(workOrderOperations.qtyComplete, operation.qtyComplete),
              eq(workOrderOperations.qtyScrap, operation.qtyScrap),
            ),
          )
          .returning();

        if (!updatedOp) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Operation qty changed concurrently; retry",
          });
        }

        let currentWo = wo;
        if (opComplete) {
          const progress = await loadOpProgress(tx, wo.id);
          // Reflect this op as completed in progress check
          const nextProgress = progress.map((p) =>
            p.opNumber === opNumber ? { ...p, completed: true } : p,
          );
          if (allOperationsComplete(nextProgress)) {
            currentWo = await transitionWo(
              tx,
              wo,
              "completed",
              ctx.auth.user.id,
              ctx.companyId,
              { completedAt: now },
            );
          }
        }

        await auditWo(
          tx,
          ctx.companyId,
          ctx.auth.user.id,
          "work_order.record_execution",
          wo.id,
          {
            workOrderOperationId: operation.id,
            qtyGood: input.qtyGood,
            qtyScrap: input.qtyScrap,
            opComplete,
            woStatus: currentWo.status,
          },
        );

        return {
          execution: execution!,
          operation: updatedOp,
          workOrder: currentWo,
        };
      });
    }),

  completeOperation: requireRoles("operator", "engineer", "admin")
    .input(z.object({ workOrderOperationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [opRow] = await tx
          .select({
            operation: workOrderOperations,
            workOrder: workOrders,
            opNumber: routingOperations.opNumber,
            requiresDataSheet: routingOperations.requiresDataSheet,
          })
          .from(workOrderOperations)
          .innerJoin(
            workOrders,
            and(
              eq(workOrders.companyId, workOrderOperations.companyId),
              eq(workOrders.id, workOrderOperations.workOrderId),
            ),
          )
          .innerJoin(
            routingOperations,
            and(
              eq(routingOperations.companyId, workOrderOperations.companyId),
              eq(routingOperations.id, workOrderOperations.routingOperationId),
            ),
          )
          .where(eq(workOrderOperations.id, input.workOrderOperationId))
          .limit(1)
          .for("update");

        if (!opRow) throw new TRPCError({ code: "NOT_FOUND" });

        const { operation, workOrder: wo, opNumber, requiresDataSheet } = opRow;

        if (wo.status !== "in_progress") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot complete operation while work order is ${wo.status}`,
          });
        }
        if (operation.completedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Operation is already completed",
          });
        }
        if (!operation.startedAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Operation has not been started",
          });
        }

        await assertDataSheetIfRequired(tx, {
          workOrderOperationId: operation.id,
          requiresDataSheet,
        });

        const priorRows = await tx
          .select({
            qtyComplete: workOrderOperations.qtyComplete,
            qtyScrap: workOrderOperations.qtyScrap,
            completedAt: workOrderOperations.completedAt,
            opNumber: routingOperations.opNumber,
          })
          .from(workOrderOperations)
          .innerJoin(
            routingOperations,
            and(
              eq(routingOperations.companyId, workOrderOperations.companyId),
              eq(routingOperations.id, workOrderOperations.routingOperationId),
            ),
          )
          .where(eq(workOrderOperations.workOrderId, wo.id))
          .orderBy(asc(routingOperations.opNumber));

        const priorOps: PriorOpYield[] = priorRows
          .filter((r) => r.opNumber < opNumber)
          .map((r) => ({
            qtyComplete: r.qtyComplete,
            qtyScrap: r.qtyScrap,
            completed: r.completedAt != null,
          }));

        const availableQty = availableQtyForOperation(wo.qty, priorOps);

        const qtyState = {
          woQty: wo.qty,
          availableQty,
          qtyComplete: operation.qtyComplete,
          qtyScrap: operation.qtyScrap,
        };

        if (
          !isOperationQtyComplete(
            qtyState,
            operation.qtyComplete,
            operation.qtyScrap,
          )
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot complete operation: qty complete (${operation.qtyComplete}) + scrap (${operation.qtyScrap}) has not reached available qty (${availableQty})`,
          });
        }

        const now = new Date();
        const [updatedOp] = await tx
          .update(workOrderOperations)
          .set({
            completedAt: now,
            completedBy: ctx.auth.user.id,
            updatedAt: now,
          })
          .where(eq(workOrderOperations.id, operation.id))
          .returning();

        let currentWo = wo;
        const progress = await loadOpProgress(tx, wo.id);
        const nextProgress = progress.map((p) =>
          p.opNumber === opNumber ? { ...p, completed: true } : p,
        );
        if (
          wo.status === "in_progress" &&
          allOperationsComplete(nextProgress)
        ) {
          currentWo = await transitionWo(
            tx,
            wo,
            "completed",
            ctx.auth.user.id,
            ctx.companyId,
            { completedAt: now },
          );
        }

        await auditWo(
          tx,
          ctx.companyId,
          ctx.auth.user.id,
          "work_order.complete_operation",
          wo.id,
          { workOrderOperationId: operation.id, opNumber },
        );

        return { operation: updatedOp!, workOrder: currentWo };
      });
    }),

  hold: requireRoles("operator", "engineer", "admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const wo = await loadWoOrThrow(tx, input.id);
        return transitionWo(tx, wo, "on_hold", ctx.auth.user.id, ctx.companyId);
      });
    }),

  resume: requireRoles("operator", "engineer", "admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const wo = await loadWoOrThrow(tx, input.id);
        return transitionWo(
          tx,
          wo,
          "in_progress",
          ctx.auth.user.id,
          ctx.companyId,
        );
      });
    }),

  cancel: requireRoles("engineer", "admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const wo = await loadWoOrThrow(tx, input.id);
        return transitionWo(
          tx,
          wo,
          "cancelled",
          ctx.auth.user.id,
          ctx.companyId,
        );
      });
    }),

  close: requireRoles("engineer", "admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const wo = await loadWoOrThrow(tx, input.id);

        const [openNc] = await tx
          .select({ id: nonconformances.id })
          .from(nonconformances)
          .where(
            and(
              eq(nonconformances.workOrderId, wo.id),
              ne(nonconformances.status, "closure"),
            ),
          )
          .limit(1);

        if (openNc) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Cannot close work order: open nonconformances must be closed first",
          });
        }

        return transitionWo(tx, wo, "closed", ctx.auth.user.id, ctx.companyId);
      });
    }),

  getCurrentOperation: tenantProcedure
    .input(z.object({ workOrderId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const wo = await loadWoOrThrow(tx, input.workOrderId);

        const [current] = await tx
          .select({
            operation: workOrderOperations,
            opNumber: routingOperations.opNumber,
            name: routingOperations.name,
            workCenter: routingOperations.workCenter,
            requiresDataSheet: routingOperations.requiresDataSheet,
            wiDocumentId: routingOperations.wiDocumentId,
          })
          .from(workOrderOperations)
          .innerJoin(
            routingOperations,
            and(
              eq(routingOperations.companyId, workOrderOperations.companyId),
              eq(routingOperations.id, workOrderOperations.routingOperationId),
            ),
          )
          .where(
            and(
              eq(workOrderOperations.workOrderId, input.workOrderId),
              isNull(workOrderOperations.completedAt),
            ),
          )
          .orderBy(asc(routingOperations.opNumber))
          .limit(1);

        if (!current) {
          return { workOrder: wo, operation: null };
        }

        const docs = await tx
          .select()
          .from(workOrderOperationDocuments)
          .where(
            eq(
              workOrderOperationDocuments.workOrderOperationId,
              current.operation.id,
            ),
          );

        return {
          workOrder: wo,
          operation: {
            ...current.operation,
            opNumber: current.opNumber,
            name: current.name,
            workCenter: current.workCenter,
            requiresDataSheet: current.requiresDataSheet,
            wiDocumentId: current.wiDocumentId,
            documents: docs,
          },
        };
      });
    }),
});
