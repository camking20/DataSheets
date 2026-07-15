import type { SignatureMeaning } from "@datasheets/core";

/** Human-readable labels for every SignatureMeaning (Part 11 signing UI). */
export const MEANING_LABELS: Record<SignatureMeaning, string> = {
  me_approval: "ME approval",
  qa_approval: "QA approval",
  disposition: "Disposition",
  closure: "Closure",
  change_approval_me: "Change approval (ME)",
  change_approval_qa: "Change approval (QA)",
};

export function meaningLabel(meaning: SignatureMeaning): string {
  return MEANING_LABELS[meaning];
}
