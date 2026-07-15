/**
 * CAPA (Corrective / Preventive Action) tRPC router.
 *
 * Wired in apps/api/src/root.ts as `capa: capaRouter`.
 * Status flow: open → in_progress → verification → closed
 * (closed only via `close` with Part 11 signature meaning `closure`).
 */
import { z } from "zod";
import { eq, and, desc, lt, ne, isNotNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  capas,
  capaActions,
  nonconformances,
  signatures,
  auditLogs,
  users,
} from "@datasheets/db";
import {
  CapaStatusSchema,
  CapaActionStatusSchema,
  canTransitionCapa,
  assertCapaTransition,
  canCloseCapa,
} from "@datasheets/core";
import { router, tenantProcedure, requireRoles, asTenant } from "../trpc.js";
import { nextNumber } from "../services/numbering.js";
import { applySignature } from "../services/signatures.js";
import { verifyPassword } from "../auth.js";

const CAPA_ENTITY_TYPE = "capa";

const ContentSha256Schema = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/, "contentSha256 must be a 64-char hex SHA-256");

const CreateCapaSchema = z.object({
  description: z
    .string({ required_error: "Description is required" })
    .min(1, { message: "Description is required" })
    .max(10000),
  title: z.string().max(500).optional(),
  nonconformanceId: z.string().uuid().optional(),
  dueAt: z.coerce.date().optional(),
  rootCause: z.string().max(10000).optional(),
  correctiveAction: z.string().max(10000).optional(),
  preventiveAction: z.string().max(10000).optional(),
  riskAssessment: z.string().max(10000).optional(),
});

const UpdateCapaSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(500).nullable().optional(),
  description: z.string().min(1).max(10000).optional(),
  dueAt: z.coerce.date().nullable().optional(),
  rootCause: z.string().max(10000).nullable().optional(),
  correctiveAction: z.string().max(10000).nullable().optional(),
  preventiveAction: z.string().max(10000).nullable().optional(),
  riskAssessment: z.string().max(10000).nullable().optional(),
  nonconformanceId: z.string().uuid().nullable().optional(),
});

const UPDATE_CAPA_FIELD_KEYS = [
  "title",
  "description",
  "dueAt",
  "rootCause",
  "correctiveAction",
  "preventiveAction",
  "riskAssessment",
  "nonconformanceId",
] as const;

export const capaRouter = router({
  list: tenantProcedure
    .input(
      z
        .object({
          status: CapaStatusSchema.optional(),
          overdue: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const conditions = [];
        if (input?.status) {
          conditions.push(eq(capas.status, input.status));
        }
        if (input?.overdue) {
          conditions.push(isNotNull(capas.dueAt));
          conditions.push(lt(capas.dueAt, new Date()));
          conditions.push(ne(capas.status, "closed"));
        }
        const limit = input?.limit ?? 50;

        return tx
          .select()
          .from(capas)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(capas.createdAt))
          .limit(limit);
      });
    }),

  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [capa] = await tx
          .select()
          .from(capas)
          .where(eq(capas.id, input.id))
          .limit(1);
        if (!capa) throw new TRPCError({ code: "NOT_FOUND" });

        const actions = await tx
          .select()
          .from(capaActions)
          .where(eq(capaActions.capaId, capa.id))
          .orderBy(desc(capaActions.createdAt));

        let nonconformance = null;
        if (capa.nonconformanceId) {
          const [nc] = await tx
            .select()
            .from(nonconformances)
            .where(eq(nonconformances.id, capa.nonconformanceId))
            .limit(1);
          nonconformance = nc ?? null;
        }

        const capaSignatures = await tx
          .select()
          .from(signatures)
          .where(
            and(
              eq(signatures.entityType, CAPA_ENTITY_TYPE),
              eq(signatures.entityId, capa.id),
            ),
          )
          .orderBy(desc(signatures.signedAt));

        return {
          capa,
          actions,
          nonconformance,
          signatures: capaSignatures,
        };
      });
    }),

  create: requireRoles("engineer", "quality", "admin")
    .input(CreateCapaSchema)
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        if (input.nonconformanceId) {
          const [nc] = await tx
            .select({ id: nonconformances.id })
            .from(nonconformances)
            .where(eq(nonconformances.id, input.nonconformanceId))
            .limit(1);
          if (!nc) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Linked nonconformance not found",
            });
          }
        }

        const capaNumber = await nextNumber(tx, ctx.companyId, "CAPA");

        const [capa] = await tx
          .insert(capas)
          .values({
            companyId: ctx.companyId,
            capaNumber,
            description: input.description,
            title: input.title ?? null,
            nonconformanceId: input.nonconformanceId ?? null,
            dueAt: input.dueAt ?? null,
            rootCause: input.rootCause ?? null,
            correctiveAction: input.correctiveAction ?? null,
            preventiveAction: input.preventiveAction ?? null,
            riskAssessment: input.riskAssessment ?? null,
            status: "open",
            createdBy: ctx.auth.user.id,
          })
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "capa.create",
          entityType: CAPA_ENTITY_TYPE,
          entityId: capa!.id,
          metadata: {
            capaNumber,
            nonconformanceId: input.nonconformanceId ?? null,
          },
        });

        return capa!;
      });
    }),

  update: requireRoles("engineer", "quality", "admin")
    .input(UpdateCapaSchema)
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [capa] = await tx
          .select()
          .from(capas)
          .where(eq(capas.id, input.id))
          .limit(1);
        if (!capa) throw new TRPCError({ code: "NOT_FOUND" });
        if (capa.status === "closed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Closed CAPAs cannot be edited",
          });
        }

        if (input.nonconformanceId) {
          const [nc] = await tx
            .select({ id: nonconformances.id })
            .from(nonconformances)
            .where(eq(nonconformances.id, input.nonconformanceId))
            .limit(1);
          if (!nc) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Linked nonconformance not found",
            });
          }
        }

        const changedFields = UPDATE_CAPA_FIELD_KEYS.filter(
          (key) => input[key] !== undefined,
        );

        const [updated] = await tx
          .update(capas)
          .set({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
            ...(input.rootCause !== undefined
              ? { rootCause: input.rootCause }
              : {}),
            ...(input.correctiveAction !== undefined
              ? { correctiveAction: input.correctiveAction }
              : {}),
            ...(input.preventiveAction !== undefined
              ? { preventiveAction: input.preventiveAction }
              : {}),
            ...(input.riskAssessment !== undefined
              ? { riskAssessment: input.riskAssessment }
              : {}),
            ...(input.nonconformanceId !== undefined
              ? { nonconformanceId: input.nonconformanceId }
              : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(capas.id, capa.id), ne(capas.status, "closed")))
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "CAPA is no longer editable",
          });
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "capa.update",
          entityType: CAPA_ENTITY_TYPE,
          entityId: capa.id,
          metadata: { changedFields },
        });

        return updated;
      });
    }),

  addAction: requireRoles("engineer", "quality", "admin")
    .input(
      z.object({
        capaId: z.string().uuid(),
        description: z
          .string({ required_error: "Description is required" })
          .min(1)
          .max(5000),
        actionType: z.string().max(200).optional(),
        assigneeId: z.string().uuid().optional(),
        dueAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [capa] = await tx
          .select()
          .from(capas)
          .where(eq(capas.id, input.capaId))
          .limit(1);
        if (!capa) throw new TRPCError({ code: "NOT_FOUND" });
        if (capa.status === "closed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot add actions to a closed CAPA",
          });
        }

        const [action] = await tx
          .insert(capaActions)
          .values({
            companyId: ctx.companyId,
            capaId: capa.id,
            description: input.description,
            actionType: input.actionType ?? null,
            assigneeId: input.assigneeId ?? null,
            dueAt: input.dueAt ?? null,
            status: "pending",
          })
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "capa.add_action",
          entityType: CAPA_ENTITY_TYPE,
          entityId: capa.id,
          metadata: { actionId: action!.id },
        });

        return action!;
      });
    }),

  updateAction: requireRoles("engineer", "quality", "admin")
    .input(
      z.object({
        id: z.string().uuid(),
        description: z.string().min(1).max(5000).optional(),
        actionType: z.string().max(200).nullable().optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        dueAt: z.coerce.date().nullable().optional(),
        status: CapaActionStatusSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [action] = await tx
          .select()
          .from(capaActions)
          .where(eq(capaActions.id, input.id))
          .limit(1);
        if (!action) throw new TRPCError({ code: "NOT_FOUND" });

        const [capa] = await tx
          .select()
          .from(capas)
          .where(eq(capas.id, action.capaId))
          .limit(1);
        if (!capa) throw new TRPCError({ code: "NOT_FOUND" });
        if (capa.status === "closed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot update actions on a closed CAPA",
          });
        }

        const nextStatus = input.status ?? action.status;
        const reopeningCompleted =
          action.status === "completed" && nextStatus !== "completed";

        // Once completed, only admin may reopen (blocks free completed→pending
        // while CAPA is in verification; closed CAPAs already rejected above).
        if (reopeningCompleted && ctx.role !== "admin") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only admin can reopen a completed CAPA action",
          });
        }

        const completedAt =
          nextStatus === "completed"
            ? (action.completedAt ?? new Date())
            : nextStatus === "cancelled" ||
                nextStatus === "pending" ||
                nextStatus === "in_progress"
              ? null
              : action.completedAt;

        const [updated] = await tx
          .update(capaActions)
          .set({
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            ...(input.actionType !== undefined
              ? { actionType: input.actionType }
              : {}),
            ...(input.assigneeId !== undefined
              ? { assigneeId: input.assigneeId }
              : {}),
            ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            completedAt,
            updatedAt: new Date(),
          })
          .where(eq(capaActions.id, action.id))
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "capa.update_action",
          entityType: CAPA_ENTITY_TYPE,
          entityId: capa.id,
          metadata: { actionId: action.id, status: nextStatus },
        });

        return updated!;
      });
    }),

  completeAction: requireRoles("engineer", "quality", "admin", "operator")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [action] = await tx
          .select()
          .from(capaActions)
          .where(eq(capaActions.id, input.id))
          .limit(1);
        if (!action) throw new TRPCError({ code: "NOT_FOUND" });

        const [capa] = await tx
          .select()
          .from(capas)
          .where(eq(capas.id, action.capaId))
          .limit(1);
        if (!capa) throw new TRPCError({ code: "NOT_FOUND" });
        if (capa.status === "closed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot complete actions on a closed CAPA",
          });
        }
        if (action.status === "completed") {
          return action;
        }
        if (action.status === "cancelled") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cancelled actions cannot be completed",
          });
        }

        const now = new Date();
        const [updated] = await tx
          .update(capaActions)
          .set({
            status: "completed",
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(capaActions.id, action.id),
              ne(capaActions.status, "completed"),
              ne(capaActions.status, "cancelled"),
            ),
          )
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Action could not be completed",
          });
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "capa.complete_action",
          entityType: CAPA_ENTITY_TYPE,
          entityId: capa.id,
          metadata: { actionId: action.id },
        });

        return updated;
      });
    }),

  /**
   * Advance CAPA status one step: open → in_progress → verification.
   * Closing requires `close` (signature).
   */
  setStatus: requireRoles("engineer", "quality", "admin")
    .input(
      z.object({
        id: z.string().uuid(),
        status: CapaStatusSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [capa] = await tx
          .select()
          .from(capas)
          .where(eq(capas.id, input.id))
          .limit(1);
        if (!capa) throw new TRPCError({ code: "NOT_FOUND" });

        if (input.status === "closed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Closing a CAPA requires an e-signature — use capa.close",
          });
        }

        if (!canTransitionCapa(capa.status, input.status)) {
          try {
            assertCapaTransition(capa.status, input.status);
          } catch (err) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                err instanceof Error
                  ? err.message
                  : `Invalid CAPA transition: ${capa.status} → ${input.status}`,
            });
          }
        }

        const [updated] = await tx
          .update(capas)
          .set({ status: input.status, updatedAt: new Date() })
          .where(and(eq(capas.id, capa.id), eq(capas.status, capa.status)))
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "CAPA status changed concurrently",
          });
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "capa.set_status",
          entityType: CAPA_ENTITY_TYPE,
          entityId: capa.id,
          metadata: { from: capa.status, to: input.status },
        });

        return updated;
      });
    }),

  recordEffectiveness: requireRoles("engineer", "quality", "admin")
    .input(
      z.object({
        id: z.string().uuid(),
        effectivenessCheck: z
          .string({ required_error: "Effectiveness check is required" })
          .min(1)
          .max(10000),
        /** When true, record verifier as current user (requires password re-auth). */
        verify: z.boolean().optional(),
        password: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [capa] = await tx
          .select()
          .from(capas)
          .where(eq(capas.id, input.id))
          .limit(1);
        if (!capa) throw new TRPCError({ code: "NOT_FOUND" });
        if (capa.status === "closed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Closed CAPAs cannot record effectiveness",
          });
        }

        const now = new Date();
        let verified = false;

        if (input.verify) {
          if (!input.password) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Password is required to verify effectiveness",
            });
          }

          const [user] = await tx
            .select()
            .from(users)
            .where(eq(users.id, ctx.auth.user.id))
            .limit(1);

          if (
            !user?.passwordHash ||
            !verifyPassword(input.password, user.passwordHash)
          ) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Invalid password",
            });
          }

          verified = true;
        }

        const [updated] = await tx
          .update(capas)
          .set({
            effectivenessCheck: input.effectivenessCheck,
            ...(verified
              ? {
                  effectivenessVerifiedBy: ctx.auth.user.id,
                  effectivenessVerifiedAt: now,
                }
              : {}),
            updatedAt: now,
          })
          .where(and(eq(capas.id, capa.id), ne(capas.status, "closed")))
          .returning();

        if (!updated) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "CAPA is no longer editable",
          });
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: verified
            ? "capa.effectiveness_verify"
            : "capa.record_effectiveness",
          entityType: CAPA_ENTITY_TYPE,
          entityId: capa.id,
          metadata: {
            verified,
            effectivenessCheck: input.effectivenessCheck,
          },
        });

        return updated;
      });
    }),

  /**
   * Close CAPA with Part 11 signature (meaning `closure`, entityType `capa`).
   * Requires canCloseCapa gates (verification, actions done, effectiveness verified).
   */
  close: requireRoles("quality", "admin")
    .input(
      z.object({
        id: z.string().uuid(),
        password: z.string().min(1),
        /** Optional client preview hash; server computes and binds content. */
        contentSha256: ContentSha256Schema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [capa] = await tx
          .select()
          .from(capas)
          .where(eq(capas.id, input.id))
          .limit(1)
          .for("update");
        if (!capa) throw new TRPCError({ code: "NOT_FOUND" });

        if (capa.status === "closed") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "CAPA is already closed",
          });
        }

        const actions = await tx
          .select()
          .from(capaActions)
          .where(eq(capaActions.capaId, capa.id));

        const gate = canCloseCapa(
          capa,
          actions,
          Boolean(
            capa.effectivenessVerifiedBy && capa.effectivenessVerifiedAt,
          ),
        );
        if (!gate.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: gate.reason ?? "CAPA cannot be closed",
          });
        }

        const signature = await applySignature(tx, {
          companyId: ctx.companyId,
          userId: ctx.auth.user.id,
          role: ctx.role,
          entityType: CAPA_ENTITY_TYPE,
          entityId: capa.id,
          meaning: "closure",
          password: input.password,
          ...(input.contentSha256 !== undefined
            ? { contentSha256: input.contentSha256.toLowerCase() }
            : {}),
        });

        const now = new Date();
        const [closed] = await tx
          .update(capas)
          .set({
            status: "closed",
            closedAt: now,
            closedBy: ctx.auth.user.id,
            updatedAt: now,
          })
          .where(
            and(eq(capas.id, capa.id), eq(capas.status, "verification")),
          )
          .returning();

        if (!closed) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "CAPA status changed concurrently",
          });
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "capa.close",
          entityType: CAPA_ENTITY_TYPE,
          entityId: capa.id,
          metadata: {
            signatureId: signature.id,
            capaNumber: capa.capaNumber,
          },
        });

        return { capa: closed, signature };
      });
    }),
});
