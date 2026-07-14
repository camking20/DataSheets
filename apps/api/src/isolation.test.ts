/**
 * Tenant isolation tests for Row-Level Security.
 *
 * These tests require a running Postgres instance with the DataSheets
 * migrations applied (see `pnpm db:migrate`). Set DATABASE_URL to point at
 * it before running `pnpm --filter @datasheets/api test`. If DATABASE_URL is
 * not set, or the database is unreachable, the suite is skipped rather than
 * failing — this lets `pnpm test` succeed in environments without Postgres
 * (e.g. CI stages that only lint/typecheck) while still enforcing isolation
 * whenever a real database is available.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, parts, withBypassRls } from "@datasheets/db";
import { asTenant, db, pgClient } from "./trpc.js";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

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
  // eslint-disable-next-line no-console
  console.warn(
    "[isolation.test] Skipping tenant isolation tests — DATABASE_URL is not set " +
      "or Postgres is unreachable. Run against a real database to verify RLS.",
  );
}

describe.skipIf(!dbAvailable)("tenant isolation (RLS)", () => {
  const suffix = randomUUID().slice(0, 8);
  let companyAId: string;
  let companyBId: string;
  let partAId: string;

  beforeAll(async () => {
    const [companyA] = await withBypassRls(db, (tx) =>
      tx
        .insert(companies)
        .values({ name: "Isolation Test Co A", slug: `iso-a-${suffix}` })
        .returning(),
    );
    const [companyB] = await withBypassRls(db, (tx) =>
      tx
        .insert(companies)
        .values({ name: "Isolation Test Co B", slug: `iso-b-${suffix}` })
        .returning(),
    );
    companyAId = companyA!.id;
    companyBId = companyB!.id;

    const [part] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(parts)
        .values({
          companyId: companyAId,
          partNumber: `ISO-${suffix}`,
          description: "Isolation test part",
        })
        .returning(),
    );
    partAId = part!.id;
  });

  afterAll(async () => {
    await withBypassRls(db, (tx) => tx.delete(companies).where(eq(companies.id, companyAId)));
    await withBypassRls(db, (tx) => tx.delete(companies).where(eq(companies.id, companyBId)));
  });

  it("does not let company B see company A's parts", async () => {
    const rows = await asTenant(db, companyBId, (tx) => tx.select().from(parts));
    expect(rows.find((p) => p.id === partAId)).toBeUndefined();

    const direct = await asTenant(db, companyBId, (tx) =>
      tx.select().from(parts).where(eq(parts.id, partAId)),
    );
    expect(direct).toHaveLength(0);
  });

  it("lets company A see its own part", async () => {
    const rows = await asTenant(db, companyAId, (tx) =>
      tx.select().from(parts).where(eq(parts.id, partAId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.partNumber).toBe(`ISO-${suffix}`);
  });
});
