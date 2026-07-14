import type { DimensionConfig, Disposition } from "./schemas.js";

/**
 * Evaluate a measured value against dimension tolerances.
 *
 * - Red: outside USL/LSL
 * - Yellow: in-spec but past warningFraction of the way from nominal toward a limit
 * - Green: in-spec and inside the warning band
 */
export function evaluateDisposition(
  value: number,
  config: DimensionConfig,
): Disposition {
  const { nominal, usl, lsl, warningFraction = 0.75 } = config;

  if (usl != null && value > usl) return "red";
  if (lsl != null && value < lsl) return "red";

  if (usl != null && value > nominal) {
    const span = usl - nominal;
    if (span > 0) {
      const warningLimit = nominal + span * warningFraction;
      if (value > warningLimit) return "yellow";
    }
  }

  if (lsl != null && value < nominal) {
    const span = nominal - lsl;
    if (span > 0) {
      const warningLimit = nominal - span * warningFraction;
      if (value < warningLimit) return "yellow";
    }
  }

  return "green";
}

export function isInSpec(value: number, config: DimensionConfig): boolean {
  return evaluateDisposition(value, config) !== "red";
}
