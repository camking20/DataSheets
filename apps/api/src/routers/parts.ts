import { z } from "zod";
import { eq, and, desc, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  parts,
  partRevisions,
  dimensions,
  auditLogs,
} from "@datasheets/db";
import {
  CreatePartSchema,
  CreateDimensionSchema,
  UpdateDimensionSchema,
} from "@datasheets/core";
import { router, tenantProcedure, requireRoles, asTenant } from "../trpc.js";

export const partsRouter = router({
  list: tenantProcedure.query(async ({ ctx }) => {
    return asTenant(ctx.db, ctx.companyId, async (tx) => {
      return tx
        .select()
        .from(parts)
        .where(eq(parts.isActive, true))
        .orderBy(asc(parts.partNumber));
    });
  }),

  search: tenantProcedure
    .input(z.object({ q: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const all = await tx
          .select()
          .from(parts)
          .where(eq(parts.isActive, true))
          .orderBy(asc(parts.partNumber));
        const q = input.q.toLowerCase();
        return all.filter(
          (p) =>
            p.partNumber.toLowerCase().includes(q) ||
            (p.description?.toLowerCase().includes(q) ?? false),
        );
      });
    }),

  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [part] = await tx
          .select()
          .from(parts)
          .where(eq(parts.id, input.id))
          .limit(1);
        if (!part) throw new TRPCError({ code: "NOT_FOUND" });

        const revisions = await tx
          .select()
          .from(partRevisions)
          .where(eq(partRevisions.partId, part.id))
          .orderBy(desc(partRevisions.createdAt));

        return { part, revisions };
      });
    }),

  create: requireRoles("engineer", "admin")
    .input(CreatePartSchema)
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [part] = await tx
          .insert(parts)
          .values({
            companyId: ctx.companyId,
            partNumber: input.partNumber,
            description: input.description,
            customer: input.customer,
          })
          .returning();

        const [rev] = await tx
          .insert(partRevisions)
          .values({
            companyId: ctx.companyId,
            partId: part!.id,
            rev: "A",
            status: "draft",
          })
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "part.create",
          entityType: "part",
          entityId: part!.id,
          metadata: { partNumber: input.partNumber, revisionId: rev!.id },
        });

        return { part: part!, revision: rev! };
      });
    }),

  listRevisions: tenantProcedure
    .input(z.object({ partId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        return tx
          .select()
          .from(partRevisions)
          .where(eq(partRevisions.partId, input.partId))
          .orderBy(desc(partRevisions.createdAt));
      });
    }),

  getRevision: tenantProcedure
    .input(z.object({ revisionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [rev] = await tx
          .select()
          .from(partRevisions)
          .where(eq(partRevisions.id, input.revisionId))
          .limit(1);
        if (!rev) throw new TRPCError({ code: "NOT_FOUND" });

        const [part] = await tx
          .select()
          .from(parts)
          .where(eq(parts.id, rev.partId))
          .limit(1);

        const dims = await tx
          .select()
          .from(dimensions)
          .where(eq(dimensions.partRevisionId, rev.id))
          .orderBy(asc(dimensions.displayOrder));

        return { revision: rev, part: part!, dimensions: dims };
      });
    }),

  getReleasedByPartNumber: tenantProcedure
    .input(z.object({ partNumber: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [part] = await tx
          .select()
          .from(parts)
          .where(
            and(
              eq(parts.partNumber, input.partNumber),
              eq(parts.isActive, true),
            ),
          )
          .limit(1);
        if (!part) throw new TRPCError({ code: "NOT_FOUND", message: "Part not found" });

        const [rev] = await tx
          .select()
          .from(partRevisions)
          .where(
            and(
              eq(partRevisions.partId, part.id),
              eq(partRevisions.status, "released"),
            ),
          )
          .orderBy(desc(partRevisions.releasedAt))
          .limit(1);

        if (!rev) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No released revision for this part",
          });
        }

        const dims = await tx
          .select()
          .from(dimensions)
          .where(eq(dimensions.partRevisionId, rev.id))
          .orderBy(asc(dimensions.displayOrder));

        return { part, revision: rev, dimensions: dims };
      });
    }),

  releaseRevision: requireRoles("engineer", "admin")
    .input(z.object({ revisionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [rev] = await tx
          .select()
          .from(partRevisions)
          .where(eq(partRevisions.id, input.revisionId))
          .limit(1);
        if (!rev) throw new TRPCError({ code: "NOT_FOUND" });
        if (rev.status !== "draft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only draft revisions can be released",
          });
        }

        const dims = await tx
          .select()
          .from(dimensions)
          .where(eq(dimensions.partRevisionId, rev.id));
        if (dims.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Add at least one dimension before releasing",
          });
        }

        // Supersede other released revs for this part
        await tx
          .update(partRevisions)
          .set({ status: "superseded", updatedAt: new Date() })
          .where(
            and(
              eq(partRevisions.partId, rev.partId),
              eq(partRevisions.status, "released"),
            ),
          );

        const [updated] = await tx
          .update(partRevisions)
          .set({
            status: "released",
            releasedAt: new Date(),
            releasedBy: ctx.auth.user.id,
            updatedAt: new Date(),
          })
          .where(eq(partRevisions.id, rev.id))
          .returning();

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "revision.release",
          entityType: "part_revision",
          entityId: rev.id,
        });

        return updated!;
      });
    }),

  branchRevision: requireRoles("engineer", "admin")
    .input(
      z.object({
        sourceRevisionId: z.string().uuid(),
        newRev: z.string().min(1).max(20),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [source] = await tx
          .select()
          .from(partRevisions)
          .where(eq(partRevisions.id, input.sourceRevisionId))
          .limit(1);
        if (!source) throw new TRPCError({ code: "NOT_FOUND" });

        const [newRev] = await tx
          .insert(partRevisions)
          .values({
            companyId: ctx.companyId,
            partId: source.partId,
            rev: input.newRev,
            status: "draft",
            notes: `Branched from rev ${source.rev}`,
          })
          .returning();

        const sourceDims = await tx
          .select()
          .from(dimensions)
          .where(eq(dimensions.partRevisionId, source.id));

        for (const d of sourceDims) {
          await tx.insert(dimensions).values({
            companyId: ctx.companyId,
            partRevisionId: newRev!.id,
            name: d.name,
            balloonNumber: d.balloonNumber,
            unit: d.unit,
            nominal: d.nominal,
            usl: d.usl,
            lsl: d.lsl,
            warningFraction: d.warningFraction,
            gageMethod: d.gageMethod,
            frequencyType: d.frequencyType,
            frequencyN: d.frequencyN,
            displayOrder: d.displayOrder,
          });
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "revision.branch",
          entityType: "part_revision",
          entityId: newRev!.id,
          metadata: { from: source.id, rev: input.newRev },
        });

        return newRev!;
      });
    }),

  addDimension: requireRoles("engineer", "admin")
    .input(CreateDimensionSchema)
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [rev] = await tx
          .select()
          .from(partRevisions)
          .where(eq(partRevisions.id, input.partRevisionId))
          .limit(1);
        if (!rev) throw new TRPCError({ code: "NOT_FOUND" });
        if (rev.status !== "draft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot edit a released revision — branch a new one",
          });
        }
        if (input.usl == null && input.lsl == null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "At least one of USL or LSL is required",
          });
        }

        const [dim] = await tx
          .insert(dimensions)
          .values({
            companyId: ctx.companyId,
            partRevisionId: input.partRevisionId,
            name: input.name,
            balloonNumber: input.balloonNumber,
            unit: input.unit,
            nominal: input.nominal,
            usl: input.usl ?? null,
            lsl: input.lsl ?? null,
            warningFraction: input.warningFraction,
            gageMethod: input.gageMethod,
            frequencyType: input.frequencyType,
            frequencyN: input.frequencyN,
            displayOrder: input.displayOrder,
          })
          .returning();

        return dim!;
      });
    }),

  updateDimension: requireRoles("engineer", "admin")
    .input(UpdateDimensionSchema)
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [dim] = await tx
          .select()
          .from(dimensions)
          .where(eq(dimensions.id, input.id))
          .limit(1);
        if (!dim) throw new TRPCError({ code: "NOT_FOUND" });

        const [rev] = await tx
          .select()
          .from(partRevisions)
          .where(eq(partRevisions.id, dim.partRevisionId))
          .limit(1);
        if (rev?.status !== "draft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot edit a released revision — branch a new one",
          });
        }

        const { id, ...rest } = input;
        const [updated] = await tx
          .update(dimensions)
          .set({
            ...(rest.name !== undefined ? { name: rest.name } : {}),
            ...(rest.balloonNumber !== undefined
              ? { balloonNumber: rest.balloonNumber }
              : {}),
            ...(rest.unit !== undefined ? { unit: rest.unit } : {}),
            ...(rest.nominal !== undefined ? { nominal: rest.nominal } : {}),
            ...(rest.usl !== undefined ? { usl: rest.usl } : {}),
            ...(rest.lsl !== undefined ? { lsl: rest.lsl } : {}),
            ...(rest.warningFraction !== undefined
              ? { warningFraction: rest.warningFraction }
              : {}),
            ...(rest.gageMethod !== undefined
              ? { gageMethod: rest.gageMethod }
              : {}),
            ...(rest.frequencyType !== undefined
              ? { frequencyType: rest.frequencyType }
              : {}),
            ...(rest.frequencyN !== undefined
              ? { frequencyN: rest.frequencyN }
              : {}),
            ...(rest.displayOrder !== undefined
              ? { displayOrder: rest.displayOrder }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(dimensions.id, id))
          .returning();

        return updated!;
      });
    }),

  deleteDimension: requireRoles("engineer", "admin")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [dim] = await tx
          .select()
          .from(dimensions)
          .where(eq(dimensions.id, input.id))
          .limit(1);
        if (!dim) throw new TRPCError({ code: "NOT_FOUND" });

        const [rev] = await tx
          .select()
          .from(partRevisions)
          .where(eq(partRevisions.id, dim.partRevisionId))
          .limit(1);
        if (rev?.status !== "draft") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot edit a released revision",
          });
        }

        await tx.delete(dimensions).where(eq(dimensions.id, input.id));
        return { ok: true };
      });
    }),
});
