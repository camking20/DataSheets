/**
 * Device Master Record (DMR) and Device History Record (DHR) PDF generators.
 * Uses pdfkit, same pattern as toPdf in index.ts.
 */

export type DmrPdfDocument = {
  docNumber: string;
  docType: string;
  title: string | null;
  rev: string;
  releasedAt: string | null;
  releasedByName: string | null;
};

export type DmrPdfOperation = {
  opNumber: number;
  name: string;
  workCenter: string | null;
  wiDocNumber: string | null;
};

export type DmrPdfSignature = {
  meaning: string;
  signerName: string | null;
  signedAt: string;
  entityLabel: string | null;
};

export type DmrPdfPayload = {
  companyName: string;
  partNumber: string;
  description: string | null;
  customer: string | null;
  assembledAt: string;
  completeness: string;
  documents: DmrPdfDocument[];
  routing: {
    name: string;
    rev: string;
    status: string;
    releasedAt: string | null;
    releasedByName: string | null;
    operations: DmrPdfOperation[];
  } | null;
  /** Release / approval signatures on related document revisions, when present */
  signatures: DmrPdfSignature[];
  notes?: string[];
};

export type DhrPdfExecution = {
  performedByName: string | null;
  performedAt: string;
  qtyGood: number;
  qtyScrap: number;
  note: string | null;
};

export type DhrPdfFrozenDoc = {
  role: string;
  docNumber: string | null;
  rev: string | null;
  title: string | null;
};

export type DhrPdfCapability = {
  dimensionName: string | null;
  n: number;
  mean: number | null;
  stdDev: number | null;
  cp: number | null;
  cpk: number | null;
};

export type DhrPdfMeasurement = {
  dimensionName: string | null;
  sampleIndex: number;
  value: number;
  disposition: string;
};

export type DhrPdfDataSheet = {
  lotNumber: string;
  status: string;
  completedAt: string | null;
  capabilities: DhrPdfCapability[];
  measurements: DhrPdfMeasurement[];
};

export type DhrPdfNc = {
  ncNumber: string;
  status: string;
  disposition: string | null;
  title: string | null;
};

export type DhrPdfOperation = {
  opNumber: number;
  name: string;
  workCenter: string | null;
  status: string;
  startedAt: string | null;
  startedByName: string | null;
  completedAt: string | null;
  completedByName: string | null;
  qtyComplete: number;
  qtyScrap: number;
  executions: DhrPdfExecution[];
  documents: DhrPdfFrozenDoc[];
  dataSheets: DhrPdfDataSheet[];
  nonconformances: DhrPdfNc[];
};

export type DhrPdfSignature = {
  meaning: string;
  signerName: string | null;
  signedAt: string;
  entityLabel: string | null;
};

export type DhrPdfPayload = {
  companyName: string;
  assembledAt: string;
  completeness: string;
  workOrder: {
    woNumber: string;
    partNumber: string | null;
    partRevisionId: string | null;
    partRevision: string | null;
    routingRevisionId: string | null;
    routingRevision: string | null;
    lotNumber: string | null;
    quantity: number | null;
    status: string;
    releasedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
  };
  operations: DhrPdfOperation[];
  signatures: DhrPdfSignature[];
  notes?: string[];
};

function formatTs(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toISOString().replace("T", " ").slice(0, 19) + "Z";
  } catch {
    return value;
  }
}

function createPdfHelpers(doc: PDFKit.PDFDocument) {
  const bottomMargin = 50;
  const pageBottom = () => doc.page.height - bottomMargin;

  function ensureSpace(needed: number) {
    if (doc.y + needed > pageBottom()) {
      doc.addPage();
    }
  }

  function writeLine(text: string, opts?: { bold?: boolean; size?: number; color?: string }) {
    ensureSpace(14);
    if (opts?.size) doc.fontSize(opts.size);
    if (opts?.color) doc.fillColor(opts.color);
    doc.font(opts?.bold ? "Helvetica-Bold" : "Helvetica").text(text);
    doc.fillColor("#000");
  }

  function metaRow(label: string, value: string) {
    ensureSpace(14);
    doc.font("Helvetica-Bold").fontSize(10).text(`${label}: `, { continued: true });
    doc.font("Helvetica").text(value);
  }

  function sectionTitle(title: string) {
    doc.moveDown(0.6);
    ensureSpace(28);
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#000").text(title);
    doc.moveDown(0.3);
    doc.fontSize(9);
  }

  return { ensureSpace, writeLine, metaRow, sectionTitle };
}

export async function generateDmrPdf(payload: DmrPdfPayload): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { ensureSpace, writeLine, metaRow, sectionTitle } = createPdfHelpers(doc);

    doc.fontSize(18).text("Device Master Record (DMR)", { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(10).text(payload.companyName, { align: "center" });
    doc.moveDown();

    metaRow("Part Number", payload.partNumber);
    metaRow("Description", payload.description ?? "—");
    metaRow("Customer", payload.customer ?? "—");
    metaRow("Completeness", payload.completeness);
    metaRow("Assembled", formatTs(payload.assembledAt));

    sectionTitle("Released controlled documents");
    if (payload.documents.length === 0) {
      writeLine("  (none)");
    } else {
      for (const d of payload.documents) {
        ensureSpace(36);
        doc
          .font("Helvetica-Bold")
          .text(
            `${d.docType.toUpperCase()} ${d.docNumber}  Rev ${d.rev}`,
          );
        doc
          .font("Helvetica")
          .text(
            `  ${d.title ?? "—"}  ·  released ${formatTs(d.releasedAt)} by ${d.releasedByName ?? "—"}`,
          );
      }
    }

    sectionTitle("Released routing");
    if (!payload.routing) {
      writeLine("  (no released routing)");
    } else {
      metaRow("Routing", `${payload.routing.name}  Rev ${payload.routing.rev}`);
      metaRow("Status", payload.routing.status);
      metaRow("Released", formatTs(payload.routing.releasedAt));
      metaRow("Released by", payload.routing.releasedByName ?? "—");
      doc.moveDown(0.3);
      if (payload.routing.operations.length === 0) {
        writeLine("  (no operations)");
      } else {
        for (const op of payload.routing.operations) {
          ensureSpace(22);
          doc
            .font("Helvetica-Bold")
            .text(`Op ${op.opNumber} — ${op.name}`);
          doc
            .font("Helvetica")
            .text(
              `  Work center: ${op.workCenter ?? "—"}  ·  WI: ${op.wiDocNumber ?? "—"}`,
            );
        }
      }
    }

    if (payload.signatures.length > 0) {
      sectionTitle("Approvals / signatures");
      for (const sig of payload.signatures) {
        writeLine(
          `  ${sig.meaning} — ${sig.signerName ?? "—"} @ ${formatTs(sig.signedAt)}${sig.entityLabel ? `  (${sig.entityLabel})` : ""}`,
        );
      }
    } else if (payload.documents.length > 0) {
      sectionTitle("Release approvals");
      for (const d of payload.documents) {
        writeLine(
          `  ${d.docType.toUpperCase()} ${d.docNumber} Rev ${d.rev} — released by ${d.releasedByName ?? "—"} at ${formatTs(d.releasedAt)}`,
        );
      }
      if (payload.routing) {
        writeLine(
          `  Routing ${payload.routing.name} Rev ${payload.routing.rev} — released by ${payload.routing.releasedByName ?? "—"} at ${formatTs(payload.routing.releasedAt)}`,
        );
      }
    }

    if (payload.notes && payload.notes.length > 0) {
      sectionTitle("Notes");
      for (const note of payload.notes) {
        writeLine(`  • ${note}`);
      }
    }

    doc.moveDown(1.2);
    ensureSpace(20);
    doc.fontSize(8).fillColor("#666").text("Generated by DataSheets", {
      align: "center",
    });
    doc.end();
  });
}

export async function generateDhrPdf(payload: DhrPdfPayload): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { ensureSpace, writeLine, metaRow, sectionTitle } = createPdfHelpers(doc);
    const wo = payload.workOrder;

    doc.fontSize(18).text("Device History Record (DHR)", { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(10).text(payload.companyName, { align: "center" });
    doc.moveDown();

    metaRow("Work Order", wo.woNumber);
    metaRow("Part Number", wo.partNumber ?? "—");
    metaRow(
      "Part Revision",
      wo.partRevision
        ? `${wo.partRevision}${wo.partRevisionId ? ` (${wo.partRevisionId.slice(0, 8)})` : ""}`
        : "—",
    );
    metaRow(
      "Routing Revision",
      wo.routingRevision
        ? `${wo.routingRevision}${wo.routingRevisionId ? ` (${wo.routingRevisionId.slice(0, 8)})` : ""}`
        : "—",
    );
    metaRow("Lot Number", wo.lotNumber ?? "—");
    metaRow("Quantity", wo.quantity != null ? String(wo.quantity) : "—");
    metaRow("Status", wo.status);
    metaRow("Released", formatTs(wo.releasedAt));
    metaRow("Started", formatTs(wo.startedAt));
    metaRow("Completed", formatTs(wo.completedAt));
    metaRow("Completeness", payload.completeness);
    metaRow("Assembled", formatTs(payload.assembledAt));

    sectionTitle("Operations");
    if (payload.operations.length === 0) {
      writeLine("  (no operations)");
    } else {
      for (const op of payload.operations) {
        ensureSpace(40);
        doc
          .font("Helvetica-Bold")
          .fontSize(10)
          .text(`Op ${op.opNumber} — ${op.name}  [${op.status}]`);
        doc.font("Helvetica").fontSize(9);
        writeLine(
          `  Work center: ${op.workCenter ?? "—"}  ·  Qty complete: ${op.qtyComplete}  scrap: ${op.qtyScrap}`,
        );
        writeLine(
          `  Started: ${formatTs(op.startedAt)} by ${op.startedByName ?? "—"}`,
        );
        writeLine(
          `  Completed: ${formatTs(op.completedAt)} by ${op.completedByName ?? "—"}`,
        );

        if (op.documents.length > 0) {
          writeLine("  Frozen documents:", { bold: true });
          for (const d of op.documents) {
            writeLine(
              `    ${d.role}: ${d.docNumber ?? "—"} Rev ${d.rev ?? "—"} (${d.title ?? "—"})`,
            );
          }
        }

        if (op.executions.length > 0) {
          writeLine("  Executions:", { bold: true });
          for (const ex of op.executions) {
            writeLine(
              `    ${formatTs(ex.performedAt)}  ${ex.performedByName ?? "—"}  good=${ex.qtyGood} scrap=${ex.qtyScrap}${ex.note ? `  (${ex.note})` : ""}`,
            );
          }
        }

        if (op.dataSheets.length > 0) {
          writeLine("  Data sheets:", { bold: true });
          for (const ds of op.dataSheets) {
            writeLine(
              `    Lot ${ds.lotNumber}  [${ds.status}]  completed ${formatTs(ds.completedAt)}`,
            );
            for (const cap of ds.capabilities) {
              writeLine(
                `      ${cap.dimensionName ?? "dim"}  n=${cap.n} mean=${cap.mean ?? "—"} s=${cap.stdDev ?? "—"} Cp=${cap.cp ?? "—"} Cpk=${cap.cpk ?? "—"}`,
              );
            }
            if (ds.measurements.length > 0) {
              writeLine("      Measurements:", { bold: true });
              for (const m of ds.measurements) {
                writeLine(
                  `        ${m.dimensionName ?? "dim"}  sample ${m.sampleIndex + 1}: ${m.value}  [${m.disposition}]`,
                );
              }
            }
          }
        }

        if (op.nonconformances.length > 0) {
          writeLine("  Nonconformances:", { bold: true });
          for (const nc of op.nonconformances) {
            writeLine(
              `    ${nc.ncNumber}  [${nc.status}]  disposition=${nc.disposition ?? "—"}  ${nc.title ?? ""}`,
            );
          }
        }

        doc.moveDown(0.4);
      }
    }

    if (payload.signatures.length > 0) {
      sectionTitle("Signatures");
      for (const sig of payload.signatures) {
        writeLine(
          `  ${sig.meaning} — ${sig.signerName ?? "—"} @ ${formatTs(sig.signedAt)}${sig.entityLabel ? `  (${sig.entityLabel})` : ""}`,
        );
      }
    }

    if (payload.notes && payload.notes.length > 0) {
      sectionTitle("Notes");
      for (const note of payload.notes) {
        writeLine(`  • ${note}`);
      }
    }

    doc.moveDown(1.2);
    ensureSpace(20);
    doc.fontSize(8).fillColor("#666").text("Generated by DataSheets", {
      align: "center",
    });
    doc.end();
  });
}
