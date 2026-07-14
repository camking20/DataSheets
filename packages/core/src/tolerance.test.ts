import { describe, expect, it } from "vitest";
import { evaluateDisposition, isInSpec } from "./tolerance.js";
import { computeCapability, roundCapability } from "./capability.js";
import { buildPiecePlan, flattenPiecePlan, generateSampleIndices } from "./sampling.js";
import { CreateDataSheetSchema, CreateDimensionSchema, normalizeWarningFraction, RecordMeasurementSchema } from "./schemas.js";

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

describe("CreateDataSheetSchema", () => {
  it("rejects lotSize above 10000", () => {
    const result = CreateDataSheetSchema.safeParse({
      partNumber: "PN-1",
      lotNumber: "L1",
      lotSize: 10001,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Lot size cannot exceed 10,000",
      );
    }
  });

  it("accepts lotSize at the max", () => {
    const result = CreateDataSheetSchema.safeParse({
      partNumber: "PN-1",
      lotNumber: "L1",
      lotSize: 10000,
    });
    expect(result.success).toBe(true);
  });
});

describe("RecordMeasurementSchema", () => {
  const base = {
    dataSheetId: "00000000-0000-4000-8000-000000000001",
    dimensionId: "00000000-0000-4000-8000-000000000002",
    sampleIndex: 0,
    value: 1.0,
  };

  it("rejects non-finite measurement values", () => {
    for (const value of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = RecordMeasurementSchema.safeParse({ ...base, value });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (i) => i.message === "Measurement must be a finite number",
          ),
        ).toBe(true);
      }
    }
    // NaN is rejected by z.number() before .finite()
    expect(RecordMeasurementSchema.safeParse({ ...base, value: Number.NaN }).success).toBe(
      false,
    );
  });

  it("rejects sampleIndex above 10000", () => {
    const result = RecordMeasurementSchema.safeParse({
      ...base,
      sampleIndex: 10001,
    });
    expect(result.success).toBe(false);
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

  it("returns red out of spec (exclusive of interior)", () => {
    expect(evaluateDisposition(1.011, config)).toBe("red");
    expect(evaluateDisposition(0.989, config)).toBe("red");
  });

  it("treats limits as inclusive OOT", () => {
    expect(evaluateDisposition(1.01, config)).toBe("red");
    expect(evaluateDisposition(0.99, config)).toBe("red");
    expect(isInSpec(1.01, config)).toBe(false);
    expect(isInSpec(0.99, config)).toBe(false);
  });

  it("rejects non-finite values", () => {
    expect(() => evaluateDisposition(Number.NaN, config)).toThrow(/finite/);
    expect(() => evaluateDisposition(Number.POSITIVE_INFINITY, config)).toThrow(
      /finite/,
    );
    expect(() => evaluateDisposition(Number.NEGATIVE_INFINITY, config)).toThrow(
      /finite/,
    );
  });

  it("warningFraction 0: any off-nominal in-spec is yellow", () => {
    const wf0 = { ...config, warningFraction: 0 };
    expect(evaluateDisposition(1.0, wf0)).toBe("green");
    expect(evaluateDisposition(1.001, wf0)).toBe("yellow");
    expect(evaluateDisposition(0.999, wf0)).toBe("yellow");
  });

  it("warningFraction 1: yellow band disappears", () => {
    const wf1 = { ...config, warningFraction: 1 };
    expect(evaluateDisposition(1.009, wf1)).toBe("green");
    expect(evaluateDisposition(0.991, wf1)).toBe("green");
    expect(evaluateDisposition(1.01, wf1)).toBe("red");
  });

  it("handles unilateral USL", () => {
    const uni = { nominal: 0, usl: 0.005, lsl: null, warningFraction: 0.75 };
    expect(evaluateDisposition(0.001, uni)).toBe("green");
    expect(evaluateDisposition(0.004, uni)).toBe("yellow");
    expect(evaluateDisposition(0.005, uni)).toBe("red"); // inclusive
    expect(evaluateDisposition(0.006, uni)).toBe("red");
  });
});

describe("computeCapability", () => {
  const bilateral = {
    nominal: 1,
    usl: 1.01,
    lsl: 0.99,
    warningFraction: 0.75,
  };

  it("computes overall Pp/Ppk (aliases cp/cpk) for bilateral tolerance", () => {
    const values = [0.998, 1.0, 1.002, 0.999, 1.001];
    const result = computeCapability(values, bilateral);
    expect(result.n).toBe(5);
    expect(result.mean).toBeCloseTo(1.0, 2);
    expect(result.method).toBe("overall_sample_stddev");
    expect(result.zeroVariation).toBe(false);
    expect(result.pp).not.toBeNull();
    expect(result.ppk).not.toBeNull();
    expect(result.pp!).toBeGreaterThan(1);
    // Deprecated aliases match overall indices
    expect(result.cp).toBe(result.pp);
    expect(result.cpk).toBe(result.ppk);
  });

  it("sets zeroVariation and null indices when stddev is 0 and all in-spec", () => {
    const values = [1.0, 1.0, 1.0, 1.0];
    const result = computeCapability(values, bilateral);
    expect(result.stdDev).toBe(0);
    expect(result.zeroVariation).toBe(true);
    expect(result.pp).toBeNull();
    expect(result.ppk).toBeNull();
    expect(result.cp).toBeNull();
    expect(result.cpk).toBeNull();
    expect(result.method).toBe("overall_sample_stddev");
  });

  it("does not set zeroVariation when constant OOT values", () => {
    const values = [1.02, 1.02, 1.02];
    const result = computeCapability(values, bilateral);
    expect(result.stdDev).toBe(0);
    expect(result.zeroVariation).toBe(false);
    expect(result.pp).toBeNull();
    expect(result.ppk).toBeNull();
  });

  it("roundCapability preserves method, zeroVariation, and aliases", () => {
    const result = roundCapability(
      computeCapability([0.998, 1.0, 1.002, 0.999, 1.001], bilateral),
    );
    expect(result.method).toBe("overall_sample_stddev");
    expect(result.cp).toBe(result.pp);
    expect(result.cpk).toBe(result.ppk);
  });
});

describe("generateSampleIndices", () => {
  it("every_n_parts always includes first and last", () => {
    expect(generateSampleIndices(10, { type: "every_n_parts", n: 5 })).toEqual([
      0, 5, 9,
    ]);
  });

  it("every_n_parts with step that already hits last", () => {
    expect(generateSampleIndices(10, { type: "every_n_parts", n: 3 })).toEqual([
      0, 3, 6, 9,
    ]);
  });

  it("sample_size_per_lot uses inclusive endpoints and includes last", () => {
    expect(
      generateSampleIndices(10, { type: "sample_size_per_lot", n: 5 }),
    ).toEqual([0, 2, 5, 7, 9]);
  });

  it("sample_size_per_lot returns requested count when possible", () => {
    expect(
      generateSampleIndices(100, { type: "sample_size_per_lot", n: 5 }).length,
    ).toBe(5);
    expect(
      generateSampleIndices(100, { type: "sample_size_per_lot", n: 5 }),
    ).toEqual([0, 25, 50, 74, 99]);
  });

  it("sample_size_per_lot count=1 still keeps first and last", () => {
    expect(
      generateSampleIndices(10, { type: "sample_size_per_lot", n: 1 }),
    ).toEqual([0, 9]);
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
    // every_n=2 depth on even pieces + last; flat on inclusive samples [0,2,5,7,9]
    const piece1 = plan.find((p) => p.pieceIndex === 1);
    expect(piece1?.dimensionIds).toEqual(["od"]);
    const piece2 = plan.find((p) => p.pieceIndex === 2);
    expect(piece2?.dimensionIds).toEqual(["od", "flat", "depth"]);
    // last piece always measured for every_n depth
    const piece9 = plan.find((p) => p.pieceIndex === 9);
    expect(piece9?.dimensionIds).toEqual(["od", "flat", "depth"]);
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
