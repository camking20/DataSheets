import { describe, expect, it } from "vitest";
import {
  csvEscape,
  formatMeasurementValue,
  toCsv,
  type ExportSheetPayload,
} from "./index.js";

const baseDim = {
  id: "dim-1",
  name: "OD",
  balloonNumber: "1",
  unit: "in",
  nominal: 1,
  usl: 1.01,
  lsl: 0.99,
};

function samplePayload(overrides: Partial<ExportSheetPayload> = {}): ExportSheetPayload {
  return {
    companyName: "Acme Machine",
    partNumber: "P-100",
    revision: "A",
    description: null,
    customer: null,
    lotNumber: "LOT-1",
    lotSize: 5,
    operatorName: "Pat",
    completedAt: "2026-01-01T00:00:00.000Z",
    dimensions: [baseDim],
    measurements: [
      {
        dimensionId: "dim-1",
        sampleIndex: 0,
        value: 1.0012,
        disposition: "green",
      },
    ],
    capabilities: [
      {
        dimensionName: "OD",
        n: 5,
        mean: 1.001,
        stdDev: 0.002,
        pp: 1.5,
        ppk: 1.4,
        percentYellow: 10,
        percentRed: 0,
      },
    ],
    ...overrides,
  };
}

describe("csvEscape", () => {
  it("prefixes formula-injection characters with a single quote", () => {
    expect(csvEscape("=1+1")).toBe("'=1+1");
    expect(csvEscape("+cmd")).toBe("'+cmd");
    expect(csvEscape("-1.5")).toBe("'-1.5");
    expect(csvEscape("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvEscape("\tTAB")).toBe("'\tTAB");
    expect(csvEscape("\rCR")).toBe("\"'\rCR\"");
  });

  it("quotes cells that contain commas or quotes", () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it("leaves safe values alone", () => {
    expect(csvEscape("OD")).toBe("OD");
    expect(csvEscape(12)).toBe("12");
  });
});

describe("formatMeasurementValue", () => {
  it("uses tolerance-derived precision", () => {
    expect(formatMeasurementValue(1.001234, baseDim)).toMatch(/^1\.00/);
  });

  it("falls back to 4 decimals without a tolerance span", () => {
    expect(
      formatMeasurementValue(1.1234567, {
        ...baseDim,
        usl: null,
        lsl: null,
      }),
    ).toBe("1.1235");
  });
});

describe("toCsv", () => {
  it("includes a Capability summary with Pp/Ppk labels", () => {
    const csv = toCsv(samplePayload());
    expect(csv).toContain("Capability summary");
    expect(csv).toContain("Pp");
    expect(csv).toContain("Ppk");
    expect(csv).not.toMatch(/,Cp,/);
    expect(csv).not.toMatch(/,Cpk,/);
  });

  it("escapes formula-like measurement and meta cells", () => {
    const csv = toCsv(
      samplePayload({
        companyName: "=Evil",
        measurements: [
          {
            dimensionId: "dim-1",
            sampleIndex: 0,
            value: -0.5,
            disposition: "red",
          },
        ],
      }),
    );
    expect(csv).toContain("'=Evil");
    expect(csv).toContain("'-0.");
  });
});
