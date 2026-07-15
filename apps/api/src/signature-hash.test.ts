/**
 * Unit tests for Part 11 content-binding hashes used by `applySignature`
 * (`apps/api/src/services/signatures.ts`). No DB required.
 *
 * applySignature contract (documented here; DB-backed paths covered elsewhere):
 * 1. Re-auth: verify password against users.passwordHash → UNAUTHORIZED on fail
 * 2. Role gate: canSignMeaning(role, meaning) → FORBIDDEN if ineligible
 * 3. Entity/meaning gate: meaning must be valid for entityType → BAD_REQUEST
 * 4. Content bind: server computes contentSha256 via core hash helpers below;
 *    optional client contentSha256 must match or CONFLICT ("Content changed…")
 * 5. Duplicate meaning on entity → CONFLICT
 * 6. Segregation of duties via assertSegregationOfDuties(signerId=userId) → FORBIDDEN
 * 7. Insert with signerId = input.userId, signerName snapshot, passwordVerified=true
 * 8. Audit log action "signature.apply" with meaning + contentSha256
 *
 * Entity → hash helper:
 * - document_revision → hashDocumentRevisionContent(pdfFile.sha256)
 * - change_order      → hashChangeOrderContent({ id, coNumber, …, itemRevisionIds })
 * - nonconformance    → hashNcContent({ id, ncNumber, status, disposition, … })
 * - capa              → hashCapaContent({ id, capaNumber, …, actionSummaries })
 */
import { describe, expect, it } from "vitest";
import {
  assertSegregationOfDuties,
  canSignMeaning,
  hashCapaContent,
  hashChangeOrderContent,
  hashDocumentRevisionContent,
  hashNcContent,
} from "@datasheets/core";

describe("applySignature content hashes (@datasheets/core)", () => {
  it("binds document revisions to the PDF SHA-256 digest", () => {
    const pdfSha = "c".repeat(64);
    expect(hashDocumentRevisionContent(pdfSha)).toBe(pdfSha);
    expect(hashDocumentRevisionContent(`  ${pdfSha.toUpperCase()}  `)).toBe(
      pdfSha,
    );
    expect(() => hashDocumentRevisionContent("short")).toThrow(/64-character/);
  });

  it("hashes change orders with sorted itemRevisionIds (order-insensitive)", () => {
    const base = {
      id: "co-1",
      coNumber: "CO-100",
      title: "Rev bump",
      description: "Update drawing",
      reason: "Customer request",
      status: "in_review",
      itemRevisionIds: ["rev-b", "rev-a"],
    };
    const h1 = hashChangeOrderContent(base);
    const h2 = hashChangeOrderContent({
      ...base,
      itemRevisionIds: ["rev-a", "rev-b"],
    });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    expect(
      hashChangeOrderContent({ ...base, description: "Different" }),
    ).not.toBe(h1);
  });

  it("hashes NC / CAPA payloads so field changes invalidate prior signatures", () => {
    const nc = {
      id: "nc-1",
      ncNumber: "NC-1",
      status: "disposition",
      title: null,
      description: "Scratch",
      disposition: "rework",
      dispositionNotes: null,
      rootCause: null,
      containmentActions: null,
      riskAnalysis: null,
      quantityAffected: 2,
    };
    const ncHash = hashNcContent(nc);
    expect(hashNcContent({ ...nc, disposition: "scrap" })).not.toBe(ncHash);

    const capa = {
      id: "capa-1",
      capaNumber: "CAPA-1",
      status: "verification",
      title: null,
      description: "Fix process",
      rootCause: "Training",
      correctiveAction: "Retrain",
      preventiveAction: "Checklist",
      effectivenessCheck: null,
      actionSummaries: ["b-done", "a-open"],
    };
    const capaHash = hashCapaContent(capa);
    expect(
      hashCapaContent({
        ...capa,
        actionSummaries: ["a-open", "b-done"],
      }),
    ).toBe(capaHash);
    expect(
      hashCapaContent({ ...capa, correctiveAction: "Different" }),
    ).not.toBe(capaHash);
  });
});

describe("applySignature pre-insert gates (no DB)", () => {
  it("role gate: engineer may ME-sign; quality may QA-sign; operator neither", () => {
    expect(canSignMeaning("engineer", "me_approval")).toBe(true);
    expect(canSignMeaning("engineer", "qa_approval")).toBe(false);
    expect(canSignMeaning("quality", "qa_approval")).toBe(true);
    expect(canSignMeaning("operator", "me_approval")).toBe(false);
  });

  it("SoD gate: same signerId cannot supply both ME and QA on one entity", () => {
    expect(() =>
      assertSegregationOfDuties(
        ["me_approval"],
        "qa_approval",
        "user-a",
        ["user-a"],
      ),
    ).toThrow(/Segregation of duties/);

    expect(() =>
      assertSegregationOfDuties(
        ["me_approval"],
        "qa_approval",
        "user-b",
        ["user-a"],
      ),
    ).not.toThrow();
  });
});
