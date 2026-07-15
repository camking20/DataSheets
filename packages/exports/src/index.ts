export interface ExportDimension {
  id: string;
  name: string;
  balloonNumber: string | null;
  unit: string;
  nominal: number;
  usl: number | null;
  lsl: number | null;
}

export interface ExportMeasurement {
  dimensionId: string;
  sampleIndex: number;
  value: number;
  disposition: "green" | "yellow" | "red";
}

export interface ExportCapabilityRow {
  dimensionName: string;
  n: number;
  mean: number | null;
  stdDev: number | null;
  pp: number | null;
  ppk: number | null;
  percentYellow: number;
  percentRed: number;
}

export interface ExportSheetPayload {
  companyName: string;
  partNumber: string;
  revision: string;
  description: string | null;
  customer: string | null;
  lotNumber: string;
  lotSize: number;
  operatorName: string | null;
  completedAt: string | null;
  dimensions: ExportDimension[];
  measurements: ExportMeasurement[];
  capabilities?: ExportCapabilityRow[];
}

/** @deprecated Prefer ExportSheetPayload; alias kept for clarity with export APIs. */
export type ExportPayload = ExportSheetPayload;

const dispositionColor: Record<string, string> = {
  green: "22C55E",
  yellow: "EAB308",
  red: "EF4444",
};

const FORMULA_INJECTION_RE = /^[=+\-@\t\r]/;

/** Format a measurement with precision derived from tolerance span, else 4 decimals. */
export function formatMeasurementValue(value: number, dim: ExportDimension): string {
  const span =
    dim.usl != null && dim.lsl != null
      ? Math.abs(dim.usl - dim.lsl)
      : dim.usl != null
        ? Math.abs(dim.usl - dim.nominal)
        : dim.lsl != null
          ? Math.abs(dim.nominal - dim.lsl)
          : null;

  let decimals = 4;
  if (span != null && span > 0 && Number.isFinite(span)) {
    const order = Math.floor(Math.log10(span));
    // Resolve ~0.1% of tolerance band; clamp to a practical range.
    decimals = Math.min(6, Math.max(2, 3 - order));
  }

  return value.toFixed(decimals);
}

function formatNullable(value: number | null, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toFixed(digits);
}

function formatPercent(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(2)}%`;
}

/**
 * Escape a CSV cell. Prefixes formula-like leading characters with `'`
 * so spreadsheet apps treat the cell as text.
 */
export function csvEscape(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (FORMULA_INJECTION_RE.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(payload: ExportSheetPayload): string {
  const lines: string[] = [];
  lines.push(`Company,${csvEscape(payload.companyName)}`);
  lines.push(`Part Number,${csvEscape(payload.partNumber)}`);
  lines.push(`Revision,${csvEscape(payload.revision)}`);
  lines.push(`Lot Number,${csvEscape(payload.lotNumber)}`);
  lines.push(`Lot Size,${csvEscape(payload.lotSize)}`);
  lines.push(`Operator,${csvEscape(payload.operatorName ?? "")}`);
  lines.push(`Completed,${csvEscape(payload.completedAt ?? "")}`);
  lines.push("");

  if (payload.capabilities && payload.capabilities.length > 0) {
    lines.push("Capability summary");
    lines.push(
      [
        "Dimension",
        "n",
        "Mean",
        "Std Dev",
        "Pp",
        "Ppk",
        "% Yellow",
        "% Red",
      ].join(","),
    );
    for (const row of payload.capabilities) {
      lines.push(
        [
          csvEscape(row.dimensionName),
          csvEscape(row.n),
          csvEscape(formatNullable(row.mean)),
          csvEscape(formatNullable(row.stdDev)),
          csvEscape(formatNullable(row.pp)),
          csvEscape(formatNullable(row.ppk)),
          csvEscape(formatPercent(row.percentYellow)),
          csvEscape(formatPercent(row.percentRed)),
        ].join(","),
      );
    }
    lines.push("");
  }

  lines.push(
    ["Dimension", "Balloon", "Sample #", "Value", "Unit", "LSL", "Nominal", "USL", "Disposition"].join(","),
  );

  const dims = [...payload.dimensions].sort((a, b) => a.name.localeCompare(b.name));
  for (const dim of dims) {
    const ms = payload.measurements
      .filter((m) => m.dimensionId === dim.id)
      .sort((a, b) => a.sampleIndex - b.sampleIndex);
    for (const m of ms) {
      lines.push(
        [
          csvEscape(dim.name),
          csvEscape(dim.balloonNumber ?? ""),
          csvEscape(m.sampleIndex + 1),
          csvEscape(formatMeasurementValue(m.value, dim)),
          csvEscape(dim.unit),
          csvEscape(dim.lsl ?? ""),
          csvEscape(dim.nominal),
          csvEscape(dim.usl ?? ""),
          csvEscape(m.disposition),
        ].join(","),
      );
    }
  }
  return lines.join("\n");
}

export async function toExcel(payload: ExportSheetPayload): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "DataSheets";
  const ws = wb.addWorksheet("Inspection");

  ws.addRow(["Company", payload.companyName]);
  ws.addRow(["Part Number", payload.partNumber]);
  ws.addRow(["Revision", payload.revision]);
  ws.addRow(["Description", payload.description ?? ""]);
  ws.addRow(["Customer", payload.customer ?? ""]);
  ws.addRow(["Lot Number", payload.lotNumber]);
  ws.addRow(["Lot Size", payload.lotSize]);
  ws.addRow(["Operator", payload.operatorName ?? ""]);
  ws.addRow(["Completed", payload.completedAt ?? ""]);
  ws.addRow([]);

  if (payload.capabilities && payload.capabilities.length > 0) {
    ws.addRow(["Capability summary"]);
    const capHeader = ws.addRow([
      "Dimension",
      "n",
      "Mean",
      "Std Dev",
      "Pp",
      "Ppk",
      "% Yellow",
      "% Red",
    ]);
    capHeader.font = { bold: true };
    for (const row of payload.capabilities) {
      ws.addRow([
        row.dimensionName,
        row.n,
        row.mean,
        row.stdDev,
        row.pp,
        row.ppk,
        Math.round(row.percentYellow * 100) / 100,
        Math.round(row.percentRed * 100) / 100,
      ]);
    }
    ws.addRow([]);
  }

  const header = ws.addRow([
    "Dimension",
    "Balloon",
    "Sample #",
    "Value",
    "Unit",
    "LSL",
    "Nominal",
    "USL",
    "Disposition",
  ]);
  header.font = { bold: true };

  for (const dim of payload.dimensions) {
    const ms = payload.measurements
      .filter((m) => m.dimensionId === dim.id)
      .sort((a, b) => a.sampleIndex - b.sampleIndex);
    for (const m of ms) {
      const row = ws.addRow([
        dim.name,
        dim.balloonNumber ?? "",
        m.sampleIndex + 1,
        Number(formatMeasurementValue(m.value, dim)),
        dim.unit,
        dim.lsl,
        dim.nominal,
        dim.usl,
        m.disposition,
      ]);
      const cell = row.getCell(9);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: `FF${dispositionColor[m.disposition] ?? "CCCCCC"}` },
      };
    }
  }

  ws.columns.forEach((c) => {
    c.width = 14;
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function toPdf(payload: ExportSheetPayload): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const bottomMargin = 50;
    const pageBottom = () => doc.page.height - bottomMargin;

    function ensureSpace(needed: number) {
      if (doc.y + needed > pageBottom()) {
        doc.addPage();
      }
    }

    function writeLine(text: string) {
      ensureSpace(14);
      doc.text(text);
    }

    doc.fontSize(18).text("Inspection Data Sheet", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(payload.companyName, { align: "center" });
    doc.moveDown();

    const meta: Array<[string, string]> = [
      ["Part Number", payload.partNumber],
      ["Revision", payload.revision],
      ["Description", payload.description ?? "—"],
      ["Customer", payload.customer ?? "—"],
      ["Lot Number", payload.lotNumber],
      ["Lot Size", String(payload.lotSize)],
      ["Operator", payload.operatorName ?? "—"],
      ["Completed", payload.completedAt ?? "—"],
    ];
    for (const [k, v] of meta) {
      ensureSpace(14);
      doc.font("Helvetica-Bold").text(`${k}: `, { continued: true });
      doc.font("Helvetica").text(v);
    }

    if (payload.capabilities && payload.capabilities.length > 0) {
      doc.moveDown();
      ensureSpace(28);
      doc.font("Helvetica-Bold").fontSize(12).text("Capability summary");
      doc.moveDown(0.4);
      doc.fontSize(9);
      for (const row of payload.capabilities) {
        ensureSpace(36);
        doc
          .font("Helvetica-Bold")
          .text(row.dimensionName);
        doc.font("Helvetica").text(
          `  n=${row.n}  mean=${formatNullable(row.mean) || "—"}  s=${formatNullable(row.stdDev) || "—"}  Pp=${formatNullable(row.pp) || "—"}  Ppk=${formatNullable(row.ppk) || "—"}  yellow=${formatPercent(row.percentYellow)}  red=${formatPercent(row.percentRed)}`,
        );
      }
    }

    doc.moveDown();
    ensureSpace(28);
    doc.font("Helvetica-Bold").fontSize(12).text("Measurements");
    doc.moveDown(0.5);
    doc.fontSize(9);

    for (const dim of payload.dimensions) {
      const tol = [
        dim.lsl != null ? `LSL ${dim.lsl}` : null,
        `NOM ${dim.nominal}`,
        dim.usl != null ? `USL ${dim.usl}` : null,
      ]
        .filter(Boolean)
        .join(" / ");

      ensureSpace(28);
      doc
        .font("Helvetica-Bold")
        .text(
          `${dim.balloonNumber ? `#${dim.balloonNumber} ` : ""}${dim.name} (${dim.unit}) — ${tol}`,
        );
      doc.font("Helvetica");

      const ms = payload.measurements
        .filter((m) => m.dimensionId === dim.id)
        .sort((a, b) => a.sampleIndex - b.sampleIndex);

      if (ms.length === 0) {
        writeLine("  (no measurements)");
      } else {
        for (const m of ms) {
          writeLine(
            `  Piece ${m.sampleIndex + 1}: ${formatMeasurementValue(m.value, dim)}  [${m.disposition.toUpperCase()}]`,
          );
        }
      }
      doc.moveDown(0.4);
    }

    doc.moveDown();
    ensureSpace(90);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text("Approvals");
    doc.moveDown(0.6);
    doc.font("Helvetica").fontSize(9);
    doc.text("Inspector: ___________________________    Date: ______________");
    doc.moveDown(0.8);
    doc.text("Reviewer:  ___________________________    Date: ______________");

    doc.moveDown(1.5);
    ensureSpace(20);
    doc.fontSize(8).fillColor("#666").text("Generated by DataSheets", {
      align: "center",
    });
    doc.end();
  });
}

export {
  generateDmrPdf,
  generateDhrPdf,
  type DmrPdfPayload,
  type DmrPdfDocument,
  type DmrPdfOperation,
  type DmrPdfSignature,
  type DhrPdfPayload,
  type DhrPdfOperation,
  type DhrPdfExecution,
  type DhrPdfFrozenDoc,
  type DhrPdfDataSheet,
  type DhrPdfMeasurement,
  type DhrPdfCapability,
  type DhrPdfNc,
  type DhrPdfSignature,
} from "./dmr-dhr.js";
