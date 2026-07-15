import { z } from "zod";

/**
 * NC workflow phases (linear-ish).
 * Triage at initiation may close immediately when marked acceptable.
 */
export const NcStatusSchema = z.enum([
  "initiation",
  "containment",
  "disposition_planning",
  "disposition_execution",
  "investigation",
  "closure",
]);
export type NcStatus = z.infer<typeof NcStatusSchema>;

/** Material disposition for an NC (distinct from measurement green/yellow/red). */
export const NcDispositionSchema = z.enum([
  "use_as_is",
  "rework",
  "repair",
  "scrap",
  "return_to_vendor",
]);
export type NcDisposition = z.infer<typeof NcDispositionSchema>;

/** Ordered NC phases for linear forward progress. */
export const NC_STATUS_ORDER: readonly NcStatus[] = [
  "initiation",
  "containment",
  "disposition_planning",
  "disposition_execution",
  "investigation",
  "closure",
] as const;

const NC_TRANSITIONS: ReadonlyMap<NcStatus, ReadonlySet<NcStatus>> = new Map([
  ["initiation", new Set(["containment"])],
  ["containment", new Set(["disposition_planning"])],
  ["disposition_planning", new Set(["disposition_execution"])],
  ["disposition_execution", new Set(["investigation"])],
  ["investigation", new Set(["closure"])],
  ["closure", new Set()],
]);

export type NcTransitionOptions = {
  /**
   * When true, allows initiation → closure (acceptable / no NC path).
   * Ignored for all other transitions.
   */
  acceptable?: boolean;
};

/**
 * Whether an NC may move from `from` to `to`.
 * Forward one phase at a time, plus initiation → closure when `acceptable`.
 */
export function canTransitionNc(
  from: NcStatus,
  to: NcStatus,
  options?: NcTransitionOptions,
): boolean {
  if (from === to) return false;
  if (from === "initiation" && to === "closure") {
    return options?.acceptable === true;
  }
  return NC_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertNcTransition(
  from: NcStatus,
  to: NcStatus,
  options?: NcTransitionOptions,
): void {
  if (canTransitionNc(from, to, options)) return;
  throw new Error(`Invalid NC transition: ${from} → ${to}`);
}

/** Next phase in the linear path, or null if terminal. */
export function nextNcStatus(from: NcStatus): NcStatus | null {
  const i = NC_STATUS_ORDER.indexOf(from);
  if (i < 0 || i >= NC_STATUS_ORDER.length - 1) return null;
  return NC_STATUS_ORDER[i + 1]!;
}

export const NcTriageDecisionSchema = z.enum(["acceptable", "nc", "nc_capa"]);
export type NcTriageDecision = z.infer<typeof NcTriageDecisionSchema>;

export type NcTriageResult = {
  decision: NcTriageDecision;
  isAcceptable: boolean;
  capaRequired: boolean;
  /** Status to move to after triage */
  nextStatus: NcStatus;
};

/**
 * Map engineer triage decision to NC flags + next status.
 * - acceptable → close immediately (initiation → closure)
 * - nc → enter containment (full NC flow)
 * - nc_capa → enter containment and require CAPA
 */
export function resolveNcTriage(decision: NcTriageDecision): NcTriageResult {
  if (decision === "acceptable") {
    return {
      decision,
      isAcceptable: true,
      capaRequired: false,
      nextStatus: "closure",
    };
  }
  return {
    decision,
    isAcceptable: false,
    capaRequired: decision === "nc_capa",
    nextStatus: "containment",
  };
}

export type NcCloseGateResult = {
  ok: boolean;
  reason?: string;
};

function isNonEmptyText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Whether an NC may be closed (investigation → closure).
 * Requires root cause and containment actions; if CAPA is required,
 * all linked CAPAs must be closed (openCapaCount === 0).
 */
export function canCloseNc(input: {
  status: string;
  capaRequired: boolean;
  rootCause?: string | null;
  containmentActions?: string | null;
  openCapaCount: number;
}): NcCloseGateResult {
  if (input.status !== "investigation") {
    return {
      ok: false,
      reason: `NC can only be closed from investigation (got ${input.status})`,
    };
  }

  if (!isNonEmptyText(input.rootCause)) {
    return {
      ok: false,
      reason: "Root cause is required before closing NC",
    };
  }

  if (!isNonEmptyText(input.containmentActions)) {
    return {
      ok: false,
      reason: "Containment actions are required before closing NC",
    };
  }

  if (input.capaRequired && input.openCapaCount > 0) {
    return {
      ok: false,
      reason: `Cannot close NC while ${input.openCapaCount} CAPA(s) remain open`,
    };
  }

  return { ok: true };
}
