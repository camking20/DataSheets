import { describe, expect, it } from "vitest";
import {
  assertTenantStorageKey,
  buildStorageKey,
  safeFileName,
} from "./keys.js";

describe("safeFileName", () => {
  it("strips path components and unsafe characters", () => {
    expect(safeFileName("../../evil/report (final).pdf")).toBe(
      "report-(final).pdf",
    );
  });

  it("falls back when empty", () => {
    expect(safeFileName("")).toBe("file");
    expect(safeFileName("///")).toBe("file");
  });
});

describe("buildStorageKey", () => {
  it("builds tenant-scoped yyyy/mm keys", () => {
    const key = buildStorageKey(
      "co_abc",
      "Drawing Rev A.pdf",
      new Date("2026-07-14T12:00:00Z"),
    );
    expect(key).toMatch(
      /^co_abc\/2026\/07\/[0-9a-f-]{36}-Drawing-Rev-A\.pdf$/,
    );
  });

  it("rejects unsafe company ids", () => {
    expect(() => buildStorageKey("../x", "a.pdf")).toThrow(/Invalid companyId/);
  });
});

describe("assertTenantStorageKey", () => {
  it("accepts keys under the company prefix", () => {
    expect(() =>
      assertTenantStorageKey(
        "co_abc",
        "co_abc/2026/07/11111111-1111-1111-1111-111111111111-a.pdf",
      ),
    ).not.toThrow();
  });

  it("rejects keys for another company", () => {
    expect(() =>
      assertTenantStorageKey("co_abc", "co_other/2026/07/x.pdf"),
    ).toThrow(/not under tenant prefix/);
  });

  it("rejects prefix substring tricks", () => {
    expect(() =>
      assertTenantStorageKey("co_ab", "co_abc/2026/07/x.pdf"),
    ).toThrow(/not under tenant prefix/);
  });

  it("rejects unsafe company ids", () => {
    expect(() => assertTenantStorageKey("../x", "a.pdf")).toThrow(
      /Invalid companyId/,
    );
  });
});
