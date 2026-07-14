import { z } from "zod";
import { eq, and, desc, asc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  dataSheets,
  measurements,
  dimensions,
  partRevisions,
  parts,
  capabilitySnapshots,
  auditLogs,
} from "@datasheets/db";
import {
  CreateDataSheetSchema,
  RecordMeasurementSchema,
  SheetStatusSchema,
  generateSampleIndices,
  evaluateDisposition,
  computeCapability,
  roundCapability,
} from "@datasheets/core";
import { router, tenantProcedure, asTenant } from "../trpc.js";

export const sheetsRouter = router({
  create: tenantProcedure
    .input(CreateDataSheetSchema)
    .mutation(async ({ ctx, input }) => {
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
        if (!part) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Part ${input.partNumber} not found`,
          });
        }

        const [revision] = await tx
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
        if (!revision) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Part has no released revision",
          });
        }

        const dims = await tx
          .select()
          .from(dimensions)
          .where(eq(dimensions.partRevisionId, revision.id))
          .orderBy(asc(dimensions.displayOrder));
        if (dims.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Released revision has no dimensions defined",
          });
        }

        const [sheet] = await tx
          .insert(dataSheets)
          .values({
            companyId: ctx.companyId,
            partRevisionId: revision.id,
            lotNumber: input.lotNumber,
            lotSize: input.lotSize,
            operatorId: ctx.auth.user.id,
          })
          .returning();

        const samplePlan = dims.map((dim) => ({
          dimensionId: dim.id,
          sampleIndices: generateSampleIndices(input.lotSize, {
            type: dim.frequencyType,
            n: dim.frequencyN,
          }),
        }));

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "sheet.create",
          entityType: "data_sheet",
          entityId: sheet!.id,
          metadata: {
            partNumber: input.partNumber,
            lotNumber: input.lotNumber,
            lotSize: input.lotSize,
          },
        });

        return { sheet: sheet!, dimensions: dims, samplePlan };
      });
    }),

  getById: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [sheet] = await tx
          .select()
          .from(dataSheets)
          .where(eq(dataSheets.id, input.id))
          .limit(1);
        if (!sheet) throw new TRPCError({ code: "NOT_FOUND" });

        const [revision] = await tx
          .select()
          .from(partRevisions)
          .where(eq(partRevisions.id, sheet.partRevisionId))
          .limit(1);
        if (!revision) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Revision not found" });
        }

        const [part] = await tx
          .select()
          .from(parts)
          .where(eq(parts.id, revision.partId))
          .limit(1);

        const dims = await tx
          .select()
          .from(dimensions)
          .where(eq(dimensions.partRevisionId, revision.id))
          .orderBy(asc(dimensions.displayOrder));

        const currentMeasurements = await tx
          .select()
          .from(measurements)
          .where(
            and(
              eq(measurements.dataSheetId, sheet.id),
              eq(measurements.isCurrent, true),
            ),
          );

        const samplePlan = dims.map((dim) => ({
          dimensionId: dim.id,
          sampleIndices: generateSampleIndices(sheet.lotSize, {
            type: dim.frequencyType,
            n: dim.frequencyN,
          }),
        }));

        return {
          sheet,
          part: part ?? null,
          revision,
          dimensions: dims,
          measurements: currentMeasurements,
          samplePlan,
        };
      });
    }),

  list: tenantProcedure
    .input(z.object({ status: SheetStatusSchema.optional() }).optional())
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        return tx
          .select({
            sheet: dataSheets,
            revision: partRevisions,
            part: parts,
          })
          .from(dataSheets)
          .innerJoin(
            partRevisions,
            eq(partRevisions.id, dataSheets.partRevisionId),
          )
          .innerJoin(parts, eq(parts.id, partRevisions.partId))
          .where(
            input?.status ? eq(dataSheets.status, input.status) : undefined,
          )
          .orderBy(desc(dataSheets.createdAt));
      });
    }),

  recordMeasurement: tenantProcedure
    .input(RecordMeasurementSchema)
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [sheet] = await tx
          .select()
          .from(dataSheets)
          .where(eq(dataSheets.id, input.dataSheetId))
          .limit(1);
        if (!sheet) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Data sheet not found" });
        }
        if (sheet.status !== "in_progress") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Cannot record measurements on a sheet that is ${sheet.status}`,
          });
        }

        const [dim] = await tx
          .select()
          .from(dimensions)
          .where(eq(dimensions.id, input.dimensionId))
          .limit(1);
        if (!dim) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Dimension not found" });
        }

        const disposition = evaluateDisposition(input.value, {
          nominal: dim.nominal,
          usl: dim.usl,
          lsl: dim.lsl,
          warningFraction: dim.warningFraction,
        });

        const [existing] = await tx
          .select()
          .from(measurements)
          .where(
            and(
              eq(measurements.dataSheetId, input.dataSheetId),
              eq(measurements.dimensionId, input.dimensionId),
              eq(measurements.sampleIndex, input.sampleIndex),
              eq(measurements.isCurrent, true),
            ),
          )
          .limit(1);

        const [inserted] = await tx
          .insert(measurements)
          .values({
            companyId: ctx.companyId,
            dataSheetId: input.dataSheetId,
            dimensionId: input.dimensionId,
            sampleIndex: input.sampleIndex,
            value: input.value,
            disposition,
            measuredBy: ctx.auth.user.id,
          })
          .returning();

        if (existing) {
          await tx
            .update(measurements)
            .set({ isCurrent: false, supersededBy: inserted!.id })
            .where(eq(measurements.id, existing.id));
        }

        return inserted!;
      });
    }),

  liveCapability: tenantProcedure
    .input(z.object({ sheetId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [sheet] = await tx
          .select()
          .from(dataSheets)
          .where(eq(dataSheets.id, input.sheetId))
          .limit(1);
        if (!sheet) throw new TRPCError({ code: "NOT_FOUND" });

        const dims = await tx
          .select()
          .from(dimensions)
          .where(eq(dimensions.partRevisionId, sheet.partRevisionId))
          .orderBy(asc(dimensions.displayOrder));

        const current = await tx
          .select()
          .from(measurements)
          .where(
            and(
              eq(measurements.dataSheetId, sheet.id),
              eq(measurements.isCurrent, true),
            ),
          );

        return dims.map((dim) => {
          const dimMeasurements = current.filter((m) => m.dimensionId === dim.id);
          const values = dimMeasurements.map((m) => m.value);
          const dispositions = dimMeasurements.map((m) => m.disposition);
          const result = roundCapability(
            computeCapability(
              values,
              {
                nominal: dim.nominal,
                usl: dim.usl,
                lsl: dim.lsl,
                warningFraction: dim.warningFraction,
              },
              dispositions,
            ),
          );
          return { dimensionId: dim.id, dimensionName: dim.name, ...result };
        });
      });
    }),

  complete: tenantProcedure
    .input(
      z.object({
        dataSheetId: z.string().uuid(),
        force: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const [sheet] = await tx
          .select()
          .from(dataSheets)
          .where(eq(dataSheets.id, input.dataSheetId))
          .limit(1);
        if (!sheet) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Data sheet not found" });
        }
        if (sheet.status !== "in_progress") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Sheet is already ${sheet.status}`,
          });
        }

        const [revision] = await tx
          .select()
          .from(partRevisions)
          .where(eq(partRevisions.id, sheet.partRevisionId))
          .limit(1);
        if (!revision) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Revision not found" });
        }

        const dims = await tx
          .select()
          .from(dimensions)
          .where(eq(dimensions.partRevisionId, revision.id));

        const current = await tx
          .select()
          .from(measurements)
          .where(
            and(
              eq(measurements.dataSheetId, sheet.id),
              eq(measurements.isCurrent, true),
            ),
          );

        const missing: Array<{
          dimensionId: string;
          dimensionName: string;
          missingSamples: number[];
        }> = [];

        for (const dim of dims) {
          const required = generateSampleIndices(sheet.lotSize, {
            type: dim.frequencyType,
            n: dim.frequencyN,
          });
          const filled = new Set(
            current
              .filter((m) => m.dimensionId === dim.id)
              .map((m) => m.sampleIndex),
          );
          const missingSamples = required.filter((idx) => !filled.has(idx));
          if (missingSamples.length > 0) {
            missing.push({ dimensionId: dim.id, dimensionName: dim.name, missingSamples });
          }
        }

        if (missing.length > 0 && !input.force) {
          const summary = missing
            .map(
              (m) =>
                `${m.dimensionName} (${m.missingSamples.length} sample${
                  m.missingSamples.length === 1 ? "" : "s"
                })`,
            )
            .join(", ");
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Missing required measurements: ${summary}`,
            cause: { missing },
          });
        }

        const [updated] = await tx
          .update(dataSheets)
          .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
          .where(eq(dataSheets.id, sheet.id))
          .returning();

        const snapshots = [];
        for (const dim of dims) {
          const dimMeasurements = current.filter((m) => m.dimensionId === dim.id);
          const values = dimMeasurements.map((m) => m.value);
          const dispositions = dimMeasurements.map((m) => m.disposition);
          const result = roundCapability(
            computeCapability(
              values,
              {
                nominal: dim.nominal,
                usl: dim.usl,
                lsl: dim.lsl,
                warningFraction: dim.warningFraction,
              },
              dispositions,
            ),
          );

          const [snapshot] = await tx
            .insert(capabilitySnapshots)
            .values({
              companyId: ctx.companyId,
              dataSheetId: sheet.id,
              dimensionId: dim.id,
              partId: revision.partId,
              n: result.n,
              mean: result.mean,
              stdDev: result.stdDev,
              cp: result.cp,
              cpk: result.cpk,
              percentYellow: result.percentYellow,
              percentRed: result.percentRed,
            })
            .onConflictDoUpdate({
              target: [
                capabilitySnapshots.companyId,
                capabilitySnapshots.dataSheetId,
                capabilitySnapshots.dimensionId,
              ],
              set: {
                n: result.n,
                mean: result.mean,
                stdDev: result.stdDev,
                cp: result.cp,
                cpk: result.cpk,
                percentYellow: result.percentYellow,
                percentRed: result.percentRed,
              },
            })
            .returning();
          snapshots.push(snapshot!);
        }

        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "sheet.complete",
          entityType: "data_sheet",
          entityId: sheet.id,
          metadata: { force: input.force, missingDimensions: missing.length },
        });

        return { sheet: updated!, snapshots };
      });
    }),
});
