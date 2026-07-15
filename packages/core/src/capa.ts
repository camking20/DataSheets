import { z } from "zod";

/**
 * CAPA workflow statuses (DB `capa_status`).
 * Flow: open → in_progress → verification → closed
 * (closed only via dedicated close path, not status transition).
 */
export const CapaStatusSchema = z.enum([
  "open",
  "in_progress",
  "verification",
  "closed",
]);
export type CapaStatus = z.infer<typeof CapaStatusSchema>;

export const CapaActionStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);
export type CapaActionStatus = z.infer<typeof CapaActionStatusSchema>;

/** Allowed one-step forward transitions (closed only via `close`). */
const CAPA_TRANSITIONS: ReadonlyMap<CapaStatus, ReadonlySet<CapaStatus>> =
  new Map([
    ["open", new Set(["in_progress"])],
    ["in_progress", new Set(["verification"])],
    ["verification", new Set()],
    ["closed", new Set()],
  ]);

/**
 * Whether a CAPA may move from `from` to `to` via status update.
 * Does not allow → closed (use close with effectiveness gates).
 */
export function canTransitionCapa(from: CapaStatus, to: CapaStatus): boolean {
  if (from === to) return false;
  return CAPA_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertCapaTransition(from: CapaStatus, to: CapaStatus): void {
  if (canTransitionCapa(from, to)) return;
  throw new Error(`Invalid CAPA transition: ${from} → ${to}`);
}

export type CapaCloseGateResult = {
  ok: boolean;
  reason?: string;
};

/**
 * Whether a CAPA may be closed.
 * Requires verification status, all actions completed/cancelled, and
 * effectiveness verified.
 */
export function canCloseCapa(
  capa: { status: string },
  actions: { status: string }[],
  hasEffectivenessVerified: boolean,
): CapaCloseGateResult {
  if (capa.status !== "verification") {
    return {
      ok: false,
      reason: `CAPA must be in verification to close (got ${capa.status})`,
    };
  }

  const incomplete = actions.filter(
    (a) => a.status !== "completed" && a.status !== "cancelled",
  );
  if (incomplete.length > 0) {
    return {
      ok: false,
      reason: "All CAPA actions must be completed or cancelled before close",
    };
  }

  if (!hasEffectivenessVerified) {
    return {
      ok: false,
      reason: "Effectiveness must be verified before closing CAPA",
    };
  }

  return { ok: true };
}
