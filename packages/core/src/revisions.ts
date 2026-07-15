/** Minimal shape for revision selection helpers. */
export type RevisionLike = {
  status: string;
  createdAt: Date;
};

/**
 * Prefer a revision with `status === "released"`; otherwise the newest by
 * `createdAt`. Returns null when the list is empty.
 */
export function pickCurrentRevision<T extends RevisionLike>(
  revs: readonly T[],
): T | null {
  const released = revs.find((r) => r.status === "released");
  if (released) return released;
  if (revs.length === 0) return null;
  return [...revs].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0]!;
}

/** A→B…Z→AA (base-26 letter bump). */
export function nextRevLetter(rev: string): string {
  const chars = rev.toUpperCase().split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    const c = chars[i]!;
    if (c >= "A" && c < "Z") {
      chars[i] = String.fromCharCode(c.charCodeAt(0) + 1);
      return chars.join("");
    }
    if (c === "Z") {
      chars[i] = "A";
      continue;
    }
    return rev.toUpperCase() + "A";
  }
  return "A" + chars.join("");
}
