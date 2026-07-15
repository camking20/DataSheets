import { describe, expect, it } from "vitest";
import {
  assertNcTransition,
  canCloseNc,
  canTransitionNc,
  NC_STATUS_ORDER,
  NcDispositionSchema,
  NcStatusSchema,
  nextNcStatus,
  resolveNcTriage,
} from "./nc.js";

describe("NC zod enums", () => {
  it("parses NC statuses in order", () => {
    for (const s of NC_STATUS_ORDER) {
      expect(NcStatusSchema.parse(s)).toBe(s);
    }
    expect(NcStatusSchema.safeParse("draft").success).toBe(false);
  });

  it("parses NC dispositions", () => {
    for (const d of [
      "use_as_is",
      "rework",
      "repair",
      "scrap",
      "return_to_vendor",
    ] as const) {
      expect(NcDispositionSchema.parse(d)).toBe(d);
    }
    expect(NcDispositionSchema.safeParse("green").success).toBe(false);
  });
});

describe("canTransitionNc", () => {
  it("allows the linear happy path one step at a time", () => {
    expect(canTransitionNc("initiation", "containment")).toBe(true);
    expect(canTransitionNc("containment", "disposition_planning")).toBe(true);
    expect(
      canTransitionNc("disposition_planning", "disposition_execution"),
    ).toBe(true);
    expect(
      canTransitionNc("disposition_execution", "investigation"),
    ).toBe(true);
    expect(canTransitionNc("investigation", "closure")).toBe(true);
  });

  it("rejects skipping intermediate phases", () => {
    expect(canTransitionNc("initiation", "disposition_planning")).toBe(false);
    expect(canTransitionNc("containment", "investigation")).toBe(false);
    expect(canTransitionNc("containment", "closure")).toBe(false);
  });

  it("rejects backward and identity transitions", () => {
    expect(canTransitionNc("containment", "initiation")).toBe(false);
    expect(canTransitionNc("closure", "investigation")).toBe(false);
    expect(canTransitionNc("initiation", "initiation")).toBe(false);
  });

  it("allows initiation → closure only when acceptable", () => {
    expect(canTransitionNc("initiation", "closure")).toBe(false);
    expect(
      canTransitionNc("initiation", "closure", { acceptable: false }),
    ).toBe(false);
    expect(
      canTransitionNc("initiation", "closure", { acceptable: true }),
    ).toBe(true);
  });

  it("ignores acceptable for non-triage transitions", () => {
    expect(
      canTransitionNc("containment", "closure", { acceptable: true }),
    ).toBe(false);
    expect(
      canTransitionNc("initiation", "containment", { acceptable: true }),
    ).toBe(true);
  });

  it("treats closure as terminal", () => {
    for (const to of NC_STATUS_ORDER) {
      expect(canTransitionNc("closure", to)).toBe(false);
    }
  });

  it("assertNcTransition throws on invalid", () => {
    expect(() => assertNcTransition("initiation", "closure")).toThrow(
      /Invalid NC transition/,
    );
    expect(() =>
      assertNcTransition("initiation", "closure", { acceptable: true }),
    ).not.toThrow();
    expect(() =>
      assertNcTransition("initiation", "containment"),
    ).not.toThrow();
  });
});

describe("nextNcStatus", () => {
  it("returns the next linear phase", () => {
    expect(nextNcStatus("initiation")).toBe("containment");
    expect(nextNcStatus("investigation")).toBe("closure");
    expect(nextNcStatus("closure")).toBeNull();
  });
});

describe("resolveNcTriage", () => {
  it("maps acceptable to immediate closure", () => {
    expect(resolveNcTriage("acceptable")).toEqual({
      decision: "acceptable",
      isAcceptable: true,
      capaRequired: false,
      nextStatus: "closure",
    });
  });

  it("maps nc and nc_capa to containment", () => {
    expect(resolveNcTriage("nc").nextStatus).toBe("containment");
    expect(resolveNcTriage("nc").capaRequired).toBe(false);
    expect(resolveNcTriage("nc_capa").capaRequired).toBe(true);
  });
});

describe("canCloseNc", () => {
  const ready = {
    status: "investigation",
    capaRequired: false,
    rootCause: "Operator error",
    containmentActions: "Quarantined lot",
    openCapaCount: 0,
  };

  it("allows close when investigation with root cause and containment", () => {
    expect(canCloseNc(ready)).toEqual({ ok: true });
  });

  it("allows close when capaRequired and no open CAPAs", () => {
    expect(canCloseNc({ ...ready, capaRequired: true, openCapaCount: 0 })).toEqual(
      { ok: true },
    );
  });

  it("rejects when not in investigation", () => {
    const result = canCloseNc({ ...ready, status: "containment" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/investigation/);
  });

  it("rejects missing root cause", () => {
    const result = canCloseNc({ ...ready, rootCause: "  " });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Root cause/);
  });

  it("rejects missing containment actions", () => {
    const result = canCloseNc({ ...ready, containmentActions: null });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Containment/);
  });

  it("rejects when capaRequired and open CAPAs remain", () => {
    const result = canCloseNc({
      ...ready,
      capaRequired: true,
      openCapaCount: 2,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/CAPA/);
  });
});
