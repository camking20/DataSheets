/**
 * Focused unit tests for MES qty gates used by workOrders router
 * (`assertCanRecordExecution` / `availableQtyForOperation`). No DB.
 */
import { describe, expect, it } from "vitest";
import {
  assertCanRecordExecution,
  availableQtyForOperation,
  canRecordExecution,
  type QtyState,
} from "@datasheets/core";

describe("MES qty gates (workOrders router)", () => {
  const firstOp: QtyState = {
    woQty: 50,
    availableQty: 50,
    qtyComplete: 10,
    qtyScrap: 0,
  };

  it("allows good+scrap within yield-chained availableQty", () => {
    expect(canRecordExecution(firstOp, 5, 2)).toBe(true);
    expect(() => assertCanRecordExecution(firstOp, 5, 2)).not.toThrow();
  });

  it("rejects overage past availableQty", () => {
    expect(canRecordExecution(firstOp, 41, 0)).toBe(false);
    expect(() => assertCanRecordExecution(firstOp, 41, 0)).toThrow(
      /availableQty=50/,
    );
  });

  it("chains availableQty from prior op good qty (not woQty)", () => {
    const available = availableQtyForOperation(50, [
      { qtyComplete: 30, qtyScrap: 5, completed: true },
    ]);
    expect(available).toBe(30);

    const op2: QtyState = {
      woQty: 50,
      availableQty: available,
      qtyComplete: 0,
      qtyScrap: 0,
    };
    expect(canRecordExecution(op2, 30, 0)).toBe(true);
    expect(canRecordExecution(op2, 31, 0)).toBe(false);
  });

  it("rejects zero deltas and non-integers", () => {
    expect(canRecordExecution(firstOp, 0, 0)).toBe(false);
    expect(canRecordExecution(firstOp, 1.5, 0)).toBe(false);
  });
});
