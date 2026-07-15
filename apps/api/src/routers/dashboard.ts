import { z } from "zod";
import {
  eq,
  and,
  ne,
  desc,
  sql,
  count,
  or,
  notInArray,
  isNotNull,
  isNull,
  gte,
  lt,
  lte,
  inArray,
} from "drizzle-orm";
import {
  parts,
  dataSheets,
  measurements,
  dimensions,
  partRevisions,
  capabilitySnapshots,
  documentRevisions,
  changeOrders,
  workOrders,
  workOrderOperations,
  routingOperations,
  operationExecutions,
  nonconformances,
  capas,
} from "@datasheets/db";
import {
  canSignMeaning,
  type MembershipRole,
  type SignatureMeaning,
} from "@datasheets/core";
import { router, tenantProcedure, asTenant } from "../trpc.js";

const NC_STATUSES = [
  "initiation",
  "containment",
  "disposition_planning",
  "disposition_execution",
  "investigation",
  "closure",
] as const;

type NcStatus = (typeof NC_STATUSES)[number];

/**
 * Role-aware "needs my signature" predicate for an in-review entity.
 * ME/QA meanings differ for documents vs change orders.
 */
function needsMySignatureSql(
  entityIdCol: typeof documentRevisions.id | typeof changeOrders.id,
  entityType: "document_revision" | "change_order",
  meMeaning: SignatureMeaning,
  qaMeaning: SignatureMeaning,
  role: MembershipRole,
  userId: string,
) {
  const canMe = canSignMeaning(role, meMeaning);
  const canQa = canSignMeaning(role, qaMeaning);
  if (!canMe && !canQa) return null;

  const missing = (meaning: SignatureMeaning) => sql`NOT EXISTS (
    SELECT 1 FROM signatures s
    WHERE s.entity_type = ${entityType}
      AND s.entity_id = ${entityIdCol}
      AND s.meaning = ${meaning}
  )`;

  const userSigned = (meaning: SignatureMeaning) => sql`EXISTS (
    SELECT 1 FROM signatures s
    WHERE s.entity_type = ${entityType}
      AND s.entity_id = ${entityIdCol}
      AND s.signer_id = ${userId}::uuid
      AND s.meaning = ${meaning}
  )`;

  const clauses = [];
  if (canMe) {
    // Can still apply ME if missing, and SoD allows (user hasn't signed QA).
    clauses.push(and(missing(meMeaning), sql`NOT (${userSigned(qaMeaning)})`));
  }
  if (canQa) {
    clauses.push(and(missing(qaMeaning), sql`NOT (${userSigned(meMeaning)})`));
  }

  if (clauses.length === 1) return clauses[0]!;
  return or(...clauses);
}

export const dashboardRouter = router({
  overview: tenantProcedure.query(async ({ ctx }) => {
    return asTenant(ctx.db, ctx.companyId, async (tx) => {
      const userId = ctx.auth.user.id;
      const role = ctx.role;

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

      const [documentsInReviewRow] = await tx
        .select({ value: count() })
        .from(documentRevisions)
        .where(eq(documentRevisions.status, "in_review"));

      const [openChangeOrdersRow] = await tx
        .select({ value: count() })
        .from(changeOrders)
        .where(
          notInArray(changeOrders.status, ["rejected", "implemented"]),
        );

      const docNeedsSig = needsMySignatureSql(
        documentRevisions.id,
        "document_revision",
        "me_approval",
        "qa_approval",
        role,
        userId,
      );
      let pendingDocumentApprovals = 0;
      if (docNeedsSig) {
        const [row] = await tx
          .select({ value: count() })
          .from(documentRevisions)
          .where(
            and(eq(documentRevisions.status, "in_review"), docNeedsSig),
          );
        pendingDocumentApprovals = row?.value ?? 0;
      }

      const coNeedsSig = needsMySignatureSql(
        changeOrders.id,
        "change_order",
        "change_approval_me",
        "change_approval_qa",
        role,
        userId,
      );
      let pendingChangeOrderApprovals = 0;
      if (coNeedsSig) {
        const [row] = await tx
          .select({ value: count() })
          .from(changeOrders)
          .where(and(eq(changeOrders.status, "in_review"), coNeedsSig));
        pendingChangeOrderApprovals = row?.value ?? 0;
      }

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

      // --- MES / QMS dashboard v2 aggregations ---

      const woStatusRows = await tx
        .select({
          status: workOrders.status,
          value: count(),
        })
        .from(workOrders)
        .where(
          inArray(workOrders.status, [
            "planned",
            "released",
            "in_progress",
            "on_hold",
          ]),
        )
        .groupBy(workOrders.status);

      const woByStatus: Record<string, number> = {};
      for (const row of woStatusRows) {
        woByStatus[row.status] = row.value;
      }

      const [completedRecentRow] = await tx
        .select({ value: count() })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.status, "completed"),
            gte(workOrders.completedAt, sql`now() - interval '7 days'`),
          ),
        );

      const openWorkOrders = {
        planned: woByStatus["planned"] ?? 0,
        released: woByStatus["released"] ?? 0,
        inProgress: woByStatus["in_progress"] ?? 0,
        onHold: woByStatus["on_hold"] ?? 0,
        /** Completed within the last 7 days. */
        completed: completedRecentRow?.value ?? 0,
      };

      const wipRows = await tx
        .select({
          workCenter: routingOperations.workCenter,
          qtyOpsInProgress: count(),
        })
        .from(workOrderOperations)
        .innerJoin(
          workOrders,
          eq(workOrders.id, workOrderOperations.workOrderId),
        )
        .innerJoin(
          routingOperations,
          eq(routingOperations.id, workOrderOperations.routingOperationId),
        )
        .where(
          and(
            eq(workOrders.status, "in_progress"),
            isNotNull(workOrderOperations.startedAt),
            isNull(workOrderOperations.completedAt),
          ),
        )
        .groupBy(routingOperations.workCenter)
        .orderBy(desc(count()));

      const wipByWorkCenter = wipRows.map((row) => ({
        workCenter: row.workCenter ?? "Unassigned",
        qtyOpsInProgress: Number(row.qtyOpsInProgress),
      }));

      const [execAgg] = await tx
        .select({
          throughput7d: sql<number>`coalesce(sum(case when ${operationExecutions.performedAt} >= now() - interval '7 days' then ${operationExecutions.qtyGood} else 0 end), 0)::int`,
          throughput30d: sql<number>`coalesce(sum(${operationExecutions.qtyGood}), 0)::int`,
          scrap7d: sql<number>`coalesce(sum(case when ${operationExecutions.performedAt} >= now() - interval '7 days' then ${operationExecutions.qtyScrap} else 0 end), 0)::int`,
        })
        .from(operationExecutions)
        .where(
          gte(
            operationExecutions.performedAt,
            sql`now() - interval '30 days'`,
          ),
        );

      const throughput7d = Number(execAgg?.throughput7d ?? 0);
      const throughput30d = Number(execAgg?.throughput30d ?? 0);
      const scrap7d = Number(execAgg?.scrap7d ?? 0);
      const firstPassYield7d =
        throughput7d + scrap7d > 0
          ? throughput7d / (throughput7d + scrap7d)
          : null;

      const ncPhaseRows = await tx
        .select({
          status: nonconformances.status,
          value: count(),
        })
        .from(nonconformances)
        .where(ne(nonconformances.status, "closure"))
        .groupBy(nonconformances.status);

      const openNcsByPhase = Object.fromEntries(
        NC_STATUSES.filter((s) => s !== "closure").map((s) => [s, 0]),
      ) as Record<Exclude<NcStatus, "closure">, number>;
      for (const row of ncPhaseRows) {
        if (row.status !== "closure") {
          openNcsByPhase[row.status as Exclude<NcStatus, "closure">] =
            row.value;
        }
      }

      const [ncAgingRow] = await tx
        .select({ value: count() })
        .from(nonconformances)
        .where(
          and(
            ne(nonconformances.status, "closure"),
            lt(nonconformances.createdAt, sql`now() - interval '7 days'`),
          ),
        );

      const [capaDueSoonRow] = await tx
        .select({ value: count() })
        .from(capas)
        .where(
          and(
            ne(capas.status, "closed"),
            isNotNull(capas.dueAt),
            gte(capas.dueAt, sql`now()`),
            lte(capas.dueAt, sql`now() + interval '7 days'`),
          ),
        );

      const [capaOverdueRow] = await tx
        .select({ value: count() })
        .from(capas)
        .where(
          and(
            ne(capas.status, "closed"),
            isNotNull(capas.dueAt),
            lt(capas.dueAt, sql`now()`),
          ),
        );

      const ncAging = ncAgingRow?.value ?? 0;
      const capaDueSoon = capaDueSoonRow?.value ?? 0;
      const capaOverdue = capaOverdueRow?.value ?? 0;

      return {
        counts: {
          parts: partsCountRow?.value ?? 0,
          inProgressSheets: inProgressRow?.value ?? 0,
          completedSheets: completedRow?.value ?? 0,
          pendingDocumentApprovals,
          pendingChangeOrderApprovals,
          openChangeOrders: openChangeOrdersRow?.value ?? 0,
          documentsInReview: documentsInReviewRow?.value ?? 0,
          openWorkOrders,
          throughput7d,
          throughput30d,
          scrap7d,
          firstPassYield7d,
          openNcsByPhase,
          ncAging,
          capaDueSoon,
          capaOverdue,
        },
        /** WIP ops in progress grouped by work center. */
        wipByWorkCenter,
        /** Richer MES arrays for charts / shop-floor widgets. */
        mes: {
          wipByWorkCenter,
          openWorkOrdersByStatus: [
            { status: "planned" as const, count: openWorkOrders.planned },
            { status: "released" as const, count: openWorkOrders.released },
            {
              status: "in_progress" as const,
              count: openWorkOrders.inProgress,
            },
            { status: "on_hold" as const, count: openWorkOrders.onHold },
            {
              status: "completed" as const,
              count: openWorkOrders.completed,
              window: "7d" as const,
            },
          ],
          openNcsByPhase: NC_STATUSES.filter((s) => s !== "closure").map(
            (status) => ({
              status,
              count: openNcsByPhase[status],
            }),
          ),
          throughput: {
            good7d: throughput7d,
            good30d: throughput30d,
            scrap7d,
            firstPassYield7d,
          },
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
