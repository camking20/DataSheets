import { z } from "zod";
import type { MembershipRole } from "./schemas.js";

export const DocumentTypeSchema = z.enum(["drw", "pro", "wi", "frm"]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DocumentRevisionStatusSchema = z.enum([
  "draft",
  "in_review",
  "released",
  "superseded",
  "obsolete",
]);
export type DocumentRevisionStatus = z.infer<
  typeof DocumentRevisionStatusSchema
>;

export const SignatureMeaningSchema = z.enum([
  "me_approval",
  "qa_approval",
  "disposition",
  "closure",
  "change_approval_me",
  "change_approval_qa",
]);
export type SignatureMeaning = z.infer<typeof SignatureMeaningSchema>;

export const ChangeOrderStatusSchema = z.enum([
  "draft",
  "in_review",
  "approved",
  "rejected",
  "implemented",
]);
export type ChangeOrderStatus = z.infer<typeof ChangeOrderStatusSchema>;

export const DocNumberPrefixSchema = z.enum([
  "DRW",
  "PRO",
  "WI",
  "FRM",
  "CO",
  "WO",
  "NC",
  "CAPA",
]);
export type DocNumberPrefix = z.infer<typeof DocNumberPrefixSchema>;

const DOCUMENT_REVISION_TRANSITIONS: ReadonlyMap<
  DocumentRevisionStatus,
  ReadonlySet<DocumentRevisionStatus>
> = new Map([
  ["draft", new Set(["in_review", "obsolete"])],
  ["in_review", new Set(["draft", "released", "obsolete"])],
  ["released", new Set(["superseded", "obsolete"])],
  ["superseded", new Set(["obsolete"])],
  ["obsolete", new Set()],
]);

const CHANGE_ORDER_TRANSITIONS: ReadonlyMap<
  ChangeOrderStatus,
  ReadonlySet<ChangeOrderStatus>
> = new Map([
  // draft → rejected = cancel without review
  ["draft", new Set(["in_review", "rejected"])],
  ["in_review", new Set(["approved", "rejected"])],
  ["approved", new Set(["implemented"])],
  ["rejected", new Set()],
  ["implemented", new Set()],
]);

const ME_MEANINGS: ReadonlySet<SignatureMeaning> = new Set([
  "me_approval",
  "change_approval_me",
]);

const QA_MEANINGS: ReadonlySet<SignatureMeaning> = new Set([
  "qa_approval",
  "change_approval_qa",
]);

/** Meanings required before a document revision can be released. */
export function requiredSignaturesForDocumentRelease(): SignatureMeaning[] {
  return ["me_approval", "qa_approval"];
}

export function canTransitionDocumentRevision(
  from: DocumentRevisionStatus,
  to: DocumentRevisionStatus,
): boolean {
  if (from === to) return false;
  return DOCUMENT_REVISION_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertDocumentRevisionTransition(
  from: DocumentRevisionStatus,
  to: DocumentRevisionStatus,
): void {
  if (canTransitionDocumentRevision(from, to)) return;
  throw new Error(
    `Invalid document revision transition: ${from} → ${to}`,
  );
}

export function canTransitionChangeOrder(
  from: ChangeOrderStatus,
  to: ChangeOrderStatus,
): boolean {
  if (from === to) return false;
  return CHANGE_ORDER_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertChangeOrderTransition(
  from: ChangeOrderStatus,
  to: ChangeOrderStatus,
): void {
  if (canTransitionChangeOrder(from, to)) return;
  throw new Error(`Invalid change order transition: ${from} → ${to}`);
}

/**
 * Role eligibility for a signature meaning.
 * - ME meanings: engineer | admin
 * - QA meanings + disposition/closure: quality | admin
 */
export function canSignMeaning(
  role: MembershipRole,
  meaning: SignatureMeaning,
): boolean {
  if (ME_MEANINGS.has(meaning)) {
    return role === "engineer" || role === "admin";
  }
  if (
    QA_MEANINGS.has(meaning) ||
    meaning === "disposition" ||
    meaning === "closure"
  ) {
    return role === "quality" || role === "admin";
  }
  return false;
}

function isMeMeaning(meaning: SignatureMeaning): boolean {
  return ME_MEANINGS.has(meaning);
}

function isQaMeaning(meaning: SignatureMeaning): boolean {
  return QA_MEANINGS.has(meaning);
}

/**
 * Same signer cannot provide both ME and QA approval meanings on one entity.
 * `existingMeanings` and `existingSignerIds` are parallel arrays of prior signatures.
 */
export function assertSegregationOfDuties(
  existingMeanings: readonly SignatureMeaning[],
  newMeaning: SignatureMeaning,
  signerId: string,
  existingSignerIds: readonly string[],
): void {
  if (existingMeanings.length !== existingSignerIds.length) {
    throw new Error(
      "existingMeanings and existingSignerIds must be the same length",
    );
  }

  const newIsMe = isMeMeaning(newMeaning);
  const newIsQa = isQaMeaning(newMeaning);
  if (!newIsMe && !newIsQa) return;

  for (let i = 0; i < existingMeanings.length; i++) {
    if (existingSignerIds[i] !== signerId) continue;
    const prior = existingMeanings[i]!;
    if (newIsMe && isQaMeaning(prior)) {
      throw new Error(
        "Segregation of duties: signer already provided a QA approval on this entity",
      );
    }
    if (newIsQa && isMeMeaning(prior)) {
      throw new Error(
        "Segregation of duties: signer already provided an ME approval on this entity",
      );
    }
  }
}
