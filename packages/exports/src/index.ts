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
}

const dispositionColor: Record<string, string> = {
  green: "22C55E",
  yellow: "EAB308",
  red: "EF4444",
};

export function toCsv(payload: ExportSheetPayload): string {
  const lines: string[] = [];
  lines.push(`Company,${csvEscape(payload.companyName)}`);
  lines.push(`Part Number,${csvEscape(payload.partNumber)}`);
  lines.push(`Revision,${csvEscape(payload.revision)}`);
  lines.push(`Lot Number,${csvEscape(payload.lotNumber)}`);
  lines.push(`Lot Size,${payload.lotSize}`);
  lines.push(`Operator,${csvEscape(payload.operatorName ?? "")}`);
  lines.push(`Completed,${csvEscape(payload.completedAt ?? "")}`);
  lines.push("");
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
          String(m.sampleIndex + 1),
          String(m.value),
          csvEscape(dim.unit),
          dim.lsl ?? "",
          dim.nominal,
          dim.usl ?? "",
          m.disposition,
        ].join(","),
      );
    }
  }
  return lines.join("\n");
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
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
        m.value,
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
      doc.font("Helvetica-Bold").text(`${k}: `, { continued: true });
      doc.font("Helvetica").text(v);
    }

    doc.moveDown();
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
        doc.text("  (no measurements)");
      } else {
        for (const m of ms) {
          doc.text(
            `  Piece ${m.sampleIndex + 1}: ${m.value}  [${m.disposition.toUpperCase()}]`,
          );
        }
      }
      doc.moveDown(0.4);
    }

    doc.moveDown();
    doc.fontSize(8).fillColor("#666").text("Generated by DataSheets", {
      align: "center",
    });
    doc.end();
  });
}
