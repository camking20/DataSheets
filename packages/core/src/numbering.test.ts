import { describe, expect, it } from "vitest";
import { formatDocNumber, formatNumber, PREFIX_BY_DOC_TYPE } from "./numbering.js";

describe("PREFIX_BY_DOC_TYPE", () => {
  it("maps each document type to its prefix", () => {
    expect(PREFIX_BY_DOC_TYPE).toEqual({
      drw: "DRW",
      pro: "PRO",
      wi: "WI",
      frm: "FRM",
    });
  });
});

describe("formatNumber / formatDocNumber", () => {
  it("pads to width 4 by default", () => {
    expect(formatNumber("DRW", 1)).toBe("DRW-0001");
    expect(formatDocNumber("PRO", 42)).toBe("PRO-0042");
    expect(formatNumber("CO", 0)).toBe("CO-0000");
    expect(formatNumber("CAPA", 1234)).toBe("CAPA-1234");
  });

  it("supports custom width and does not truncate longer values", () => {
    expect(formatNumber("WI", 7, 3)).toBe("WI-007");
    expect(formatNumber("NC", 12345, 4)).toBe("NC-12345");
  });

  it("rejects invalid value or width", () => {
    expect(() => formatNumber("DRW", -1)).toThrow(/non-negative integer/);
    expect(() => formatNumber("DRW", 1.5)).toThrow(/non-negative integer/);
    expect(() => formatNumber("DRW", 1, 0)).toThrow(/positive integer/);
  });
});
