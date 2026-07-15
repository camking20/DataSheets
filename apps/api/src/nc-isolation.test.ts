/**
 * NC/CAPA tenant isolation tests.
 * Skips when DATABASE_URL unset or Postgres unreachable locally —
 * fails hard when CI=true or REQUIRE_DB_TESTS=true.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companies,
  nonconformances,
  ncEvents,
  capas,
} from "@datasheets/db";
import { asTenant, db, pgClient } from "./trpc.js";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const requireDb =
  process.env.CI === "true" || process.env.REQUIRE_DB_TESTS === "true";

let dbAvailable = false;
if (hasDatabaseUrl) {
  try {
    await pgClient`select 1`;
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
}

if (!dbAvailable) {
  const detail =
    "[nc-isolation] DATABASE_URL is not set or Postgres is unreachable.";
  if (requireDb) {
    throw new Error(
      `${detail} Refusing to skip because CI/REQUIRE_DB_TESTS is set.`,
    );
  }
  console.warn(`[nc-isolation] Skipping — ${detail}`);
}

describe.skipIf(!dbAvailable)("NC/CAPA tenant isolation (RLS)", () => {
  const suffix = randomUUID().slice(0, 8);
  const companyAId = randomUUID();
  const companyBId = randomUUID();
  let ncAId: string;

  beforeAll(async () => {
    await asTenant(db, companyAId, (tx) =>
      tx.insert(companies).values({
        id: companyAId,
        name: "NC Iso A",
        slug: `nc-a-${suffix}`,
      }),
    );
    await asTenant(db, companyBId, (tx) =>
      tx.insert(companies).values({
        id: companyBId,
        name: "NC Iso B",
        slug: `nc-b-${suffix}`,
      }),
    );

    const [nc] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(nonconformances)
        .values({
          companyId: companyAId,
          ncNumber: `NC-ISO-${suffix}`,
          description: "Isolation NC",
          status: "initiation",
        })
        .returning(),
    );
    ncAId = nc!.id;

    await asTenant(db, companyAId, (tx) =>
      tx.insert(ncEvents).values({
        companyId: companyAId,
        nonconformanceId: ncAId,
        eventType: "created",
        toStatus: "initiation",
      }),
    );

    await asTenant(db, companyAId, (tx) =>
      tx.insert(capas).values({
        companyId: companyAId,
        capaNumber: `CAPA-ISO-${suffix}`,
        nonconformanceId: ncAId,
        description: "Isolation CAPA",
      }),
    );
  });

  it("company B cannot read company A NCs", async () => {
    const rows = await asTenant(db, companyBId, (tx) =>
      tx
        .select()
        .from(nonconformances)
        .where(eq(nonconformances.companyId, companyAId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("company B cannot read company A nc_events", async () => {
    const rows = await asTenant(db, companyBId, (tx) =>
      tx.select().from(ncEvents).where(eq(ncEvents.companyId, companyAId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("company B cannot read company A CAPAs", async () => {
    const rows = await asTenant(db, companyBId, (tx) =>
      tx.select().from(capas).where(eq(capas.companyId, companyAId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("company A can read its NC", async () => {
    const rows = await asTenant(db, companyAId, (tx) =>
      tx
        .select()
        .from(nonconformances)
        .where(eq(nonconformances.id, ncAId)),
    );
    expect(rows).toHaveLength(1);
  });
});
