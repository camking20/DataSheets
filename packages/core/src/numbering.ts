import type { DocumentType } from "./qms.js";
import type { DocNumberPrefix } from "./qms.js";

/** Maps controlled document types to their auto-number prefixes. */
export const PREFIX_BY_DOC_TYPE: Readonly<
  Record<DocumentType, DocNumberPrefix>
> = {
  drw: "DRW",
  pro: "PRO",
  wi: "WI",
  frm: "FRM",
};

/**
 * Format a numbered document id: `DRW-0001`, `CO-0042`, etc.
 * Sequence allocation is DB-side; this only formats.
 */
export function formatNumber(
  prefix: DocNumberPrefix | string,
  value: number,
  width = 4,
): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("formatNumber requires a non-negative integer value");
  }
  if (!Number.isInteger(width) || width < 1) {
    throw new Error("formatNumber width must be a positive integer");
  }
  return `${prefix}-${String(value).padStart(width, "0")}`;
}

/** Alias for {@link formatNumber} — document / QMS number formatting. */
export function formatDocNumber(
  prefix: DocNumberPrefix | string,
  n: number,
  width = 4,
): string {
  return formatNumber(prefix, n, width);
}
