import type { DimensionConfig, Disposition } from "./schemas.js";

/**
 * Evaluate a measured value against dimension tolerances.
 *
 * Limits are **inclusive** out-of-tolerance: `value >= usl` or `value <= lsl` → red.
 *
 * Non-finite values (`NaN`, `±Infinity`) throw.
 *
 * Disposition bands:
 * - Red: at or outside USL/LSL (inclusive)
 * - Yellow: in-spec but past `warningFraction` of the way from nominal toward a limit
 * - Green: in-spec and inside the warning band
 *
 * `warningFraction` behavior:
 * - `0` — warning band starts at nominal; any in-spec value strictly off nominal is yellow
 * - `(0, 1)` — yellow between `nominal ± span * warningFraction` and the limit
 * - `1` — warning limit coincides with USL/LSL; yellow band disappears (only green / red)
 */
export function evaluateDisposition(
  value: number,
  config: DimensionConfig,
): Disposition {
  if (!Number.isFinite(value)) {
    throw new Error("evaluateDisposition requires a finite numeric value");
  }

  const { nominal, usl, lsl, warningFraction = 0.75 } = config;

  // Inclusive OOT: on the limit is out of tolerance
  if (usl != null && value >= usl) return "red";
  if (lsl != null && value <= lsl) return "red";

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
