import { and, eq } from "drizzle-orm";
import { formatNumber } from "@datasheets/core";
import { numberCounters, type DbTx } from "@datasheets/db";

/** Controlled document type → allocated number prefix. */
export const DOC_TYPE_PREFIX = {
  drw: "DRW",
  pro: "PRO",
  wi: "WI",
  frm: "FRM",
} as const;

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  if (e.code === "23505" || e.cause?.code === "23505") return true;
  const msg = e.message ?? "";
  return /unique|duplicate/i.test(msg);
}

/**
 * Atomically allocate the next document number for a company + prefix.
 * Uses SELECT … FOR UPDATE on `number_counters`, then insert or increment.
 * On first-insert unique violation (concurrent first allocation), retries once
 * with SELECT … FOR UPDATE + increment.
 *
 * Prefixes in use: DRW, PRO, WI, FRM, CO (any string accepted for future WO/NC/CAPA).
 */
export async function nextNumber(
  tx: DbTx,
  companyId: string,
  prefix: string,
): Promise<string> {
  const [existing] = await tx
    .select()
    .from(numberCounters)
    .where(
      and(
        eq(numberCounters.companyId, companyId),
        eq(numberCounters.prefix, prefix),
      ),
    )
    .for("update");

  let n: number;
  if (!existing) {
    n = 1;
    try {
      await tx.insert(numberCounters).values({
        companyId,
        prefix,
        lastValue: n,
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Concurrent first insert won — lock the row and take the next value.
      const [row] = await tx
        .select()
        .from(numberCounters)
        .where(
          and(
            eq(numberCounters.companyId, companyId),
            eq(numberCounters.prefix, prefix),
          ),
        )
        .for("update");
      if (!row) throw err;
      n = row.lastValue + 1;
      await tx
        .update(numberCounters)
        .set({ lastValue: n })
        .where(
          and(
            eq(numberCounters.companyId, companyId),
            eq(numberCounters.prefix, prefix),
          ),
        );
    }
  } else {
    n = existing.lastValue + 1;
    await tx
      .update(numberCounters)
      .set({ lastValue: n })
      .where(
        and(
          eq(numberCounters.companyId, companyId),
          eq(numberCounters.prefix, prefix),
        ),
      );
  }

  return formatNumber(prefix, n);
}
