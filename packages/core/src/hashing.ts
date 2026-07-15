// @ts-expect-error Node builtin; @datasheets/core is Node-only for the API (no @types/node dep).
import { createHash } from "node:crypto";

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

/** SHA-256 hex digest of a UTF-8 string or byte array. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Recursively sort object keys so JSON.stringify is stable across key insertion order.
 * Arrays keep element order (callers should sort id lists when order is insignificant).
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

/** Stable JSON stringify (sorted object keys) then SHA-256. */
export function hashCanonicalJson(value: unknown): string {
  return sha256Hex(JSON.stringify(canonicalize(value)));
}

/**
 * Document signatures bind to the PDF file digest.
 * Normalizes/validates a 64-char hex SHA-256 and returns it as the content hash.
 */
export function hashDocumentRevisionContent(pdfSha256: string): string {
  const normalized = pdfSha256.trim().toLowerCase();
  if (!SHA256_HEX_RE.test(normalized)) {
    throw new Error("pdfSha256 must be a 64-character lowercase hex SHA-256");
  }
  return normalized;
}

export type ChangeOrderContentPayload = {
  id: string;
  coNumber: string;
  title: string | null;
  description: string;
  reason: string;
  status: string;
  itemRevisionIds: string[];
};

export function hashChangeOrderContent(
  payload: ChangeOrderContentPayload,
): string {
  return hashCanonicalJson({
    ...payload,
    itemRevisionIds: [...payload.itemRevisionIds].sort(),
  });
}

export type NcContentPayload = {
  id: string;
  ncNumber: string;
  status: string;
  title: string | null;
  description: string;
  disposition: string | null;
  dispositionNotes: string | null;
  rootCause: string | null;
  containmentActions: string | null;
  riskAnalysis: string | null;
  quantityAffected: number | null;
};

export function hashNcContent(payload: NcContentPayload): string {
  return hashCanonicalJson(payload);
}

export type CapaContentPayload = {
  id: string;
  capaNumber: string;
  status: string;
  title: string | null;
  description: string;
  rootCause: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  effectivenessCheck: string | null;
  actionSummaries: string[];
};

export function hashCapaContent(payload: CapaContentPayload): string {
  return hashCanonicalJson({
    ...payload,
    actionSummaries: [...payload.actionSummaries].sort(),
  });
}
