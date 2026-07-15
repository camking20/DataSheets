/**
 * Tenant isolation tests for QMS tables (documents, revisions, files,
 * signatures, change orders).
 *
 * Prefer DATABASE_URL as datasheets_runtime (the API role):
 *   postgresql://datasheets_runtime:datasheets_runtime@localhost:5432/datasheets
 *
 * Requires QMS migrations applied (`0008_qms_documents.sql`).
 * If DATABASE_URL is unset or Postgres is unreachable, the suite is skipped
 * locally — but fails hard when CI=true or REQUIRE_DB_TESTS=true.
 *
 * Fixture setup uses asTenant (datasheets_app) — not withBypassRls.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  asAppRole,
  changeOrderItems,
  changeOrders,
  companies,
  documentRevisions,
  documents,
  files,
  signatures,
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
    "[qms-isolation.test] DATABASE_URL is not set or Postgres is unreachable. " +
    "Run against datasheets_runtime to verify RLS.";
  if (requireDb) {
    throw new Error(
      `${detail} Refusing to skip because CI/REQUIRE_DB_TESTS is set.`,
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[qms-isolation.test] Skipping QMS tenant isolation tests — ${detail}`,
  );
}

describe.skipIf(!dbAvailable)("QMS tenant isolation (RLS)", () => {
  const suffix = randomUUID().slice(0, 8);
  const companyAId = randomUUID();
  const companyBId = randomUUID();

  let fileAId: string;
  let documentAId: string;
  let revisionAId: string;
  let signatureAId: string;
  let changeOrderAId: string;
  let changeOrderItemAId: string;
  let signerAId: string;

  beforeAll(async () => {
    await asTenant(db, companyAId, (tx) =>
      tx.insert(companies).values({
        id: companyAId,
        name: "QMS Isolation Co A",
        slug: `qms-iso-a-${suffix}`,
      }),
    );
    await asTenant(db, companyBId, (tx) =>
      tx.insert(companies).values({
        id: companyBId,
        name: "QMS Isolation Co B",
        slug: `qms-iso-b-${suffix}`,
      }),
    );

    const [signer] = await asAppRole(db, (tx) =>
      tx
        .insert(users)
        .values({
          email: `qms-iso-${suffix}@test.local`,
          name: "Isolation ME",
          emailVerified: true,
        })
        .returning(),
    );
    signerAId = signer!.id;

    const [file] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(files)
        .values({
          companyId: companyAId,
          storageKey: `qms-iso/${suffix}/drawing.pdf`,
          sha256: "a".repeat(64),
          mimeType: "application/pdf",
          kind: "pdf",
          originalName: "drawing.pdf",
        })
        .returning(),
    );
    fileAId = file!.id;

    const [doc] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(documents)
        .values({
          companyId: companyAId,
          docNumber: `DRW-${suffix}`,
          docType: "drw",
          title: "Isolation test drawing",
        })
        .returning(),
    );
    documentAId = doc!.id;

    const [rev] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(documentRevisions)
        .values({
          companyId: companyAId,
          documentId: documentAId,
          rev: "A",
          status: "draft",
          pdfFileId: fileAId,
        })
        .returning(),
    );
    revisionAId = rev!.id;

    const [sig] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(signatures)
        .values({
          companyId: companyAId,
          entityType: "document_revision",
          entityId: revisionAId,
          meaning: "me_approval",
          signerId: signerAId,
          signerName: "Isolation ME",
          contentSha256: "b".repeat(64),
        })
        .returning(),
    );
    signatureAId = sig!.id;

    const [co] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(changeOrders)
        .values({
          companyId: companyAId,
          coNumber: `CO-${suffix}`,
          title: "Isolation CO",
          description: "Change order for isolation test",
          reason: "Verify RLS",
          status: "draft",
        })
        .returning(),
    );
    changeOrderAId = co!.id;

    const [item] = await asTenant(db, companyAId, (tx) =>
      tx
        .insert(changeOrderItems)
        .values({
          companyId: companyAId,
          changeOrderId: changeOrderAId,
          documentRevisionId: revisionAId,
          notes: "Rev A",
        })
        .returning(),
    );
    changeOrderItemAId = item!.id;
  });

  afterAll(async () => {
    // Signatures are append-only for datasheets_app (no DELETE policy).
    await asTenant(db, companyAId, (tx) =>
      tx
        .delete(changeOrderItems)
        .where(eq(changeOrderItems.companyId, companyAId)),
    );
    await asTenant(db, companyAId, (tx) =>
      tx.delete(changeOrders).where(eq(changeOrders.companyId, companyAId)),
    );
    await asTenant(db, companyAId, (tx) =>
      tx
        .delete(documentRevisions)
        .where(eq(documentRevisions.companyId, companyAId)),
    );
    await asTenant(db, companyAId, (tx) =>
      tx.delete(documents).where(eq(documents.companyId, companyAId)),
    );
    // files are append-only for datasheets_app after 0011_immutability (no DELETE).
  });

  it("does not let company B see company A's files", async () => {
    const rows = await asTenant(db, companyBId, (tx) =>
      tx.select().from(files).where(eq(files.id, fileAId)),
    );
    expect(rows).toHaveLength(0);

    const listed = await asTenant(db, companyBId, (tx) =>
      tx.select().from(files),
    );
    expect(listed.find((f) => f.id === fileAId)).toBeUndefined();
  });

  it("lets company A see its own file", async () => {
    const rows = await asTenant(db, companyAId, (tx) =>
      tx.select().from(files).where(eq(files.id, fileAId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.storageKey).toBe(`qms-iso/${suffix}/drawing.pdf`);
  });

  it("does not let company B see company A's documents", async () => {
    const rows = await asTenant(db, companyBId, (tx) =>
      tx.select().from(documents).where(eq(documents.id, documentAId)),
    );
    expect(rows).toHaveLength(0);

    const listed = await asTenant(db, companyBId, (tx) =>
      tx.select().from(documents),
    );
    expect(listed.find((d) => d.id === documentAId)).toBeUndefined();
  });

  it("lets company A see its own document", async () => {
    const rows = await asTenant(db, companyAId, (tx) =>
      tx.select().from(documents).where(eq(documents.id, documentAId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.docNumber).toBe(`DRW-${suffix}`);
  });

  it("does not let company B see company A's document revisions", async () => {
    const rows = await asTenant(db, companyBId, (tx) =>
      tx
        .select()
        .from(documentRevisions)
        .where(eq(documentRevisions.id, revisionAId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("does not let company B see company A's signatures", async () => {
    const rows = await asTenant(db, companyBId, (tx) =>
      tx.select().from(signatures).where(eq(signatures.id, signatureAId)),
    );
    expect(rows).toHaveLength(0);

    const byEntity = await asTenant(db, companyBId, (tx) =>
      tx
        .select()
        .from(signatures)
        .where(eq(signatures.entityId, revisionAId)),
    );
    expect(byEntity).toHaveLength(0);
  });

  it("lets company A see its own signature", async () => {
    const rows = await asTenant(db, companyAId, (tx) =>
      tx.select().from(signatures).where(eq(signatures.id, signatureAId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.meaning).toBe("me_approval");
    expect(rows[0]?.signerId).toBe(signerAId);
  });

  it("does not let company B see company A's change orders", async () => {
    const rows = await asTenant(db, companyBId, (tx) =>
      tx.select().from(changeOrders).where(eq(changeOrders.id, changeOrderAId)),
    );
    expect(rows).toHaveLength(0);

    const listed = await asTenant(db, companyBId, (tx) =>
      tx.select().from(changeOrders),
    );
    expect(listed.find((c) => c.id === changeOrderAId)).toBeUndefined();
  });

  it("lets company A see its own change order", async () => {
    const rows = await asTenant(db, companyAId, (tx) =>
      tx.select().from(changeOrders).where(eq(changeOrders.id, changeOrderAId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.coNumber).toBe(`CO-${suffix}`);
  });

  it("does not let company B see company A's change order items", async () => {
    const rows = await asTenant(db, companyBId, (tx) =>
      tx
        .select()
        .from(changeOrderItems)
        .where(eq(changeOrderItems.id, changeOrderItemAId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("rejects cross-tenant inserts into company A's company_id from B", async () => {
    await expect(
      asTenant(db, companyBId, (tx) =>
        tx.insert(documents).values({
          companyId: companyAId,
          docNumber: `DRW-cross-${suffix}`,
          docType: "drw",
          title: "Should fail RLS WITH CHECK",
        }),
      ),
    ).rejects.toThrow();
  });
});
