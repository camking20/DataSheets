/**
 * Tenant isolation tests for Row-Level Security.
 *
 * Prefer DATABASE_URL as datasheets_runtime (the API role):
 *   postgresql://datasheets_runtime:datasheets_runtime@localhost:5432/datasheets
 *
 * Requires migrations applied (`DATABASE_URL=...datasheets... pnpm db:migrate`).
 * If DATABASE_URL is unset or Postgres is unreachable, the suite is skipped
 * locally — but fails hard when CI=true or REQUIRE_DB_TESTS=true.
 *
 * Fixture setup uses asTenant (datasheets_app) — not withBypassRls — so tests work
 * when connected as datasheets_runtime. Auth register must likewise never
 * SET ROLE datasheets_owner.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { companies, parts } from "@datasheets/db";
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
    "[isolation.test] DATABASE_URL is not set or Postgres is unreachable. " +
    "Run against datasheets_runtime to verify RLS.";
  if (requireDb) {
    throw new Error(
      `${detail} Refusing to skip because CI/REQUIRE_DB_TESTS is set.`,
    );
  }
  // eslint-disable-next-line no-console
  console.warn(`[isolation.test] Skipping tenant isolation tests — ${detail}`);
}

describe.skipIf(!dbAvailable)("tenant isolation (RLS)", () => {
  const suffix = randomUUID().slice(0, 8);
  const companyAId = randomUUID();
  const companyBId = randomUUID();
  let partAId: string;
  let connectedAsRuntime = false;

  beforeAll(async () => {
    const [who] = await pgClient<{
      current_user: string;
    }[]>`SELECT current_user`;
    connectedAsRuntime = who?.current_user === "datasheets_runtime";
    if (!connectedAsRuntime) {
      // eslint-disable-next-line no-console
      console.warn(
        `[isolation.test] Connected as "${who?.current_user ?? "?"}" — prefer datasheets_runtime ` +
          "for API-role isolation checks (SET ROLE datasheets_owner must fail).",
      );
    }

    // Create companies as datasheets_app (GUC must match inserted id) — no owner bypass.
    await asTenant(db, companyAId, (tx) =>
      tx.insert(companies).values({
        id: companyAId,
        name: "Isolation Test Co A",
        slug: `iso-a-${suffix}`,
      }),
    );
    await asTenant(db, companyBId, (tx) =>
      tx.insert(companies).values({
        id: companyBId,
        name: "Isolation Test Co B",
        slug: `iso-b-${suffix}`,
      }),
    );

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
    // App role can delete tenant-scoped parts; companies have no DELETE policy for app.
    await asTenant(db, companyAId, (tx) =>
      tx.delete(parts).where(eq(parts.companyId, companyAId)),
    );
    await asTenant(db, companyBId, (tx) =>
      tx.delete(parts).where(eq(parts.companyId, companyBId)),
    );
  });

  it("runtime role cannot SET ROLE datasheets_owner", async () => {
    if (!connectedAsRuntime) {
      // Soft check when not on runtime: membership should not be granted to non-superuser logins.
      // eslint-disable-next-line no-console
      console.warn(
        "[isolation.test] Skipping hard SET ROLE owner denial — not connected as datasheets_runtime.",
      );
      return;
    }

    await expect(pgClient`SET ROLE datasheets_owner`).rejects.toThrow();
    await pgClient`RESET ROLE`;
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
