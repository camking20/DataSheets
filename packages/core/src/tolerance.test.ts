import { describe, expect, it } from "vitest";
import { evaluateDisposition } from "./tolerance.js";
import { computeCapability } from "./capability.js";
import { buildPiecePlan, flattenPiecePlan, generateSampleIndices } from "./sampling.js";
import { CreateDimensionSchema, normalizeWarningFraction } from "./schemas.js";

describe("normalizeWarningFraction", () => {
  it("converts percent values to fractions", () => {
    expect(normalizeWarningFraction(75)).toBe(0.75);
    expect(normalizeWarningFraction(100)).toBe(1);
    expect(normalizeWarningFraction(0.75)).toBe(0.75);
    expect(normalizeWarningFraction(0)).toBe(0);
  });

  it("accepts percent through CreateDimensionSchema", () => {
    const parsed = CreateDimensionSchema.parse({
      partRevisionId: "00000000-0000-4000-8000-000000000001",
      name: "OD",
      nominal: 1,
      usl: 1.01,
      lsl: 0.99,
      warningFraction: 75,
    });
    expect(parsed.warningFraction).toBe(0.75);
  });
});

describe("evaluateDisposition", () => {
  const config = {
    nominal: 1.0,
    usl: 1.01,
    lsl: 0.99,
    warningFraction: 0.75,
  };

  it("returns green near nominal", () => {
    expect(evaluateDisposition(1.0, config)).toBe("green");
    expect(evaluateDisposition(1.005, config)).toBe("green");
  });

  it("returns yellow near limit but in spec", () => {
    expect(evaluateDisposition(1.008, config)).toBe("yellow");
    expect(evaluateDisposition(0.992, config)).toBe("yellow");
  });

  it("returns red out of spec", () => {
    expect(evaluateDisposition(1.011, config)).toBe("red");
    expect(evaluateDisposition(0.989, config)).toBe("red");
  });

  it("handles unilateral USL", () => {
    const uni = { nominal: 0, usl: 0.005, lsl: null, warningFraction: 0.75 };
    expect(evaluateDisposition(0.001, uni)).toBe("green");
    expect(evaluateDisposition(0.004, uni)).toBe("yellow");
    expect(evaluateDisposition(0.006, uni)).toBe("red");
  });
});

describe("computeCapability", () => {
  it("computes Cp/Cpk for bilateral tolerance", () => {
    const values = [0.998, 1.0, 1.002, 0.999, 1.001];
    const result = computeCapability(values, {
      nominal: 1,
      usl: 1.01,
      lsl: 0.99,
      warningFraction: 0.75,
    });
    expect(result.n).toBe(5);
    expect(result.mean).toBeCloseTo(1.0, 2);
    expect(result.cp).not.toBeNull();
    expect(result.cpk).not.toBeNull();
    expect(result.cp!).toBeGreaterThan(1);
  });
});

describe("generateSampleIndices", () => {
  it("every_n_parts", () => {
    expect(generateSampleIndices(10, { type: "every_n_parts", n: 5 })).toEqual([
      0, 5,
    ]);
  });

  it("sample_size_per_lot", () => {
    expect(
      generateSampleIndices(100, { type: "sample_size_per_lot", n: 5 }).length,
    ).toBe(5);
  });
});

describe("buildPiecePlan", () => {
  const dims = [
    { id: "od", frequencyType: "every_n_parts" as const, frequencyN: 1 },
    { id: "flat", frequencyType: "sample_size_per_lot" as const, frequencyN: 5 },
    { id: "depth", frequencyType: "every_n_parts" as const, frequencyN: 2 },
  ];

  it("aligns dimensions onto pieces by frequency", () => {
    const plan = buildPiecePlan(10, dims);
    expect(plan[0]).toEqual({
      pieceIndex: 0,
      dimensionIds: ["od", "flat", "depth"],
    });
    // every_n=2 depth only on even pieces; flat only on 5 spaced samples
    const piece1 = plan.find((p) => p.pieceIndex === 1);
    expect(piece1?.dimensionIds).toEqual(["od"]);
    const piece2 = plan.find((p) => p.pieceIndex === 2);
    expect(piece2?.dimensionIds).toEqual(["od", "flat", "depth"]);
  });

  it("returns empty for empty inputs", () => {
    expect(buildPiecePlan(0, dims)).toEqual([]);
    expect(buildPiecePlan(10, [])).toEqual([]);
  });

  it("flattenPiecePlan walks piece-major", () => {
    const flat = flattenPiecePlan(buildPiecePlan(4, dims));
    // First cells should be piece 0 dims, then piece 1, etc.
    expect(flat[0]).toEqual({ pieceIndex: 0, dimensionId: "od" });
    expect(flat[1]).toEqual({ pieceIndex: 0, dimensionId: "flat" });
    expect(flat[2]).toEqual({ pieceIndex: 0, dimensionId: "depth" });
    expect(flat[3]).toEqual({ pieceIndex: 1, dimensionId: "od" });
  });
});
