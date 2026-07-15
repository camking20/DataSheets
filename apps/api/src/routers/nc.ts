/**
 * Phase 4 — Nonconformance (NC) router.
 *
 * Wiring (do not apply in this file — leave root.ts / app-shell to the integrator):
 *   // apps/api/src/root.ts
 *   import { ncRouter } from "./routers/nc.js";
 *   export const appRouter = router({ …, nc: ncRouter });
 *
 *   // apps/web nav → /quality/nc
 */
import { z } from "zod";
import { and, count, desc, eq, isNull, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  nonconformances,
  ncEvents,
  capas,
  workOrders,
  workOrderOperations,
  signatures,
  auditLogs,
  type DbTx,
} from "@datasheets/db";
import {
  NcStatusSchema,
  NcDispositionSchema,
  NcTriageDecisionSchema,
  NC_STATUS_ORDER,
  assertNcTransition,
  resolveNcTriage,
  nextNcStatus,
  canCloseNc,
  type NcStatus,
  type NcDisposition,
} from "@datasheets/core";
import { router, tenantProcedure, requireRoles, asTenant } from "../trpc.js";
import { nextNumber } from "../services/numbering.js";
import { applySignature } from "../services/signatures.js";

const NC_ENTITY_TYPE = "nonconformance";

const ContentSha256Schema = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/, "contentSha256 must be a 64-char hex SHA-256");

/** Fields frozen after disposition is signed or status moves past planning. */
const FROZEN_AFTER_DISPOSITION_FIELDS = [
  "dispositionNotes",
  "disposition",
  "rootCause",
  "containmentActions",
  "riskAnalysis",
  "quantityAffected",
] as const;

/** Dispositions that require shop-floor execution before investigation. */
function dispositionNeedsExecution(disposition: NcDisposition): boolean {
  return disposition === "rework" || disposition === "repair";
}

function toNcTransitionError(err: unknown): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: err instanceof Error ? err.message : "Invalid NC transition",
  });
}

function isPastDispositionPlanning(status: NcStatus): boolean {
  const idx = NC_STATUS_ORDER.indexOf(status);
  const planningIdx = NC_STATUS_ORDER.indexOf("disposition_planning");
  return idx > planningIdx;
}

/**
 * Clear WO hold when this NC closes, if the WO is on_hold and no other
 * open NCs remain on that work order.
 */
async function releaseWorkOrderHoldIfClear(
  tx: DbTx,
  workOrderId: string | null,
  closingNcId: string,
): Promise<void> {
  if (!workOrderId) return;

  const [wo] = await tx
    .select()
    .from(workOrders)
    .where(eq(workOrders.id, workOrderId))
    .limit(1)
    .for("update");
  if (!wo || wo.status !== "on_hold") return;

  const [otherOpen] = await tx
    .select({ value: count() })
    .from(nonconformances)
    .where(
      and(
        eq(nonconformances.workOrderId, workOrderId),
        ne(nonconformances.id, closingNcId),
        ne(nonconformances.status, "closure"),
      ),
    );

  if ((otherOpen?.value ?? 0) > 0) return;

  await tx
    .update(workOrders)
    .set({ status: "in_progress", updatedAt: new Date() })
    .where(eq(workOrders.id, wo.id));
}

export const ncRouter = router({
  /**
   * List NCs for the company queue.
   * Optional `status` filters to a phase; `triageQueue` limits to initiation
   * rows with no triage decision yet.
   */
  list: tenantProcedure
    .input(
      z
        .object({
          status: NcStatusSchema.optional(),
          triageQueue: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).default(50).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const conditions = [];
        if (input?.triageQueue) {
          conditions.push(eq(nonconformances.status, "initiation"));
          conditions.push(isNull(nonconformances.triageDecision));
        } else if (input?.status) {
          conditions.push(eq(nonconformances.status, input.status));
        }

        return tx
          .select()
          .from(nonconformances)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(nonconformances.createdAt))
          .limit(input?.limit ?? 50);
      });
    }),

  /** Engineer triage queue: initiation without a triage decision. */
  listTriage: tenantProcedure.query(async ({ ctx }) => {
    return asTenant(ctx.db, ctx.companyId, async (tx) => {
      return tx
        .select()
        .from(nonconformances)
        .where(
          and(
            eq(nonconformances.status, "initiation"),
            isNull(nonconformances.triageDecision),
          ),
        )
        .orderBy(desc(nonconformances.createdAt));
    });
  }),

  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [nc] = await tx
          .select()
          .from(nonconformances)
          .where(eq(nonconformances.id, input.id))
          .limit(1);
        if (!nc) throw new TRPCError({ code: "NOT_FOUND" });

        const events = await tx
          .select()
          .from(ncEvents)
          .where(eq(ncEvents.nonconformanceId, nc.id))
          .orderBy(desc(ncEvents.createdAt));

        const linkedCapas = await tx
          .select()
          .from(capas)
          .where(eq(capas.nonconformanceId, nc.id))
          .orderBy(desc(capas.createdAt));

        const ncSignatures = await tx
          .select()
          .from(signatures)
          .where(
            and(
              eq(signatures.entityType, NC_ENTITY_TYPE),
              eq(signatures.entityId, nc.id),
            ),
          )
          .orderBy(desc(signatures.signedAt));

        return {
          nonconformance: nc,
          events,
          capas: linkedCapas,
          signatures: ncSignatures,
        };
      });
    }),

  /**
   * Create an NC from an inspection / shop-floor flag.
   * Allocates NC-#### at initiation; holds linked WO when present.
   */
  createFromFlag: tenantProcedure
    .input(
      z.object({
        description: z
          .string({ required_error: "Description is required" })
          .min(1, { message: "Description is required" })
          .max(5000),
        title: z.string().max(500).optional(),
        workOrderOperationId: z.string().uuid().optional(),
        workOrderId: z.string().uuid().optional(),
        partId: z.string().uuid().optional(),
        flaggedQty: z.number().int().min(0).max(100000).optional(),
        severity: z.string().max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        let workOrderId = input.workOrderId ?? null;
        let workOrderOperationId = input.workOrderOperationId ?? null;

        if (workOrderOperationId) {
          const [op] = await tx
            .select()
            .from(workOrderOperations)
            .where(eq(workOrderOperations.id, workOrderOperationId))
            .limit(1);
          if (!op) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Work order operation not found",
            });
          }
          workOrderId = workOrderId ?? op.workOrderId;
        }

        if (workOrderId) {
          const [wo] = await tx
            .select()
            .from(workOrders)
            .where(eq(workOrders.id, workOrderId))
            .limit(1)
            .for("update");
          if (!wo) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Work order not found",
            });
          }
          if (wo.status !== "cancelled" && wo.status !== "closed") {
            await tx
              .update(workOrders)
              .set({ status: "on_hold", updatedAt: new Date() })
              .where(eq(workOrders.id, wo.id));
          }
        }

        const ncNumber = await nextNumber(tx, ctx.companyId, "NC");

        const [nc] = await tx
          .insert(nonconformances)
          .values({
            companyId: ctx.companyId,
            ncNumber,
            status: "initiation",
            title: input.title ?? null,
            description: input.description,
            partId: input.partId ?? null,
            workOrderId,
            workOrderOperationId,
            flaggedQty: input.flaggedQty ?? null,
            severity: input.severity ?? null,
            createdBy: ctx.auth.user.id,
          })
          .returning();

        if (!nc) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create nonconformance",
          });
        }

        await tx.insert(ncEvents).values({
          companyId: ctx.companyId,
          nonconformanceId: nc.id,
          eventType: "initiation",
          fromStatus: null,
          toStatus: "initiation",
          actorId: ctx.auth.user.id,
          note: input.title ?? input.description.slice(0, 500),
          metadata: {
            workOrderId,
            workOrderOperationId,
            flaggedQty: input.flaggedQty ?? null,
            severity: input.severity ?? null,
          },
        });

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "nc.create_from_flag",
          entityType: NC_ENTITY_TYPE,
          entityId: nc.id,
          metadata: {
            ncNumber,
            workOrderId,
            workOrderOperationId,
          },
        });

        return nc;
      });
    }),

  /**
   * Engineer triage: acceptable (signed close), nc (containment), or nc_capa
   * (containment + CAPA). Acceptable requires quality|admin + password signature.
   */
  triage: requireRoles("engineer", "admin", "quality")
    .input(
      z
        .object({
          id: z.string().uuid(),
          decision: NcTriageDecisionSchema,
          note: z.string().max(5000).optional(),
          password: z.string().min(1).optional(),
          contentSha256: ContentSha256Schema.optional(),
        })
        .refine(
          (val) =>
            val.decision !== "acceptable" ||
            (typeof val.password === "string" && val.password.length > 0),
          {
            message: "Password is required for acceptable disposition",
            path: ["password"],
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [nc] = await tx
          .select()
          .from(nonconformances)
          .where(eq(nonconformances.id, input.id))
          .limit(1)
          .for("update");
        if (!nc) throw new TRPCError({ code: "NOT_FOUND" });

        if (nc.status !== "initiation") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot triage NC from status ${nc.status}`,
          });
        }
        if (nc.triageDecision != null) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "NC has already been triaged",
          });
        }

        const triage = resolveNcTriage(input.decision);
        try {
          assertNcTransition("initiation", triage.nextStatus, {
            acceptable: triage.isAcceptable,
          });
        } catch (err) {
          toNcTransitionError(err);
        }

        if (triage.isAcceptable) {
          if (ctx.role !== "quality" && ctx.role !== "admin") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "Only quality or admin may accept and close an NC with disposition signature",
            });
          }
        }

        let dispositionSigId: string | null = null;
        if (triage.isAcceptable) {
          const sig = await applySignature(tx, {
            companyId: ctx.companyId,
            userId: ctx.auth.user.id,
            role: ctx.role,
            entityType: NC_ENTITY_TYPE,
            entityId: nc.id,
            meaning: "disposition",
            password: input.password!,
            ...(input.contentSha256 !== undefined
              ? { contentSha256: input.contentSha256.toLowerCase() }
              : {}),
            metadata: {
              decision: triage.decision,
              disposition: "use_as_is",
            },
          });
          dispositionSigId = sig.id;
        }

        const now = new Date();
        let capaId: string | null = null;
        let capaNumber: string | null = null;

        if (triage.capaRequired) {
          capaNumber = await nextNumber(tx, ctx.companyId, "CAPA");
          const [capa] = await tx
            .insert(capas)
            .values({
              companyId: ctx.companyId,
              capaNumber,
              nonconformanceId: nc.id,
              title: nc.title ?? `CAPA for ${nc.ncNumber}`,
              description: nc.description,
              status: "open",
              createdBy: ctx.auth.user.id,
            })
            .returning();
          if (!capa) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to create CAPA",
            });
          }
          capaId = capa.id;
        }

        const [updated] = await tx
          .update(nonconformances)
          .set({
            triageDecision: triage.decision,
            isAcceptable: triage.isAcceptable,
            capaRequired: triage.capaRequired,
            status: triage.nextStatus,
            triagedBy: ctx.auth.user.id,
            triagedAt: now,
            ...(triage.isAcceptable
              ? {
                  disposition: "use_as_is" as const,
                  closedAt: now,
                  closedBy: ctx.auth.user.id,
                }
              : {}),
            updatedAt: now,
          })
          .where(
            and(
              eq(nonconformances.id, nc.id),
              eq(nonconformances.status, "initiation"),
              isNull(nonconformances.triageDecision),
            ),
          )
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "NC triage changed concurrently",
          });
        }

        if (triage.isAcceptable) {
          await releaseWorkOrderHoldIfClear(tx, nc.workOrderId, nc.id);
        }

        await tx.insert(ncEvents).values({
          companyId: ctx.companyId,
          nonconformanceId: nc.id,
          eventType: "triage",
          fromStatus: "initiation",
          toStatus: triage.nextStatus,
          actorId: ctx.auth.user.id,
          note: input.note ?? null,
          signatureId: dispositionSigId,
          metadata: {
            decision: triage.decision,
            capaId,
            capaNumber,
            ...(triage.isAcceptable ? { disposition: "use_as_is" } : {}),
          },
        });

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "nc.triage",
          entityType: NC_ENTITY_TYPE,
          entityId: nc.id,
          metadata: {
            decision: triage.decision,
            nextStatus: triage.nextStatus,
            capaId,
            capaNumber,
            ...(dispositionSigId ? { signatureId: dispositionSigId } : {}),
          },
        });

        return { nonconformance: updated, capaId, capaNumber };
      });
    }),

  /**
   * Advance one linear phase (containment → disposition_planning,
   * disposition_execution → investigation). Disposition and closure require
   * signed procedures; initiation requires triage.
   */
  advancePhase: requireRoles("engineer", "admin", "quality")
    .input(z.object({ id: z.string().uuid(), note: z.string().max(5000).optional() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [nc] = await tx
          .select()
          .from(nonconformances)
          .where(eq(nonconformances.id, input.id))
          .limit(1)
          .for("update");
        if (!nc) throw new TRPCError({ code: "NOT_FOUND" });

        const from = nc.status as NcStatus;
        if (from === "initiation") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Use triage to leave initiation",
          });
        }

        const to = nextNcStatus(from);
        if (!to) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "NC is already at a terminal status",
          });
        }
        if (to === "disposition_execution") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Use setDisposition to enter disposition_execution",
          });
        }
        if (to === "closure") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Use close to enter closure",
          });
        }

        try {
          assertNcTransition(from, to);
        } catch (err) {
          toNcTransitionError(err);
        }

        const now = new Date();
        const [updated] = await tx
          .update(nonconformances)
          .set({ status: to, updatedAt: now })
          .where(
            and(
              eq(nonconformances.id, nc.id),
              eq(nonconformances.status, from),
            ),
          )
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "NC status changed concurrently",
          });
        }

        await tx.insert(ncEvents).values({
          companyId: ctx.companyId,
          nonconformanceId: nc.id,
          eventType: "phase_advance",
          fromStatus: from,
          toStatus: to,
          actorId: ctx.auth.user.id,
          note: input.note ?? null,
        });

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "nc.advance_phase",
          entityType: NC_ENTITY_TYPE,
          entityId: nc.id,
          metadata: { from, to },
        });

        return updated;
      });
    }),

  updateFields: requireRoles("engineer", "admin", "quality")
    .input(
      z.object({
        id: z.string().uuid(),
        containmentActions: z.string().max(10000).nullable().optional(),
        rootCause: z.string().max(10000).nullable().optional(),
        riskAnalysis: z.string().max(10000).nullable().optional(),
        dispositionNotes: z.string().max(10000).nullable().optional(),
        disposition: NcDispositionSchema.nullable().optional(),
        quantityAffected: z.number().int().min(0).max(100000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [nc] = await tx
          .select()
          .from(nonconformances)
          .where(eq(nonconformances.id, input.id))
          .limit(1)
          .for("update");
        if (!nc) throw new TRPCError({ code: "NOT_FOUND" });
        if (nc.status === "closure") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Closed NCs cannot be edited",
          });
        }

        const touchingFrozen = FROZEN_AFTER_DISPOSITION_FIELDS.some(
          (field) => input[field] !== undefined,
        );
        if (touchingFrozen) {
          const [dispositionSig] = await tx
            .select({ id: signatures.id })
            .from(signatures)
            .where(
              and(
                eq(signatures.entityType, NC_ENTITY_TYPE),
                eq(signatures.entityId, nc.id),
                eq(signatures.meaning, "disposition"),
              ),
            )
            .limit(1);

          if (
            dispositionSig != null ||
            isPastDispositionPlanning(nc.status as NcStatus)
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Disposition, quantity, root cause, containment, and risk fields are frozen after disposition",
            });
          }
        }

        const [updated] = await tx
          .update(nonconformances)
          .set({
            ...(input.containmentActions !== undefined
              ? { containmentActions: input.containmentActions }
              : {}),
            ...(input.rootCause !== undefined
              ? { rootCause: input.rootCause }
              : {}),
            ...(input.riskAnalysis !== undefined
              ? { riskAnalysis: input.riskAnalysis }
              : {}),
            ...(input.dispositionNotes !== undefined
              ? { dispositionNotes: input.dispositionNotes }
              : {}),
            ...(input.disposition !== undefined
              ? { disposition: input.disposition }
              : {}),
            ...(input.quantityAffected !== undefined
              ? { quantityAffected: input.quantityAffected }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(nonconformances.id, nc.id))
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update NC",
          });
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "nc.update_fields",
          entityType: NC_ENTITY_TYPE,
          entityId: nc.id,
          metadata: {
            fields: Object.keys(input).filter((k) => k !== "id"),
          },
        });

        return updated;
      });
    }),

  /**
   * Sign disposition and advance:
   * - rework/repair → disposition_execution
   * - use_as_is / scrap / return_to_vendor → investigation (skips execution)
   */
  setDisposition: requireRoles("quality", "admin")
    .input(
      z.object({
        id: z.string().uuid(),
        disposition: NcDispositionSchema,
        dispositionNotes: z.string().max(10000).optional(),
        password: z.string().min(1),
        contentSha256: ContentSha256Schema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [nc] = await tx
          .select()
          .from(nonconformances)
          .where(eq(nonconformances.id, input.id))
          .limit(1)
          .for("update");
        if (!nc) throw new TRPCError({ code: "NOT_FOUND" });

        if (nc.status !== "disposition_planning") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Disposition can only be set from disposition_planning (got ${nc.status})`,
          });
        }

        const needsExecution = dispositionNeedsExecution(input.disposition);
        const toStatus: NcStatus = needsExecution
          ? "disposition_execution"
          : "investigation";

        try {
          assertNcTransition("disposition_planning", "disposition_execution");
          if (!needsExecution) {
            assertNcTransition("disposition_execution", "investigation");
          }
        } catch (err) {
          toNcTransitionError(err);
        }

        const sig = await applySignature(tx, {
          companyId: ctx.companyId,
          userId: ctx.auth.user.id,
          role: ctx.role,
          entityType: NC_ENTITY_TYPE,
          entityId: nc.id,
          meaning: "disposition",
          password: input.password,
          ...(input.contentSha256 !== undefined
            ? { contentSha256: input.contentSha256.toLowerCase() }
            : {}),
          metadata: { disposition: input.disposition },
        });

        const now = new Date();
        const [updated] = await tx
          .update(nonconformances)
          .set({
            disposition: input.disposition,
            ...(input.dispositionNotes !== undefined
              ? { dispositionNotes: input.dispositionNotes }
              : {}),
            status: toStatus,
            updatedAt: now,
          })
          .where(
            and(
              eq(nonconformances.id, nc.id),
              eq(nonconformances.status, "disposition_planning"),
            ),
          )
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "NC status changed concurrently",
          });
        }

        await tx.insert(ncEvents).values({
          companyId: ctx.companyId,
          nonconformanceId: nc.id,
          eventType: "disposition",
          fromStatus: "disposition_planning",
          toStatus,
          actorId: ctx.auth.user.id,
          note: input.dispositionNotes ?? null,
          signatureId: sig.id,
          metadata: {
            disposition: input.disposition,
            skippedExecution: !needsExecution,
          },
        });

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "nc.set_disposition",
          entityType: NC_ENTITY_TYPE,
          entityId: nc.id,
          metadata: {
            disposition: input.disposition,
            toStatus,
            signatureId: sig.id,
          },
        });

        return { nonconformance: updated, signature: sig };
      });
    }),

  /** Sign closure and move investigation → closure. */
  close: requireRoles("quality", "admin")
    .input(
      z.object({
        id: z.string().uuid(),
        password: z.string().min(1),
        contentSha256: ContentSha256Schema.optional(),
        note: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [nc] = await tx
          .select()
          .from(nonconformances)
          .where(eq(nonconformances.id, input.id))
          .limit(1)
          .for("update");
        if (!nc) throw new TRPCError({ code: "NOT_FOUND" });

        const [openCapaRow] = await tx
          .select({ value: count() })
          .from(capas)
          .where(
            and(
              eq(capas.nonconformanceId, nc.id),
              ne(capas.status, "closed"),
            ),
          );
        const openCapaCount = openCapaRow?.value ?? 0;

        const gate = canCloseNc({
          status: nc.status,
          capaRequired: nc.capaRequired,
          rootCause: nc.rootCause,
          containmentActions: nc.containmentActions,
          openCapaCount,
        });
        if (!gate.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: gate.reason ?? "NC cannot be closed",
          });
        }

        try {
          assertNcTransition("investigation", "closure");
        } catch (err) {
          toNcTransitionError(err);
        }

        const sig = await applySignature(tx, {
          companyId: ctx.companyId,
          userId: ctx.auth.user.id,
          role: ctx.role,
          entityType: NC_ENTITY_TYPE,
          entityId: nc.id,
          meaning: "closure",
          password: input.password,
          ...(input.contentSha256 !== undefined
            ? { contentSha256: input.contentSha256.toLowerCase() }
            : {}),
        });

        const now = new Date();
        const [updated] = await tx
          .update(nonconformances)
          .set({
            status: "closure",
            closedAt: now,
            closedBy: ctx.auth.user.id,
            updatedAt: now,
          })
          .where(
            and(
              eq(nonconformances.id, nc.id),
              eq(nonconformances.status, "investigation"),
            ),
          )
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "NC status changed concurrently",
          });
        }

        await releaseWorkOrderHoldIfClear(tx, nc.workOrderId, nc.id);

        await tx.insert(ncEvents).values({
          companyId: ctx.companyId,
          nonconformanceId: nc.id,
          eventType: "closure",
          fromStatus: "investigation",
          toStatus: "closure",
          actorId: ctx.auth.user.id,
          note: input.note ?? null,
          signatureId: sig.id,
        });

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "nc.close",
          entityType: NC_ENTITY_TYPE,
          entityId: nc.id,
          metadata: { signatureId: sig.id },
        });

        return { nonconformance: updated, signature: sig };
      });
    }),
});
