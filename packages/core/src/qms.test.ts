import { describe, expect, it } from "vitest";
import {
  assertChangeOrderTransition,
  assertDocumentRevisionTransition,
  assertSegregationOfDuties,
  canSignMeaning,
  canTransitionChangeOrder,
  canTransitionDocumentRevision,
  ChangeOrderStatusSchema,
  DocumentRevisionStatusSchema,
  DocumentTypeSchema,
  DocNumberPrefixSchema,
  requiredSignaturesForDocumentRelease,
  SignatureMeaningSchema,
} from "./qms.js";

describe("QMS zod enums", () => {
  it("parses document types", () => {
    expect(DocumentTypeSchema.parse("drw")).toBe("drw");
    expect(DocumentTypeSchema.safeParse("eco").success).toBe(false);
  });

  it("parses revision statuses", () => {
    for (const s of [
      "draft",
      "in_review",
      "released",
      "superseded",
      "obsolete",
    ] as const) {
      expect(DocumentRevisionStatusSchema.parse(s)).toBe(s);
    }
  });

  it("parses signature meanings and CO statuses", () => {
    expect(SignatureMeaningSchema.parse("change_approval_qa")).toBe(
      "change_approval_qa",
    );
    expect(ChangeOrderStatusSchema.parse("implemented")).toBe("implemented");
    expect(DocNumberPrefixSchema.parse("CAPA")).toBe("CAPA");
  });
});

describe("document revision transitions", () => {
  it("allows the happy path and reject-to-draft", () => {
    expect(canTransitionDocumentRevision("draft", "in_review")).toBe(true);
    expect(canTransitionDocumentRevision("in_review", "draft")).toBe(true);
    expect(canTransitionDocumentRevision("in_review", "released")).toBe(true);
    expect(canTransitionDocumentRevision("released", "superseded")).toBe(true);
  });

  it("allows any non-obsolete status to become obsolete", () => {
    for (const from of [
      "draft",
      "in_review",
      "released",
      "superseded",
    ] as const) {
      expect(canTransitionDocumentRevision(from, "obsolete")).toBe(true);
    }
    expect(canTransitionDocumentRevision("obsolete", "draft")).toBe(false);
  });

  it("rejects invalid transitions", () => {
    expect(canTransitionDocumentRevision("draft", "released")).toBe(false);
    expect(canTransitionDocumentRevision("released", "in_review")).toBe(false);
    expect(canTransitionDocumentRevision("superseded", "released")).toBe(false);
    expect(canTransitionDocumentRevision("draft", "draft")).toBe(false);
  });

  it("assertDocumentRevisionTransition throws on invalid", () => {
    expect(() =>
      assertDocumentRevisionTransition("draft", "released"),
    ).toThrow(/Invalid document revision transition/);
    expect(() =>
      assertDocumentRevisionTransition("in_review", "released"),
    ).not.toThrow();
  });
});

describe("change order transitions", () => {
  it("allows review → approved|rejected and approved → implemented", () => {
    expect(canTransitionChangeOrder("draft", "in_review")).toBe(true);
    expect(canTransitionChangeOrder("in_review", "approved")).toBe(true);
    expect(canTransitionChangeOrder("in_review", "rejected")).toBe(true);
    expect(canTransitionChangeOrder("approved", "implemented")).toBe(true);
  });

  it("allows draft cancel via rejected", () => {
    expect(canTransitionChangeOrder("draft", "rejected")).toBe(true);
  });

  it("treats rejected and implemented as terminal", () => {
    expect(canTransitionChangeOrder("rejected", "draft")).toBe(false);
    expect(canTransitionChangeOrder("rejected", "in_review")).toBe(false);
    expect(canTransitionChangeOrder("implemented", "approved")).toBe(false);
  });

  it("assertChangeOrderTransition throws on invalid", () => {
    expect(() => assertChangeOrderTransition("draft", "approved")).toThrow(
      /Invalid change order transition/,
    );
  });
});

describe("signature rules", () => {
  it("requires ME and QA for document release", () => {
    expect(requiredSignaturesForDocumentRelease()).toEqual([
      "me_approval",
      "qa_approval",
    ]);
  });

  it("canSignMeaning enforces role eligibility", () => {
    expect(canSignMeaning("engineer", "me_approval")).toBe(true);
    expect(canSignMeaning("engineer", "qa_approval")).toBe(false);
    expect(canSignMeaning("quality", "qa_approval")).toBe(true);
    expect(canSignMeaning("quality", "me_approval")).toBe(false);
    expect(canSignMeaning("admin", "me_approval")).toBe(true);
    expect(canSignMeaning("admin", "qa_approval")).toBe(true);
    expect(canSignMeaning("quality", "disposition")).toBe(true);
    expect(canSignMeaning("quality", "closure")).toBe(true);
    expect(canSignMeaning("engineer", "disposition")).toBe(false);
    expect(canSignMeaning("operator", "me_approval")).toBe(false);
    expect(canSignMeaning("engineer", "change_approval_me")).toBe(true);
    expect(canSignMeaning("quality", "change_approval_qa")).toBe(true);
  });

  it("assertSegregationOfDuties blocks same signer on ME and QA", () => {
    expect(() =>
      assertSegregationOfDuties(
        ["me_approval"],
        "qa_approval",
        "user-1",
        ["user-1"],
      ),
    ).toThrow(/Segregation of duties/);

    expect(() =>
      assertSegregationOfDuties(
        ["qa_approval"],
        "me_approval",
        "user-1",
        ["user-1"],
      ),
    ).toThrow(/Segregation of duties/);

    expect(() =>
      assertSegregationOfDuties(
        ["change_approval_me"],
        "change_approval_qa",
        "user-1",
        ["user-1"],
      ),
    ).toThrow(/Segregation of duties/);
  });

  it("allows different signers for ME and QA", () => {
    expect(() =>
      assertSegregationOfDuties(
        ["me_approval"],
        "qa_approval",
        "user-qa",
        ["user-me"],
      ),
    ).not.toThrow();
  });

  it("allows same signer for non-conflicting meanings", () => {
    expect(() =>
      assertSegregationOfDuties(
        ["disposition"],
        "closure",
        "user-1",
        ["user-1"],
      ),
    ).not.toThrow();

    expect(() =>
      assertSegregationOfDuties(
        ["me_approval"],
        "me_approval",
        "user-1",
        ["user-1"],
      ),
    ).not.toThrow();
  });

  it("rejects mismatched parallel arrays", () => {
    expect(() =>
      assertSegregationOfDuties(["me_approval"], "qa_approval", "u1", []),
    ).toThrow(/same length/);
  });
});
