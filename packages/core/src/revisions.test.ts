import { describe, expect, it } from "vitest";
import { nextRevLetter, pickCurrentRevision } from "./revisions.js";

describe("nextRevLetter", () => {
  it("bumps single letters A→B…Y→Z", () => {
    expect(nextRevLetter("A")).toBe("B");
    expect(nextRevLetter("Y")).toBe("Z");
  });

  it("rolls Z→AA and ZZ→AAA", () => {
    expect(nextRevLetter("Z")).toBe("AA");
    expect(nextRevLetter("ZZ")).toBe("AAA");
  });

  it("bumps within multi-letter revs (AZ→BA)", () => {
    expect(nextRevLetter("AZ")).toBe("BA");
    expect(nextRevLetter("AA")).toBe("AB");
  });

  it("uppercases input", () => {
    expect(nextRevLetter("a")).toBe("B");
    expect(nextRevLetter("az")).toBe("BA");
  });

  it("appends A for non A–Z characters", () => {
    expect(nextRevLetter("1")).toBe("1A");
    expect(nextRevLetter("A1")).toBe("A1A");
  });
});

describe("pickCurrentRevision", () => {
  const t = (iso: string) => new Date(iso);

  it("returns null for empty list", () => {
    expect(pickCurrentRevision([])).toBeNull();
  });

  it("prefers released over newer drafts", () => {
    const revs = [
      { status: "draft", createdAt: t("2024-06-01T00:00:00Z"), id: "d" },
      { status: "released", createdAt: t("2024-01-01T00:00:00Z"), id: "r" },
      { status: "superseded", createdAt: t("2023-01-01T00:00:00Z"), id: "s" },
    ];
    expect(pickCurrentRevision(revs)?.id).toBe("r");
  });

  it("falls back to newest by createdAt when none released", () => {
    const revs = [
      { status: "draft", createdAt: t("2024-01-01T00:00:00Z"), id: "old" },
      { status: "draft", createdAt: t("2024-06-01T00:00:00Z"), id: "new" },
      { status: "superseded", createdAt: t("2024-03-01T00:00:00Z"), id: "mid" },
    ];
    expect(pickCurrentRevision(revs)?.id).toBe("new");
  });

  it("returns the sole revision when only one exists", () => {
    const revs = [
      { status: "draft", createdAt: t("2024-01-01T00:00:00Z"), id: "only" },
    ];
    expect(pickCurrentRevision(revs)?.id).toBe("only");
  });
});
