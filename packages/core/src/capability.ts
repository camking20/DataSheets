import type { DimensionConfig } from "./schemas.js";
import { isInSpec } from "./tolerance.js";

/**
 * Overall (long-term) process performance indices.
 *
 * These are **Pp / Ppk** computed with the overall sample standard deviation
 * (`method: "overall_sample_stddev"`), not within-subgroup Cp/Cpk.
 *
 * `cp` / `cpk` are deprecated aliases kept equal to `pp` / `ppk` for API
 * compatibility. Prefer `pp` / `ppk` in new code.
 */
export interface CapabilityResult {
  n: number;
  mean: number | null;
  stdDev: number | null;
  /**
   * Overall Pp (long-term). Prefer this over `cp`.
   */
  pp: number | null;
  /**
   * Overall Ppk (long-term). Prefer this over `cpk`.
   */
  ppk: number | null;
  /**
   * @deprecated Alias of `pp` (overall / long-term). Not within-subgroup Cp.
   */
  cp: number | null;
  /**
   * @deprecated Alias of `ppk` (overall / long-term). Not within-subgroup Cpk.
   */
  cpk: number | null;
  /** How the indices were computed. */
  method: "overall_sample_stddev";
  /**
   * True when n≥2, sample stddev is 0, and every value is in-spec.
   * `pp`/`ppk`/`cp`/`cpk` are then `null` so UI can show "∞" or "N/A (zero variation)".
   */
  zeroVariation: boolean;
  percentYellow: number;
  percentRed: number;
}

function sampleStdDev(values: number[], mean: number): number | null {
  if (values.length < 2) return null;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function emptyCapability(): CapabilityResult {
  return {
    n: 0,
    mean: null,
    stdDev: null,
    pp: null,
    ppk: null,
    cp: null,
    cpk: null,
    method: "overall_sample_stddev",
    zeroVariation: false,
    percentYellow: 0,
    percentRed: 0,
  };
}

/**
 * Compute overall (long-term) process performance indices Pp/Ppk for a set of
 * measurements, using the sample standard deviation of all values.
 *
 * Unilateral tolerances fall back to one-sided Ppk.
 *
 * Note: Returned `cp`/`cpk` mirror `pp`/`ppk` for backward compatibility; they
 * are not within-subgroup capability indices.
 */
export function computeCapability(
  values: number[],
  config: DimensionConfig,
  dispositions?: Array<"green" | "yellow" | "red">,
): CapabilityResult {
  const n = values.length;
  if (n === 0) {
    return emptyCapability();
  }

  const mean = values.reduce((a, b) => a + b, 0) / n;
  const stdDev = sampleStdDev(values, mean);

  let pp: number | null = null;
  let ppk: number | null = null;
  let zeroVariation = false;

  if (stdDev != null && stdDev === 0 && n >= 2) {
    const allInSpec = values.every((v) => isInSpec(v, config));
    if (allInSpec) {
      // Perfect repeatability in-spec: indices are conceptually infinite.
      // Return null + flag so UI can render "∞" / "N/A (zero variation)".
      zeroVariation = true;
      pp = null;
      ppk = null;
    }
  } else if (stdDev != null && stdDev > 0) {
    const { usl, lsl } = config;
    if (usl != null && lsl != null) {
      pp = (usl - lsl) / (6 * stdDev);
    }

    const upper = usl != null ? (usl - mean) / (3 * stdDev) : null;
    const lower = lsl != null ? (mean - lsl) / (3 * stdDev) : null;

    if (upper != null && lower != null) {
      ppk = Math.min(upper, lower);
    } else if (upper != null) {
      ppk = upper;
    } else if (lower != null) {
      ppk = lower;
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
    pp,
    ppk,
    // Deprecated aliases — same overall values as pp/ppk
    cp: pp,
    cpk: ppk,
    method: "overall_sample_stddev",
    zeroVariation,
    percentYellow: n > 0 ? (yellow / n) * 100 : 0,
    percentRed: n > 0 ? (red / n) * 100 : 0,
  };
}

export function roundCapability(result: CapabilityResult, digits = 4): CapabilityResult {
  const r = (v: number | null) =>
    v == null ? null : Math.round(v * 10 ** digits) / 10 ** digits;
  const pp = r(result.pp);
  const ppk = r(result.ppk);
  return {
    ...result,
    mean: r(result.mean),
    stdDev: r(result.stdDev),
    pp,
    ppk,
    cp: pp,
    cpk: ppk,
    method: result.method,
    zeroVariation: result.zeroVariation,
    percentYellow: Math.round(result.percentYellow * 100) / 100,
    percentRed: Math.round(result.percentRed * 100) / 100,
  };
}
