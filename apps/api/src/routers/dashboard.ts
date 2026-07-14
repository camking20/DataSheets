import { z } from "zod";
import { eq, and, ne, desc, sql, count } from "drizzle-orm";
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

      // Latest per-lot capability snapshot per (part, dimension) — DISTINCT ON, capped.
      const latestCapabilitySnapshots = await tx
        .select({
          snapshot: capabilitySnapshots,
          partNumber: parts.partNumber,
          dimensionName: dimensions.name,
        })
        .from(capabilitySnapshots)
        .innerJoin(parts, eq(parts.id, capabilitySnapshots.partId))
        .innerJoin(dimensions, eq(dimensions.id, capabilitySnapshots.dimensionId))
        .where(
          sql`${capabilitySnapshots.id} IN (
            SELECT DISTINCT ON (part_id, dimension_id) id
            FROM capability_snapshots
            ORDER BY part_id, dimension_id, created_at DESC
            LIMIT 500
          )`,
        )
        .orderBy(desc(capabilitySnapshots.createdAt));

      return {
        counts: {
          parts: partsCountRow?.value ?? 0,
          inProgressSheets: inProgressRow?.value ?? 0,
          completedSheets: completedRow?.value ?? 0,
        },
        recentIssues,
        /** Latest per-lot capability snapshots (one row per part × dimension). */
        latestCapabilitySnapshots,
      };
    });
  }),

  partCapability: tenantProcedure
    .input(
      z.object({
        partId: z.string().uuid(),
        limit: z.number().int().min(1).max(500).default(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const limit = input.limit ?? 100;
        const rows = await tx
          .select({
            snapshot: capabilitySnapshots,
            dimensionName: dimensions.name,
            balloonNumber: dimensions.balloonNumber,
          })
          .from(capabilitySnapshots)
          .innerJoin(dimensions, eq(dimensions.id, capabilitySnapshots.dimensionId))
          .where(eq(capabilitySnapshots.partId, input.partId))
          .orderBy(desc(capabilitySnapshots.createdAt))
          .limit(limit);

        const byDimension = new Map<
          string,
          {
            dimensionId: string;
            dimensionName: string;
            balloonNumber: string | null;
            /** Latest per-lot snapshots for this dimension (oldest → newest). */
            snapshots: (typeof capabilitySnapshots.$inferSelect)[];
          }
        >();

        // Rows arrive newest-first; unshift so each dimension stays chronological.
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
          byDimension.get(key)!.snapshots.unshift(row.snapshot);
        }

        return [...byDimension.values()];
      });
    }),

  recentEvents: tenantProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(100).default(50) })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return asTenant(ctx.db, ctx.companyId, async (tx) => {
        const limit = Math.min(100, Math.max(1, input?.limit ?? 50));
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
          .limit(limit);
      });
    }),
});
