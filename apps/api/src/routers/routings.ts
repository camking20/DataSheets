/**
 * MES routings tRPC router.
 *
 * Wire into root.ts as:
 *   import { routingsRouter } from "./routers/routings.js";
 *   routings: routingsRouter,
 *
 * Routing revisions use revision_status: draft | released | superseded only.
 * Drafts are edited, attached to a CO while still draft; CO approval releases them.
 */
import { z } from "zod";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  routings,
  routingRevisions,
  routingOperations,
  documents,
  documentRevisions,
  parts,
  auditLogs,
  type DbTx,
  type RoutingRevision,
  type RoutingOperation,
} from "@datasheets/db";
import { nextRevLetter, pickCurrentRevision } from "@datasheets/core";
import { router, tenantProcedure, requireRoles, asTenant } from "../trpc.js";
import { nextNumber } from "../services/numbering.js";

type RevisionSummary = Pick<
  RoutingRevision,
  | "id"
  | "rev"
  | "status"
  | "changeSummary"
  | "releasedAt"
  | "createdAt"
  | "updatedAt"
>;

function toRevisionSummary(rev: RoutingRevision): RevisionSummary {
  return {
    id: rev.id,
    rev: rev.rev,
    status: rev.status,
    changeSummary: rev.changeSummary,
    releasedAt: rev.releasedAt,
    createdAt: rev.createdAt,
    updatedAt: rev.updatedAt,
  };
}

async function requireDraftRevision(
  tx: DbTx,
  revisionId: string,
): Promise<RoutingRevision> {
  const [rev] = await tx
    .select()
    .from(routingRevisions)
    .where(eq(routingRevisions.id, revisionId))
    .limit(1);
  if (!rev) throw new TRPCError({ code: "NOT_FOUND" });
  if (rev.status !== "draft") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only draft routing revisions can be edited",
    });
  }
  return rev;
}

async function assertWiDocument(
  tx: DbTx,
  wiDocumentId: string,
): Promise<void> {
  const [doc] = await tx
    .select()
    .from(documents)
    .where(eq(documents.id, wiDocumentId))
    .limit(1);
  if (!doc) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Work instruction document not found",
    });
  }
  if (doc.docType !== "wi") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Document must be type wi (got ${doc.docType})`,
    });
  }
  const [released] = await tx
    .select({ id: documentRevisions.id })
    .from(documentRevisions)
    .where(
      and(
        eq(documentRevisions.documentId, wiDocumentId),
        eq(documentRevisions.status, "released"),
      ),
    )
    .limit(1);
  if (!released) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Work instruction must have a released revision",
    });
  }
}

const OperationFieldsSchema = z.object({
  opNumber: z.number().int().positive(),
  name: z.string().min(1).max(500),
  workCenter: z.string().max(200).nullable().optional(),
  wiDocumentId: z.string().uuid().nullable().optional(),
  requiresDataSheet: z.boolean().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export const routingsRouter = router({
  list: tenantProcedure
    .input(z.object({ partId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const rows = await tx
          .select()
          .from(routings)
          .where(
            input?.partId ? eq(routings.partId, input.partId) : undefined,
          )
          .orderBy(desc(routings.createdAt));

        if (rows.length === 0) return [];

        const routingIds = rows.map((r) => r.id);
        const revs = await tx
          .select()
          .from(routingRevisions)
          .where(inArray(routingRevisions.routingId, routingIds))
          .orderBy(desc(routingRevisions.createdAt));

        const revsByRouting = new Map<string, RoutingRevision[]>();
        for (const rev of revs) {
          const list = revsByRouting.get(rev.routingId) ?? [];
          list.push(rev);
          revsByRouting.set(rev.routingId, list);
        }

        return rows.map((routing) => {
          const current = pickCurrentRevision(
            revsByRouting.get(routing.id) ?? [],
          );
          return {
            routing,
            currentRevision: current ? toRevisionSummary(current) : null,
          };
        });
      });
    }),

  getById: tenantProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        revisionId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [routing] = await tx
          .select()
          .from(routings)
          .where(eq(routings.id, input.id))
          .limit(1);
        if (!routing) throw new TRPCError({ code: "NOT_FOUND" });

        const revisions = await tx
          .select()
          .from(routingRevisions)
          .where(eq(routingRevisions.routingId, routing.id))
          .orderBy(desc(routingRevisions.createdAt));

        let selected: RoutingRevision | null = null;
        if (input.revisionId) {
          selected =
            revisions.find((r) => r.id === input.revisionId) ?? null;
          if (!selected) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Revision not found for this routing",
            });
          }
        } else {
          selected = pickCurrentRevision(revisions);
        }

        let operations: RoutingOperation[] = [];
        if (selected) {
          operations = await tx
            .select()
            .from(routingOperations)
            .where(eq(routingOperations.routingRevisionId, selected.id))
            .orderBy(asc(routingOperations.opNumber));
        }

        return {
          routing,
          revisions,
          selectedRevision: selected,
          operations,
        };
      });
    }),

  create: requireRoles("engineer", "admin")
    .input(
      z.object({
        partId: z.string().uuid(),
        name: z.string().max(500).optional(),
        description: z.string().max(5000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [part] = await tx
          .select()
          .from(parts)
          .where(eq(parts.id, input.partId))
          .limit(1);
        if (!part) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Part not found",
          });
        }

        const name =
          input.name?.trim() ||
          (await nextNumber(tx, ctx.companyId, "RTG"));

        const [routing] = await tx
          .insert(routings)
          .values({
            companyId: ctx.companyId,
            partId: part.id,
            name,
            description: input.description ?? null,
            createdBy: ctx.auth.user.id,
          })
          .returning();

        const [revision] = await tx
          .insert(routingRevisions)
          .values({
            companyId: ctx.companyId,
            routingId: routing!.id,
            rev: "A",
            status: "draft",
            createdBy: ctx.auth.user.id,
          })
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "routing.create",
          entityType: "routing",
          entityId: routing!.id,
          metadata: { name, revisionId: revision!.id, rev: "A" },
        });

        return { routing: routing!, revision: revision! };
      });
    }),

  update: requireRoles("engineer", "admin")
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(500).optional(),
        description: z.string().max(5000).nullable().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [routing] = await tx
          .select()
          .from(routings)
          .where(eq(routings.id, input.id))
          .limit(1);
        if (!routing) throw new TRPCError({ code: "NOT_FOUND" });

        // Header edits only while a draft revision exists (editable state).
        const [draft] = await tx
          .select()
          .from(routingRevisions)
          .where(
            and(
              eq(routingRevisions.routingId, routing.id),
              eq(routingRevisions.status, "draft"),
            ),
          )
          .limit(1);
        if (!draft) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Routing header can only be updated while a draft revision exists",
          });
        }

        const [updated] = await tx
          .update(routings)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            ...(input.isActive !== undefined
              ? { isActive: input.isActive }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(routings.id, routing.id))
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "routing.update",
          entityType: "routing",
          entityId: routing.id,
        });

        return updated!;
      });
    }),

  addOperation: requireRoles("engineer", "admin")
    .input(
      OperationFieldsSchema.extend({
        routingRevisionId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        await requireDraftRevision(tx, input.routingRevisionId);

        if (input.wiDocumentId) {
          await assertWiDocument(tx, input.wiDocumentId);
        }

        const [op] = await tx
          .insert(routingOperations)
          .values({
            companyId: ctx.companyId,
            routingRevisionId: input.routingRevisionId,
            opNumber: input.opNumber,
            name: input.name,
            workCenter: input.workCenter ?? null,
            wiDocumentId: input.wiDocumentId ?? null,
            requiresDataSheet: input.requiresDataSheet ?? false,
            notes: input.notes ?? null,
          })
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "routing.operation.add",
          entityType: "routing_revision",
          entityId: input.routingRevisionId,
          metadata: { operationId: op!.id, opNumber: input.opNumber },
        });

        return op!;
      });
    }),

  updateOperation: requireRoles("engineer", "admin")
    .input(
      z.object({
        operationId: z.string().uuid(),
        opNumber: z.number().int().positive().optional(),
        name: z.string().min(1).max(500).optional(),
        workCenter: z.string().max(200).nullable().optional(),
        wiDocumentId: z.string().uuid().nullable().optional(),
        requiresDataSheet: z.boolean().optional(),
        notes: z.string().max(5000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [op] = await tx
          .select()
          .from(routingOperations)
          .where(eq(routingOperations.id, input.operationId))
          .limit(1);
        if (!op) throw new TRPCError({ code: "NOT_FOUND" });

        await requireDraftRevision(tx, op.routingRevisionId);

        if (input.wiDocumentId) {
          await assertWiDocument(tx, input.wiDocumentId);
        }

        const [updated] = await tx
          .update(routingOperations)
          .set({
            ...(input.opNumber !== undefined
              ? { opNumber: input.opNumber }
              : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.workCenter !== undefined
              ? { workCenter: input.workCenter }
              : {}),
            ...(input.wiDocumentId !== undefined
              ? { wiDocumentId: input.wiDocumentId }
              : {}),
            ...(input.requiresDataSheet !== undefined
              ? { requiresDataSheet: input.requiresDataSheet }
              : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            updatedAt: new Date(),
          })
          .where(eq(routingOperations.id, op.id))
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "routing.operation.update",
          entityType: "routing_revision",
          entityId: op.routingRevisionId,
          metadata: { operationId: op.id },
        });

        return updated!;
      });
    }),

  removeOperation: requireRoles("engineer", "admin")
    .input(z.object({ operationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [op] = await tx
          .select()
          .from(routingOperations)
          .where(eq(routingOperations.id, input.operationId))
          .limit(1);
        if (!op) throw new TRPCError({ code: "NOT_FOUND" });

        await requireDraftRevision(tx, op.routingRevisionId);

        await tx
          .delete(routingOperations)
          .where(eq(routingOperations.id, op.id));

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "routing.operation.remove",
          entityType: "routing_revision",
          entityId: op.routingRevisionId,
          metadata: { operationId: op.id, opNumber: op.opNumber },
        });

        return { ok: true };
      });
    }),

  reorderOperations: requireRoles("engineer", "admin")
    .input(
      z.object({
        routingRevisionId: z.string().uuid(),
        /** Operation IDs in desired order; opNumber becomes 10, 20, 30… */
        operationIds: z.array(z.string().uuid()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        await requireDraftRevision(tx, input.routingRevisionId);

        const existing = await tx
          .select()
          .from(routingOperations)
          .where(
            eq(routingOperations.routingRevisionId, input.routingRevisionId),
          );

        const byId = new Map(existing.map((o) => [o.id, o]));
        if (input.operationIds.length !== existing.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "operationIds must include every operation on the revision",
          });
        }
        for (const id of input.operationIds) {
          if (!byId.has(id)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Operation ${id} does not belong to this revision`,
            });
          }
        }

        // Two-phase renumber to avoid unique (rev, op_number) collisions.
        for (let i = 0; i < input.operationIds.length; i++) {
          await tx
            .update(routingOperations)
            .set({
              opNumber: -(i + 1),
              updatedAt: new Date(),
            })
            .where(eq(routingOperations.id, input.operationIds[i]!));
        }
        for (let i = 0; i < input.operationIds.length; i++) {
          await tx
            .update(routingOperations)
            .set({
              opNumber: (i + 1) * 10,
              updatedAt: new Date(),
            })
            .where(eq(routingOperations.id, input.operationIds[i]!));
        }

        const operations = await tx
          .select()
          .from(routingOperations)
          .where(
            eq(routingOperations.routingRevisionId, input.routingRevisionId),
          )
          .orderBy(asc(routingOperations.opNumber));

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "routing.operation.reorder",
          entityType: "routing_revision",
          entityId: input.routingRevisionId,
          metadata: { operationIds: input.operationIds },
        });

        return { operations };
      });
    }),

  updateDraft: requireRoles("engineer", "admin")
    .input(
      z.object({
        revisionId: z.string().uuid(),
        changeSummary: z.string().max(5000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const rev = await requireDraftRevision(tx, input.revisionId);

        const [updated] = await tx
          .update(routingRevisions)
          .set({
            ...(input.changeSummary !== undefined
              ? { changeSummary: input.changeSummary }
              : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(routingRevisions.id, rev.id),
              eq(routingRevisions.status, "draft"),
            ),
          )
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Revision is no longer a draft",
          });
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "routing.revision.update_draft",
          entityType: "routing_revision",
          entityId: rev.id,
        });

        return updated;
      });
    }),

  createRevisionFromReleased: requireRoles("engineer", "admin")
    .input(z.object({ routingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [routing] = await tx
          .select()
          .from(routings)
          .where(eq(routings.id, input.routingId))
          .limit(1);
        if (!routing) throw new TRPCError({ code: "NOT_FOUND" });

        const [released] = await tx
          .select()
          .from(routingRevisions)
          .where(
            and(
              eq(routingRevisions.routingId, routing.id),
              eq(routingRevisions.status, "released"),
            ),
          )
          .orderBy(desc(routingRevisions.releasedAt))
          .limit(1);

        if (!released) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No released revision to branch from",
          });
        }

        const existingDraft = await tx
          .select()
          .from(routingRevisions)
          .where(
            and(
              eq(routingRevisions.routingId, routing.id),
              eq(routingRevisions.status, "draft"),
            ),
          )
          .limit(1);
        if (existingDraft.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "A draft revision already exists for this routing",
          });
        }

        const newRevLetter = nextRevLetter(released.rev);

        const [newRev] = await tx
          .insert(routingRevisions)
          .values({
            companyId: ctx.companyId,
            routingId: routing.id,
            rev: newRevLetter,
            status: "draft",
            changeSummary: `Branched from rev ${released.rev}`,
            createdBy: ctx.auth.user.id,
          })
          .returning();

        const sourceOps = await tx
          .select()
          .from(routingOperations)
          .where(eq(routingOperations.routingRevisionId, released.id))
          .orderBy(asc(routingOperations.opNumber));

        for (const op of sourceOps) {
          await tx.insert(routingOperations).values({
            companyId: ctx.companyId,
            routingRevisionId: newRev!.id,
            opNumber: op.opNumber,
            name: op.name,
            workCenter: op.workCenter,
            wiDocumentId: op.wiDocumentId,
            requiresDataSheet: op.requiresDataSheet,
            notes: op.notes,
          });
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "routing.revision.branch",
          entityType: "routing",
          entityId: routing.id,
          metadata: {
            fromRevisionId: released.id,
            revisionId: newRev!.id,
            rev: newRevLetter,
            operationCount: sourceOps.length,
          },
        });

        return newRev!;
      });
    }),

  /** Helper for UI WI picker — released WI documents only. */
  listReleasedWiDocuments: tenantProcedure.query(async ({ ctx }) => {
    return asTenant(ctx.db, ctx.companyId, async (tx) => {
      const rows = await tx
        .select({
          document: documents,
          revision: documentRevisions,
        })
        .from(documents)
        .innerJoin(
          documentRevisions,
          and(
            eq(documentRevisions.documentId, documents.id),
            eq(documentRevisions.status, "released"),
          ),
        )
        .where(eq(documents.docType, "wi"))
        .orderBy(asc(documents.docNumber));

      return rows.map(({ document, revision }) => ({
        id: document.id,
        docNumber: document.docNumber,
        title: document.title,
        releasedRev: revision.rev,
        releasedRevisionId: revision.id,
      }));
    });
  }),
});
