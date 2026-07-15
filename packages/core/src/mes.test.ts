import { describe, expect, it } from "vitest";
import {
  allOperationsComplete,
  assertCanRecordExecution,
  assertCanStartOperation,
  assertWorkOrderTransition,
  availableQtyForOperation,
  canRecordExecution,
  canStartOperation,
  canTransitionWorkOrder,
  isOperationQtyComplete,
} from "./mes.js";

describe("work order transitions", () => {
  it("allows planned → released → in_progress → completed → closed", () => {
    expect(canTransitionWorkOrder("planned", "released")).toBe(true);
    expect(canTransitionWorkOrder("released", "in_progress")).toBe(true);
    expect(canTransitionWorkOrder("in_progress", "completed")).toBe(true);
    expect(canTransitionWorkOrder("completed", "closed")).toBe(true);
  });

  it("allows hold/resume and cancel from non-terminal", () => {
    expect(canTransitionWorkOrder("in_progress", "on_hold")).toBe(true);
    expect(canTransitionWorkOrder("on_hold", "in_progress")).toBe(true);
    expect(canTransitionWorkOrder("planned", "cancelled")).toBe(true);
    expect(canTransitionWorkOrder("closed", "cancelled")).toBe(false);
  });

  it("assert throws on illegal transition", () => {
    expect(() => assertWorkOrderTransition("closed", "planned")).toThrow(
      /Invalid work order transition/,
    );
  });
});

describe("op sequencing", () => {
  const ops = [
    { opNumber: 10, completed: true, started: true },
    { opNumber: 20, completed: false, started: false },
    { opNumber: 30, completed: false, started: false },
  ];

  it("allows starting next incomplete op when priors done", () => {
    expect(canStartOperation(ops, 20)).toBe(true);
    expect(canStartOperation(ops, 30)).toBe(false);
  });

  it("blocks restart of completed op", () => {
    expect(canStartOperation(ops, 10)).toBe(false);
  });

  it("assert throws when blocked", () => {
    expect(() => assertCanStartOperation(ops, 30)).toThrow(/Cannot start/);
  });

  it("allOperationsComplete", () => {
    expect(allOperationsComplete(ops)).toBe(false);
    expect(
      allOperationsComplete([
        { opNumber: 10, completed: true, started: true },
        { opNumber: 20, completed: true, started: true },
      ]),
    ).toBe(true);
  });
});

describe("yield-chained available qty", () => {
  it("first op uses woQty", () => {
    expect(availableQtyForOperation(25, [])).toBe(25);
  });

  it("after 20 good / 5 scrap on op1, op2 max is 20", () => {
    expect(
      availableQtyForOperation(25, [
        { qtyComplete: 20, qtyScrap: 5, completed: true },
      ]),
    ).toBe(20);
  });

  it("returns 0 when any prior op is incomplete", () => {
    expect(
      availableQtyForOperation(25, [
        { qtyComplete: 10, qtyScrap: 0, completed: false },
      ]),
    ).toBe(0);
  });

  it("chains from immediate prior good qty across multiple ops", () => {
    expect(
      availableQtyForOperation(100, [
        { qtyComplete: 80, qtyScrap: 20, completed: true },
        { qtyComplete: 70, qtyScrap: 10, completed: true },
      ]),
    ).toBe(70);
  });
});

describe("qty conservation", () => {
  const state = {
    woQty: 25,
    availableQty: 25,
    qtyComplete: 10,
    qtyScrap: 1,
  };

  it("accepts valid positive deltas", () => {
    expect(canRecordExecution(state, 5, 0)).toBe(true);
    expect(canRecordExecution(state, 14, 0)).toBe(true);
  });

  it("rejects over availableQty (first op = woQty)", () => {
    expect(canRecordExecution(state, 15, 0)).toBe(false);
  });

  it("allows negative adjustment with reason path (qty rules only)", () => {
    expect(canRecordExecution(state, -2, 0)).toBe(true);
    expect(canRecordExecution(state, -11, 0)).toBe(false);
  });

  it("rejects zero / non-integer", () => {
    expect(canRecordExecution(state, 0, 0)).toBe(false);
    expect(canRecordExecution(state, 1.5, 0)).toBe(false);
  });

  it("assert throws", () => {
    expect(() => assertCanRecordExecution(state, 100, 0)).toThrow(
      /Invalid execution/,
    );
  });

  it("isOperationQtyComplete", () => {
    expect(isOperationQtyComplete(state, 24, 1)).toBe(true);
    expect(isOperationQtyComplete(state, 20, 1)).toBe(false);
  });

  it("rejects inventing yield across ops", () => {
    const op2 = {
      woQty: 25,
      availableQty: availableQtyForOperation(25, [
        { qtyComplete: 20, qtyScrap: 5, completed: true },
      ]),
      qtyComplete: 0,
      qtyScrap: 0,
    };
    expect(op2.availableQty).toBe(20);
    expect(canRecordExecution(op2, 20, 0)).toBe(true);
    expect(canRecordExecution(op2, 21, 0)).toBe(false);
    expect(canRecordExecution(op2, 15, 6)).toBe(false);
    expect(canRecordExecution(op2, 15, 5)).toBe(true);
    expect(() => assertCanRecordExecution(op2, 25, 0)).toThrow(
      /availableQty=20/,
    );
  });
});
