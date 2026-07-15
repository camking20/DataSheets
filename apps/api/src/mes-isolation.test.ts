/**
 * MES tenant isolation tests (routings / work orders / executions).
 * Skips when DATABASE_URL unset or Postgres unreachable locally —
 * fails hard when CI=true or REQUIRE_DB_TESTS=true.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  asAppRole,
  companies,
  parts,
  partRevisions,
  routings,
  routingRevisions,
  routingOperations,
  workOrders,
  workOrderOperations,
  operationExecutions,
  users,
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
    "[mes-isolation] DATABASE_URL is not set or Postgres is unreachable.";
  if (requireDb) {
    throw new Error(
      `${detail} Refusing to skip because CI/REQUIRE_DB_TESTS is set.`,
    );
  }
  console.warn(`[mes-isolation] Skipping — ${detail}`);
}

describe.skipIf(!dbAvailable)("MES tenant isolation (RLS)", () => {
  const suffix = randomUUID().slice(0, 8);
  const companyAId = randomUUID();
  const companyBId = randomUUID();
  let partAId: string;
  let routingRevAId: string;
  let wooAId: string;
  let userAId: string;

  beforeAll(async () => {
    await asTenant(db, companyAId, (tx) =>
      tx.insert(companies).values({
        id: companyAId,
        name: "MES Iso A",
        slug: `mes-a-${suffix}`,
      }),
    );
    await asTenant(db, companyBId, (tx) =>
      tx.insert(companies).values({
        id: companyBId,
        name: "MES Iso B",
        slug: `mes-b-${suffix}`,
      }),
    );

    const [user] = await asAppRole(db, (tx) =>
      tx
        .insert(users)
        .values({
          email: `mes-iso-${suffix}@test.local`,
          name: "MES Iso User",
          emailVerified: true,
        })
        .returning(),
    );
    userAId = user!.id;

    const [part] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(parts)
        .values({
          companyId: companyAId,
          partNumber: `MES-${suffix}`,
          description: "iso part",
        })
        .returning(),
    );
    partAId = part!.id;

    const [prev] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(partRevisions)
        .values({
          companyId: companyAId,
          partId: partAId,
          rev: "A",
          status: "released",
        })
        .returning(),
    );

    const [routing] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(routings)
        .values({
          companyId: companyAId,
          partId: partAId,
          name: "Iso routing",
        })
        .returning(),
    );

    const [rrev] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(routingRevisions)
        .values({
          companyId: companyAId,
          routingId: routing!.id,
          rev: "A",
          status: "released",
        })
        .returning(),
    );
    routingRevAId = rrev!.id;

    const [rop] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(routingOperations)
        .values({
          companyId: companyAId,
          routingRevisionId: routingRevAId,
          opNumber: 10,
          name: "Op 10",
        })
        .returning(),
    );

    const [wo] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(workOrders)
        .values({
          companyId: companyAId,
          woNumber: `WO-ISO-${suffix}`,
          partId: partAId,
          partRevisionId: prev!.id,
          routingRevisionId: routingRevAId,
          qty: 10,
          status: "in_progress",
        })
        .returning(),
    );

    const [woo] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(workOrderOperations)
        .values({
          companyId: companyAId,
          workOrderId: wo!.id,
          routingOperationId: rop!.id,
        })
        .returning(),
    );
    wooAId = woo!.id;

    await asTenant(db, companyAId, (tx) =>
      tx.insert(operationExecutions).values({
        companyId: companyAId,
        workOrderOperationId: wooAId,
        qtyGood: 1,
        qtyScrap: 0,
        performedBy: userAId,
      }),
    );
  });

  afterAll(async () => {
    // best-effort cleanup not required; isolated by slug
  });

  it("company B cannot read company A routings", async () => {
    const rows = await asTenant(db, companyBId, (tx) =>
      tx.select().from(routings).where(eq(routings.companyId, companyAId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("company B cannot read company A work orders", async () => {
    const rows = await asTenant(db, companyBId, (tx) =>
      tx.select().from(workOrders).where(eq(workOrders.companyId, companyAId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("company B cannot read company A operation executions", async () => {
    const rows = await asTenant(db, companyBId, (tx) =>
      tx
        .select()
        .from(operationExecutions)
        .where(eq(operationExecutions.companyId, companyAId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("company A can read its own MES rows", async () => {
    const rows = await asTenant(db, companyAId, (tx) =>
      tx
        .select()
        .from(workOrderOperations)
        .where(
          and(
            eq(workOrderOperations.companyId, companyAId),
            eq(workOrderOperations.id, wooAId),
          ),
        ),
    );
    expect(rows).toHaveLength(1);
  });
});
