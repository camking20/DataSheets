import { describe, expect, it } from "vitest";
import {
  assertCapaTransition,
  canCloseCapa,
  canTransitionCapa,
  CapaActionStatusSchema,
  CapaStatusSchema,
} from "./capa.js";

describe("CAPA zod enums", () => {
  it("parses CAPA statuses", () => {
    for (const s of [
      "open",
      "in_progress",
      "verification",
      "closed",
    ] as const) {
      expect(CapaStatusSchema.parse(s)).toBe(s);
    }
    expect(CapaStatusSchema.safeParse("draft").success).toBe(false);
  });

  it("parses CAPA action statuses", () => {
    for (const s of [
      "pending",
      "in_progress",
      "completed",
      "cancelled",
    ] as const) {
      expect(CapaActionStatusSchema.parse(s)).toBe(s);
    }
  });
});

describe("canTransitionCapa", () => {
  it("allows the linear happy path one step at a time", () => {
    expect(canTransitionCapa("open", "in_progress")).toBe(true);
    expect(canTransitionCapa("in_progress", "verification")).toBe(true);
  });

  it("rejects closing via transition (close is a separate path)", () => {
    expect(canTransitionCapa("verification", "closed")).toBe(false);
    expect(canTransitionCapa("open", "closed")).toBe(false);
  });

  it("rejects skipping, backward, and identity", () => {
    expect(canTransitionCapa("open", "verification")).toBe(false);
    expect(canTransitionCapa("in_progress", "open")).toBe(false);
    expect(canTransitionCapa("open", "open")).toBe(false);
  });

  it("treats verification and closed as terminal for transitions", () => {
    for (const to of [
      "open",
      "in_progress",
      "verification",
      "closed",
    ] as const) {
      expect(canTransitionCapa("verification", to)).toBe(false);
      expect(canTransitionCapa("closed", to)).toBe(false);
    }
  });

  it("assertCapaTransition throws on invalid", () => {
    expect(() => assertCapaTransition("verification", "closed")).toThrow(
      /Invalid CAPA transition/,
    );
    expect(() => assertCapaTransition("open", "in_progress")).not.toThrow();
  });
});

describe("canCloseCapa", () => {
  const doneActions = [
    { status: "completed" },
    { status: "cancelled" },
  ];

  it("allows close when verification, actions done, effectiveness verified", () => {
    expect(
      canCloseCapa({ status: "verification" }, doneActions, true),
    ).toEqual({ ok: true });
  });

  it("allows close with no actions when other gates pass", () => {
    expect(canCloseCapa({ status: "verification" }, [], true)).toEqual({
      ok: true,
    });
  });

  it("rejects when not in verification", () => {
    const result = canCloseCapa({ status: "in_progress" }, doneActions, true);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/verification/);
  });

  it("rejects when actions are incomplete", () => {
    const result = canCloseCapa(
      { status: "verification" },
      [{ status: "pending" }, { status: "completed" }],
      true,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/actions/);
  });

  it("rejects when effectiveness not verified", () => {
    const result = canCloseCapa({ status: "verification" }, doneActions, false);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Effectiveness/);
  });
});
