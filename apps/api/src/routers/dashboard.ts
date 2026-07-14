import { z } from "zod";
import { eq, and, ne, desc, asc, count } from "drizzle-orm";
import {
  parts,
  dataSheets,
  measurements,
  dimensions,
  partRevisions,
  capabilitySnapshots,
} from "@datasheets/db";
import { router, tenantProcedure, asTenant } from "../trpc.js";

export const dashboardRouter = router({
  overview: tenantProcedure.query(async ({ ctx }) => {
    return asTenant(ctx.db, ctx.companyId, async (tx) => {
      const [partsCountRow] = await tx
        .select({ value: count() })
        .from(parts)
        .where(eq(parts.isActive, true));

      const [inProgressRow] = await tx
        .select({ value: count() })
        .from(dataSheets)
        .where(eq(dataSheets.status, "in_progress"));

      const [completedRow] = await tx
        .select({ value: count() })
        .from(dataSheets)
        .where(eq(dataSheets.status, "completed"));

      const recentIssues = await tx
        .select({
          measurement: measurements,
          dimensionName: dimensions.name,
          balloonNumber: dimensions.balloonNumber,
          unit: dimensions.unit,
          dataSheetId: dataSheets.id,
          lotNumber: dataSheets.lotNumber,
          partNumber: parts.partNumber,
        })
        .from(measurements)
        .innerJoin(dimensions, eq(dimensions.id, measurements.dimensionId))
        .innerJoin(dataSheets, eq(dataSheets.id, measurements.dataSheetId))
        .innerJoin(
          partRevisions,
          eq(partRevisions.id, dataSheets.partRevisionId),
        )
        .innerJoin(parts, eq(parts.id, partRevisions.partId))
        .where(
          and(
            eq(measurements.isCurrent, true),
            ne(measurements.disposition, "green"),
          ),
        )
        .orderBy(desc(measurements.measuredAt))
        .limit(20);

      const snapshotRows = await tx
        .select({
          snapshot: capabilitySnapshots,
          partNumber: parts.partNumber,
          dimensionName: dimensions.name,
        })
        .from(capabilitySnapshots)
        .innerJoin(parts, eq(parts.id, capabilitySnapshots.partId))
        .innerJoin(dimensions, eq(dimensions.id, capabilitySnapshots.dimensionId))
        .orderBy(desc(capabilitySnapshots.createdAt));

      const latestByKey = new Map<string, (typeof snapshotRows)[number]>();
      for (const row of snapshotRows) {
        const key = `${row.snapshot.partId}:${row.snapshot.dimensionId}`;
        if (!latestByKey.has(key)) latestByKey.set(key, row);
      }

      return {
        counts: {
          parts: partsCountRow?.value ?? 0,
          inProgressSheets: inProgressRow?.value ?? 0,
          completedSheets: completedRow?.value ?? 0,
        },
        recentIssues,
        latestCapabilitySnapshots: [...latestByKey.values()],
      };
    });
  }),

  partCapability: tenantProcedure
    .input(z.object({ partId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const rows = await tx
          .select({
            snapshot: capabilitySnapshots,
            dimensionName: dimensions.name,
            balloonNumber: dimensions.balloonNumber,
          })
          .from(capabilitySnapshots)
          .innerJoin(dimensions, eq(dimensions.id, capabilitySnapshots.dimensionId))
          .where(eq(capabilitySnapshots.partId, input.partId))
          .orderBy(asc(capabilitySnapshots.createdAt));

        const byDimension = new Map<
          string,
          {
            dimensionId: string;
            dimensionName: string;
            balloonNumber: string | null;
            snapshots: (typeof capabilitySnapshots.$inferSelect)[];
          }
        >();

        for (const row of rows) {
          const key = row.snapshot.dimensionId;
          if (!byDimension.has(key)) {
            byDimension.set(key, {
              dimensionId: key,
              dimensionName: row.dimensionName,
              balloonNumber: row.balloonNumber,
              snapshots: [],
            });
          }
          byDimension.get(key)!.snapshots.push(row.snapshot);
        }

        return [...byDimension.values()];
      });
    }),

  recentEvents: tenantProcedure
    .input(
      z
        .object({ limit: z.number().int().positive().max(200).default(50) })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        return tx
          .select({
            measurement: measurements,
            dimensionName: dimensions.name,
            balloonNumber: dimensions.balloonNumber,
            unit: dimensions.unit,
            dataSheetId: dataSheets.id,
            lotNumber: dataSheets.lotNumber,
            partNumber: parts.partNumber,
          })
          .from(measurements)
          .innerJoin(dimensions, eq(dimensions.id, measurements.dimensionId))
          .innerJoin(dataSheets, eq(dataSheets.id, measurements.dataSheetId))
          .innerJoin(
            partRevisions,
            eq(partRevisions.id, dataSheets.partRevisionId),
          )
          .innerJoin(parts, eq(parts.id, partRevisions.partId))
          .where(
            and(
              eq(measurements.isCurrent, true),
              ne(measurements.disposition, "green"),
            ),
          )
          .orderBy(desc(measurements.measuredAt))
          .limit(input?.limit ?? 50);
      });
    }),
});
