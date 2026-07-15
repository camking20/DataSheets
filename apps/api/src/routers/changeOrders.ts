import { z } from "zod";
import { eq, and, desc, inArray, or } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  changeOrders,
  changeOrderItems,
  documentRevisions,
  documents,
  routingRevisions,
  routings,
  signatures,
  auditLogs,
} from "@datasheets/db";
import {
  ChangeOrderStatusSchema,
  canTransitionChangeOrder,
  canTransitionDocumentRevision,
  assertChangeOrderTransition,
} from "@datasheets/core";
import { router, tenantProcedure, requireRoles, asTenant } from "../trpc.js";
import { nextNumber } from "../services/numbering.js";
import { implementChangeOrder } from "../services/release.js";

const CO_ENTITY_TYPE = "change_order";

const CreateChangeOrderSchema = z.object({
  title: z.string().max(500).optional(),
  description: z
    .string({ required_error: "Description is required" })
    .min(1, { message: "Description is required" })
    .max(5000),
  reason: z
    .string({ required_error: "Reason is required" })
    .min(1, { message: "Reason is required" })
    .max(5000),
});

const UpdateDraftSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(500).nullable().optional(),
  description: z.string().min(1).max(5000).optional(),
  reason: z.string().min(1).max(5000).optional(),
});

export const changeOrdersRouter = router({
  list: tenantProcedure
    .input(z.object({ status: ChangeOrderStatusSchema.optional() }).optional())
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        return tx
          .select()
          .from(changeOrders)
          .where(
            input?.status ? eq(changeOrders.status, input.status) : undefined,
          )
          .orderBy(desc(changeOrders.createdAt));
      });
    }),

  /**
   * Draft / in-review document revisions and draft routing revisions available
   * to put on a change order. Prefer this over documents.list / routings.list
   * (those surface the "current" released rev when one exists).
   */
  listReleaseCandidates: tenantProcedure.query(async ({ ctx }) => {
    return asTenant(ctx.db, ctx.companyId, async (tx) => {
      const docCandidates = await tx
        .select({
          revisionId: documentRevisions.id,
          rev: documentRevisions.rev,
          status: documentRevisions.status,
          changeSummary: documentRevisions.changeSummary,
          documentId: documents.id,
          docNumber: documents.docNumber,
          title: documents.title,
          docType: documents.docType,
        })
        .from(documentRevisions)
        .innerJoin(
          documents,
          and(
            eq(documents.id, documentRevisions.documentId),
            eq(documents.companyId, documentRevisions.companyId),
          ),
        )
        .where(
          and(
            eq(documents.isActive, true),
            or(
              eq(documentRevisions.status, "draft"),
              eq(documentRevisions.status, "in_review"),
            ),
          ),
        )
        .orderBy(desc(documentRevisions.updatedAt));

      const routingCandidates = await tx
        .select({
          revisionId: routingRevisions.id,
          rev: routingRevisions.rev,
          status: routingRevisions.status,
          changeSummary: routingRevisions.changeSummary,
          routingId: routings.id,
          name: routings.name,
          partId: routings.partId,
        })
        .from(routingRevisions)
        .innerJoin(
          routings,
          and(
            eq(routings.id, routingRevisions.routingId),
            eq(routings.companyId, routingRevisions.companyId),
          ),
        )
        .where(eq(routingRevisions.status, "draft"))
        .orderBy(desc(routingRevisions.updatedAt));

      return {
        documents: docCandidates,
        routings: routingCandidates,
      };
    });
  }),

  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [co] = await tx
          .select()
          .from(changeOrders)
          .where(eq(changeOrders.id, input.id))
          .limit(1);
        if (!co) throw new TRPCError({ code: "NOT_FOUND" });

        const items = await tx
          .select()
          .from(changeOrderItems)
          .where(eq(changeOrderItems.changeOrderId, co.id));

        const docRevisionIds = items
          .map((i) => i.documentRevisionId)
          .filter((id): id is string => id != null);
        const routingRevisionIds = items
          .map((i) => i.routingRevisionId)
          .filter((id): id is string => id != null);

        const revisions =
          docRevisionIds.length === 0
            ? []
            : await tx
                .select()
                .from(documentRevisions)
                .where(inArray(documentRevisions.id, docRevisionIds));

        const routingRevs =
          routingRevisionIds.length === 0
            ? []
            : await tx
                .select()
                .from(routingRevisions)
                .where(inArray(routingRevisions.id, routingRevisionIds));

        const revisionById = new Map(revisions.map((r) => [r.id, r]));
        const routingRevisionById = new Map(
          routingRevs.map((r) => [r.id, r]),
        );
        const itemsWithRevisions = items.map((item) => ({
          item,
          revision: item.documentRevisionId
            ? (revisionById.get(item.documentRevisionId) ?? null)
            : null,
          routingRevision: item.routingRevisionId
            ? (routingRevisionById.get(item.routingRevisionId) ?? null)
            : null,
        }));

        const coSignatures = await tx
          .select()
          .from(signatures)
          .where(
            and(
              eq(signatures.entityType, CO_ENTITY_TYPE),
              eq(signatures.entityId, co.id),
            ),
          )
          .orderBy(desc(signatures.signedAt));

        return {
          changeOrder: co,
          items: itemsWithRevisions,
          signatures: coSignatures,
        };
      });
    }),

  create: requireRoles("engineer", "admin")
    .input(CreateChangeOrderSchema)
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const coNumber = await nextNumber(tx, ctx.companyId, "CO");

        const [co] = await tx
          .insert(changeOrders)
          .values({
            companyId: ctx.companyId,
            coNumber,
            title: input.title ?? null,
            description: input.description,
            reason: input.reason,
            status: "draft",
            createdBy: ctx.auth.user.id,
          })
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "change_order.create",
          entityType: CO_ENTITY_TYPE,
          entityId: co!.id,
          metadata: { coNumber },
        });

        return co!;
      });
    }),

  updateDraft: requireRoles("engineer", "admin")
    .input(UpdateDraftSchema)
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [co] = await tx
          .select()
          .from(changeOrders)
          .where(eq(changeOrders.id, input.id))
          .limit(1);
        if (!co) throw new TRPCError({ code: "NOT_FOUND" });
        if (co.status !== "draft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only draft change orders can be edited",
          });
        }

        const [updated] = await tx
          .update(changeOrders)
          .set({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            ...(input.reason !== undefined ? { reason: input.reason } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(eq(changeOrders.id, co.id), eq(changeOrders.status, "draft")),
          )
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Change order is no longer a draft",
          });
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "change_order.update_draft",
          entityType: CO_ENTITY_TYPE,
          entityId: co.id,
        });

        return updated;
      });
    }),

  addItem: requireRoles("engineer", "admin")
    .input(
      z
        .object({
          changeOrderId: z.string().uuid(),
          /** Document revisions to attach (bulk). */
          documentRevisionIds: z.array(z.string().uuid()).optional(),
          /** Routing revisions to attach (must be draft). */
          routingRevisionIds: z.array(z.string().uuid()).optional(),
          notes: z.string().max(2000).optional(),
        })
        .refine(
          (v) =>
            (v.documentRevisionIds?.length ?? 0) > 0 ||
            (v.routingRevisionIds?.length ?? 0) > 0,
          {
            message:
              "Provide at least one documentRevisionId or routingRevisionId",
          },
        ),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [co] = await tx
          .select()
          .from(changeOrders)
          .where(eq(changeOrders.id, input.changeOrderId))
          .limit(1);
        if (!co) throw new TRPCError({ code: "NOT_FOUND" });
        if (co.status !== "draft" && co.status !== "in_review") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Items can only be added while draft or in_review",
          });
        }

        const uniqueDocIds = [
          ...new Set(input.documentRevisionIds ?? []),
        ];
        const uniqueRoutingIds = [
          ...new Set(input.routingRevisionIds ?? []),
        ];

        const inserted = [];

        if (uniqueDocIds.length > 0) {
          const revs = await tx
            .select()
            .from(documentRevisions)
            .where(inArray(documentRevisions.id, uniqueDocIds));

          if (revs.length !== uniqueDocIds.length) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "One or more document revisions were not found",
            });
          }

          for (const rev of revs) {
            if (rev.status !== "draft" && rev.status !== "in_review") {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Revision ${rev.rev} must be draft or in_review (got ${rev.status})`,
              });
            }
          }

          for (const rev of revs) {
            const [row] = await tx
              .insert(changeOrderItems)
              .values({
                companyId: ctx.companyId,
                changeOrderId: co.id,
                documentRevisionId: rev.id,
                routingRevisionId: null,
                notes: input.notes ?? null,
              })
              .onConflictDoNothing()
              .returning();
            if (row) inserted.push(row);
          }
        }

        if (uniqueRoutingIds.length > 0) {
          const revs = await tx
            .select()
            .from(routingRevisions)
            .where(inArray(routingRevisions.id, uniqueRoutingIds));

          if (revs.length !== uniqueRoutingIds.length) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "One or more routing revisions were not found",
            });
          }

          for (const rev of revs) {
            if (rev.status !== "draft") {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Routing revision ${rev.rev} must be draft (got ${rev.status})`,
              });
            }
          }

          for (const rev of revs) {
            const [row] = await tx
              .insert(changeOrderItems)
              .values({
                companyId: ctx.companyId,
                changeOrderId: co.id,
                documentRevisionId: null,
                routingRevisionId: rev.id,
                notes: input.notes ?? null,
              })
              .onConflictDoNothing()
              .returning();
            if (row) inserted.push(row);
          }
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "change_order.add_item",
          entityType: CO_ENTITY_TYPE,
          entityId: co.id,
          metadata: {
            documentRevisionIds: uniqueDocIds,
            routingRevisionIds: uniqueRoutingIds,
            insertedCount: inserted.length,
          },
        });

        return { items: inserted };
      });
    }),

  removeItem: requireRoles("engineer", "admin")
    .input(z.object({ itemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [item] = await tx
          .select()
          .from(changeOrderItems)
          .where(eq(changeOrderItems.id, input.itemId))
          .limit(1);
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });

        const [co] = await tx
          .select()
          .from(changeOrders)
          .where(eq(changeOrders.id, item.changeOrderId))
          .limit(1);
        if (!co) throw new TRPCError({ code: "NOT_FOUND" });
        if (co.status !== "draft" && co.status !== "in_review") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Items can only be removed while draft or in_review",
          });
        }

        await tx
          .delete(changeOrderItems)
          .where(eq(changeOrderItems.id, item.id));

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "change_order.remove_item",
          entityType: CO_ENTITY_TYPE,
          entityId: co.id,
          metadata: {
            itemId: item.id,
            documentRevisionId: item.documentRevisionId,
            routingRevisionId: item.routingRevisionId,
          },
        });

        return { ok: true };
      });
    }),

  submitForReview: requireRoles("engineer", "admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [co] = await tx
          .select()
          .from(changeOrders)
          .where(eq(changeOrders.id, input.id))
          .limit(1);
        if (!co) throw new TRPCError({ code: "NOT_FOUND" });

        if (!canTransitionChangeOrder(co.status, "in_review")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot submit change order from status ${co.status}`,
          });
        }

        const items = await tx
          .select()
          .from(changeOrderItems)
          .where(eq(changeOrderItems.changeOrderId, co.id));
        if (items.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Add at least one revision before submitting",
          });
        }

        const docRevisionIds = items
          .map((i) => i.documentRevisionId)
          .filter((id): id is string => id != null);

        if (docRevisionIds.length > 0) {
          const revs = await tx
            .select()
            .from(documentRevisions)
            .where(inArray(documentRevisions.id, docRevisionIds));

          for (const rev of revs) {
            if (rev.status === "in_review") continue;
            if (rev.status === "draft") {
              if (!canTransitionDocumentRevision("draft", "in_review")) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `Cannot auto-submit revision ${rev.rev} to in_review`,
                });
              }
              const [updated] = await tx
                .update(documentRevisions)
                .set({ status: "in_review", updatedAt: new Date() })
                .where(
                  and(
                    eq(documentRevisions.id, rev.id),
                    eq(documentRevisions.status, "draft"),
                  ),
                )
                .returning();
              if (!updated) {
                throw new TRPCError({
                  code: "CONFLICT",
                  message: `Revision ${rev.rev} is no longer a draft`,
                });
              }
              continue;
            }
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Revision ${rev.rev} must be draft or in_review (got ${rev.status})`,
            });
          }
        }

        // Routing revisions stay draft until CO implementation (no in_review).
        const routingRevisionIds = items
          .map((i) => i.routingRevisionId)
          .filter((id): id is string => id != null);
        if (routingRevisionIds.length > 0) {
          const routingRevs = await tx
            .select()
            .from(routingRevisions)
            .where(inArray(routingRevisions.id, routingRevisionIds));
          for (const rev of routingRevs) {
            if (rev.status !== "draft") {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Routing revision ${rev.rev} must be draft (got ${rev.status})`,
              });
            }
          }
        }

        assertChangeOrderTransition(co.status, "in_review");
        const [updated] = await tx
          .update(changeOrders)
          .set({ status: "in_review", updatedAt: new Date() })
          .where(
            and(eq(changeOrders.id, co.id), eq(changeOrders.status, "draft")),
          )
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Change order is no longer a draft",
          });
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "change_order.submit_for_review",
          entityType: CO_ENTITY_TYPE,
          entityId: co.id,
          metadata: { itemCount: items.length },
        });

        return updated;
      });
    }),

  /**
   * After Part 11 signatures (change_approval_me + change_approval_qa) exist,
   * atomically release all item revisions and mark the CO implemented.
   * Safe to call when not yet fully signed — returns `{ ready: false }`.
   */
  markApprovedIfReady: requireRoles("engineer", "quality", "admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [co] = await tx
          .select()
          .from(changeOrders)
          .where(eq(changeOrders.id, input.id))
          .limit(1)
          .for("update");
        if (!co) throw new TRPCError({ code: "NOT_FOUND" });

        if (co.status === "implemented") {
          return {
            ready: true as const,
            alreadyImplemented: true,
            changeOrder: co,
          };
        }

        const coSignatures = await tx
          .select()
          .from(signatures)
          .where(
            and(
              eq(signatures.entityType, CO_ENTITY_TYPE),
              eq(signatures.entityId, co.id),
            ),
          );

        const meanings = new Set(coSignatures.map((s) => s.meaning));
        const hasMe = meanings.has("change_approval_me");
        const hasQa = meanings.has("change_approval_qa");
        if (!hasMe || !hasQa) {
          return {
            ready: false as const,
            missing: {
              change_approval_me: !hasMe,
              change_approval_qa: !hasQa,
            },
            changeOrder: co,
          };
        }

        const implemented = await implementChangeOrder(tx, {
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          changeOrderId: co.id,
        });

        return {
          ready: true as const,
          alreadyImplemented: false,
          changeOrder: implemented,
        };
      });
    }),

  reject: requireRoles("engineer", "quality", "admin")
    .input(
      z.object({
        id: z.string().uuid(),
        notes: z
          .string({ required_error: "Rejection notes are required" })
          .min(1, { message: "Rejection notes are required" })
          .max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [co] = await tx
          .select()
          .from(changeOrders)
          .where(eq(changeOrders.id, input.id))
          .limit(1);
        if (!co) throw new TRPCError({ code: "NOT_FOUND" });

        if (!canTransitionChangeOrder(co.status, "rejected")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot reject change order from status ${co.status}`,
          });
        }
        if (co.status !== "in_review") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only in_review change orders can be rejected",
          });
        }

        assertChangeOrderTransition("in_review", "rejected");
        const [updated] = await tx
          .update(changeOrders)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(
            and(
              eq(changeOrders.id, co.id),
              eq(changeOrders.status, "in_review"),
            ),
          )
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Change order is no longer in_review",
          });
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "change_order.reject",
          entityType: CO_ENTITY_TYPE,
          entityId: co.id,
          metadata: { notes: input.notes },
        });

        return updated;
      });
    }),
});
