import type { DimensionConfig } from "./schemas.js";

export interface CapabilityResult {
  n: number;
  mean: number | null;
  stdDev: number | null;
  cp: number | null;
  cpk: number | null;
  percentYellow: number;
  percentRed: number;
}

function sampleStdDev(values: number[], mean: number): number | null {
  if (values.length < 2) return null;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Compute process capability metrics for a set of measurements.
 * Unilateral tolerances fall back to one-sided Cpk.
 */
export function computeCapability(
  values: number[],
  config: DimensionConfig,
  dispositions?: Array<"green" | "yellow" | "red">,
): CapabilityResult {
  const n = values.length;
  if (n === 0) {
    return {
      n: 0,
      mean: null,
      stdDev: null,
      cp: null,
      cpk: null,
      percentYellow: 0,
      percentRed: 0,
    };
  }

  const mean = values.reduce((a, b) => a + b, 0) / n;
  const stdDev = sampleStdDev(values, mean);

  let cp: number | null = null;
  let cpk: number | null = null;

  if (stdDev != null && stdDev > 0) {
    const { usl, lsl } = config;
    if (usl != null && lsl != null) {
      cp = (usl - lsl) / (6 * stdDev);
    }

    const upper = usl != null ? (usl - mean) / (3 * stdDev) : null;
    const lower = lsl != null ? (mean - lsl) / (3 * stdDev) : null;

    if (upper != null && lower != null) {
      cpk = Math.min(upper, lower);
    } else if (upper != null) {
      cpk = upper;
    } else if (lower != null) {
      cpk = lower;
    }
  }

  let yellow = 0;
  let red = 0;
  if (dispositions) {
    for (const d of dispositions) {
      if (d === "yellow") yellow += 1;
      if (d === "red") red += 1;
    }
  }

  return {
    n,
    mean,
    stdDev,
    cp,
    cpk,
    percentYellow: n > 0 ? (yellow / n) * 100 : 0,
    percentRed: n > 0 ? (red / n) * 100 : 0,
  };
}

export function roundCapability(result: CapabilityResult, digits = 4): CapabilityResult {
  const r = (v: number | null) =>
    v == null ? null : Math.round(v * 10 ** digits) / 10 ** digits;
  return {
    ...result,
    mean: r(result.mean),
    stdDev: r(result.stdDev),
    cp: r(result.cp),
    cpk: r(result.cpk),
    percentYellow: Math.round(result.percentYellow * 100) / 100,
    percentRed: Math.round(result.percentRed * 100) / 100,
  };
}
