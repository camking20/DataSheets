import { z } from "zod";

export const WorkOrderStatusSchema = z.enum([
  "planned",
  "released",
  "in_progress",
  "on_hold",
  "completed",
  "closed",
  "cancelled",
]);
export type WorkOrderStatus = z.infer<typeof WorkOrderStatusSchema>;

export const WoOpDocumentRoleSchema = z.enum(["wi", "drawing", "procedure"]);
export type WoOpDocumentRole = z.infer<typeof WoOpDocumentRoleSchema>;

/**
 * WO transitions:
 * planned → released → in_progress → completed → closed
 * in_progress ↔ on_hold
 * cancelled from any non-terminal (not completed/closed/cancelled)
 */
const WO_TRANSITIONS: ReadonlyMap<
  WorkOrderStatus,
  ReadonlySet<WorkOrderStatus>
> = new Map([
  ["planned", new Set(["released", "cancelled"])],
  ["released", new Set(["in_progress", "cancelled"])],
  ["in_progress", new Set(["on_hold", "completed", "cancelled"])],
  ["on_hold", new Set(["in_progress", "cancelled"])],
  ["completed", new Set(["closed"])],
  ["closed", new Set()],
  ["cancelled", new Set()],
]);

export function canTransitionWorkOrder(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
): boolean {
  if (from === to) return false;
  return WO_TRANSITIONS.get(from)?.has(to) ?? false;
}

export function assertWorkOrderTransition(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
): void {
  if (canTransitionWorkOrder(from, to)) return;
  throw new Error(`Invalid work order transition: ${from} → ${to}`);
}

export type OpProgress = {
  opNumber: number;
  completed: boolean;
  started: boolean;
};

/**
 * An op may start only when every prior op_number is completed.
 * The target op must not already be completed.
 */
export function canStartOperation(
  ops: readonly OpProgress[],
  targetOpNumber: number,
): boolean {
  const target = ops.find((o) => o.opNumber === targetOpNumber);
  if (!target || target.completed) return false;
  return ops
    .filter((o) => o.opNumber < targetOpNumber)
    .every((o) => o.completed);
}

export function assertCanStartOperation(
  ops: readonly OpProgress[],
  targetOpNumber: number,
): void {
  if (canStartOperation(ops, targetOpNumber)) return;
  throw new Error(
    `Cannot start operation ${targetOpNumber}: prior operations incomplete or already done`,
  );
}

export type PriorOpYield = {
  qtyComplete: number;
  qtyScrap: number;
  completed: boolean;
};

/**
 * Yield-chained available quantity for an operation.
 * - First op (no priors): available = woQty
 * - Subsequent: available = immediate prior op's qtyComplete (good only)
 * - If any prior is incomplete: available = 0 (sequencing gated by assertCanStart)
 */
export function availableQtyForOperation(
  woQty: number,
  priorOps: readonly PriorOpYield[],
): number {
  if (!Number.isInteger(woQty) || woQty < 0) return 0;
  if (priorOps.length === 0) return woQty;
  if (priorOps.some((op) => !op.completed)) return 0;
  const previous = priorOps[priorOps.length - 1]!;
  return previous.qtyComplete;
}

export type QtyState = {
  /** Work order total quantity */
  woQty: number;
  /**
   * Max qty that can be processed on this op (yield-chained).
   * First op: equals woQty. Later ops: prior op's good qty.
   */
  availableQty: number;
  /** Current aggregate good on this op */
  qtyComplete: number;
  /** Current aggregate scrap on this op */
  qtyScrap: number;
};

/**
 * Validate a new execution entry against qty conservation.
 * Allow negative adjustments (corrections) but final aggregates must stay >= 0
 * and good+scrap on this op cannot exceed availableQty (yield-chained).
 */
export function canRecordExecution(
  state: QtyState,
  qtyGoodDelta: number,
  qtyScrapDelta: number,
): boolean {
  if (!Number.isInteger(qtyGoodDelta) || !Number.isInteger(qtyScrapDelta)) {
    return false;
  }
  if (qtyGoodDelta === 0 && qtyScrapDelta === 0) return false;
  const nextGood = state.qtyComplete + qtyGoodDelta;
  const nextScrap = state.qtyScrap + qtyScrapDelta;
  if (nextGood < 0 || nextScrap < 0) return false;
  if (nextGood + nextScrap > state.availableQty) return false;
  return true;
}

export function assertCanRecordExecution(
  state: QtyState,
  qtyGoodDelta: number,
  qtyScrapDelta: number,
): void {
  if (canRecordExecution(state, qtyGoodDelta, qtyScrapDelta)) return;
  throw new Error(
    `Invalid execution qty: goodΔ=${qtyGoodDelta} scrapΔ=${qtyScrapDelta} against complete=${state.qtyComplete} scrap=${state.qtyScrap} availableQty=${state.availableQty} woQty=${state.woQty}`,
  );
}

/** Op is complete when good+scrap reaches availableQty (or explicitly marked). */
export function isOperationQtyComplete(
  state: QtyState,
  nextGood: number,
  nextScrap: number,
): boolean {
  return nextGood + nextScrap >= state.availableQty;
}

/** All ops completed → WO can move to completed. */
export function allOperationsComplete(ops: readonly OpProgress[]): boolean {
  return ops.length > 0 && ops.every((o) => o.completed);
}
