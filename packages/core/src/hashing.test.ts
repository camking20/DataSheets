import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hashCanonicalJson,
  hashCapaContent,
  hashChangeOrderContent,
  hashDocumentRevisionContent,
  hashNcContent,
  sha256Hex,
} from "./hashing.js";

describe("sha256Hex", () => {
  it("matches node:crypto for strings and bytes", () => {
    const text = "part-11-binding";
    const expected = createHash("sha256").update(text).digest("hex");
    expect(sha256Hex(text)).toBe(expected);
    expect(sha256Hex(new TextEncoder().encode(text))).toBe(expected);
  });
});

describe("hashCanonicalJson", () => {
  it("is stable across object key insertion order", () => {
    const a = hashCanonicalJson({ z: 1, a: { c: 3, b: 2 }, m: [1, 2] });
    const b = hashCanonicalJson({ a: { b: 2, c: 3 }, m: [1, 2], z: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when a nested value changes", () => {
    const base = hashCanonicalJson({ id: "1", title: "A", nested: { x: 1 } });
    const changed = hashCanonicalJson({
      id: "1",
      title: "A",
      nested: { x: 2 },
    });
    expect(base).not.toBe(changed);
  });
});

describe("hashDocumentRevisionContent", () => {
  it("normalizes hex case and returns the PDF digest", () => {
    const hex = "A".repeat(64);
    expect(hashDocumentRevisionContent(hex)).toBe("a".repeat(64));
  });

  it("rejects invalid digests", () => {
    expect(() => hashDocumentRevisionContent("not-a-hash")).toThrow(
      /64-character/,
    );
  });
});

describe("hashChangeOrderContent / hashNcContent", () => {
  const coBase = {
    id: "co-1",
    coNumber: "CO-0001",
    title: "Update drawing",
    description: "Rev B",
    reason: "Customer request",
    status: "in_review",
    itemRevisionIds: ["rev-b", "rev-a"],
  };

  const ncBase = {
    id: "nc-1",
    ncNumber: "NC-0001",
    status: "disposition_planning",
    title: "Dim OOS",
    description: "OD high",
    disposition: "rework" as string | null,
    dispositionNotes: "machine again",
    rootCause: null as string | null,
    containmentActions: "hold lot",
    riskAnalysis: null as string | null,
    quantityAffected: 12 as number | null,
  };

  it("sorts itemRevisionIds so order does not affect the CO hash", () => {
    const h1 = hashChangeOrderContent(coBase);
    const h2 = hashChangeOrderContent({
      ...coBase,
      itemRevisionIds: ["rev-a", "rev-b"],
    });
    expect(h1).toBe(h2);
  });

  it("changes CO hash when fields change", () => {
    const base = hashChangeOrderContent(coBase);
    expect(
      hashChangeOrderContent({ ...coBase, description: "Rev C" }),
    ).not.toBe(base);
    expect(
      hashChangeOrderContent({
        ...coBase,
        itemRevisionIds: ["rev-a", "rev-c"],
      }),
    ).not.toBe(base);
  });

  it("changes NC hash when fields change", () => {
    const base = hashNcContent(ncBase);
    expect(hashNcContent({ ...ncBase, disposition: "scrap" })).not.toBe(base);
    expect(hashNcContent({ ...ncBase, quantityAffected: 99 })).not.toBe(base);
    expect(hashNcContent({ ...ncBase, status: "investigation" })).not.toBe(
      base,
    );
  });

  it("produces distinct hashes for CO vs NC payloads", () => {
    expect(hashChangeOrderContent(coBase)).not.toBe(hashNcContent(ncBase));
  });
});

describe("hashCapaContent", () => {
  it("sorts actionSummaries and changes when content changes", () => {
    const basePayload = {
      id: "capa-1",
      capaNumber: "CAPA-0001",
      status: "verification",
      title: "Fix process",
      description: "Root cause CAPA",
      rootCause: "fixture wear",
      correctiveAction: "replace fixture",
      preventiveAction: "PM schedule",
      effectivenessCheck: "30-day audit",
      actionSummaries: ["b-task", "a-task"],
    };
    const h1 = hashCapaContent(basePayload);
    const h2 = hashCapaContent({
      ...basePayload,
      actionSummaries: ["a-task", "b-task"],
    });
    expect(h1).toBe(h2);
    expect(
      hashCapaContent({
        ...basePayload,
        effectivenessCheck: "60-day audit",
      }),
    ).not.toBe(h1);
  });
});
