/**
 * Unit tests for QMS signature segregation and related rules,
 * importing the public API from @datasheets/core.
 */
import { describe, expect, it } from "vitest";
import {
  assertSegregationOfDuties,
  canSignMeaning,
  requiredSignaturesForDocumentRelease,
} from "@datasheets/core";

describe("signature segregation (@datasheets/core)", () => {
  it("requires ME and QA meanings for document release", () => {
    expect(requiredSignaturesForDocumentRelease()).toEqual([
      "me_approval",
      "qa_approval",
    ]);
  });

  it("blocks the same signer from providing both ME and QA approvals", () => {
    expect(() =>
      assertSegregationOfDuties(
        ["me_approval"],
        "qa_approval",
        "signer-1",
        ["signer-1"],
      ),
    ).toThrow(/Segregation of duties/);

    expect(() =>
      assertSegregationOfDuties(
        ["qa_approval"],
        "me_approval",
        "signer-1",
        ["signer-1"],
      ),
    ).toThrow(/Segregation of duties/);
  });

  it("blocks the same signer across change-approval ME/QA meanings", () => {
    expect(() =>
      assertSegregationOfDuties(
        ["change_approval_me"],
        "change_approval_qa",
        "signer-1",
        ["signer-1"],
      ),
    ).toThrow(/Segregation of duties/);
  });

  it("allows different signers for ME and QA", () => {
    expect(() =>
      assertSegregationOfDuties(
        ["me_approval"],
        "qa_approval",
        "qa-user",
        ["me-user"],
      ),
    ).not.toThrow();
  });

  it("allows the same signer for non-conflicting meanings", () => {
    expect(() =>
      assertSegregationOfDuties(
        ["disposition"],
        "closure",
        "signer-1",
        ["signer-1"],
      ),
    ).not.toThrow();

    expect(() =>
      assertSegregationOfDuties(
        ["me_approval"],
        "me_approval",
        "signer-1",
        ["signer-1"],
      ),
    ).not.toThrow();
  });

  it("rejects mismatched meaning/signer parallel arrays", () => {
    expect(() =>
      assertSegregationOfDuties(["me_approval"], "qa_approval", "u1", []),
    ).toThrow(/same length/);
  });
});

describe("signature role eligibility (@datasheets/core)", () => {
  it("restricts ME meanings to engineer|admin and QA meanings to quality|admin", () => {
    expect(canSignMeaning("engineer", "me_approval")).toBe(true);
    expect(canSignMeaning("engineer", "qa_approval")).toBe(false);
    expect(canSignMeaning("quality", "qa_approval")).toBe(true);
    expect(canSignMeaning("quality", "me_approval")).toBe(false);
    expect(canSignMeaning("admin", "me_approval")).toBe(true);
    expect(canSignMeaning("admin", "qa_approval")).toBe(true);
    expect(canSignMeaning("operator", "me_approval")).toBe(false);
    expect(canSignMeaning("operator", "qa_approval")).toBe(false);
  });
});
