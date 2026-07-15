/**
 * Device Master Record (DMR) / Device History Record (DHR) assembly + PDF export.
 *
 * Wired as: records: recordsRouter
 *
 * DMR indexes released controlled documents + released routing for a part.
 * DHR compiles per work order from operations, executions, frozen docs,
 * data sheets / capability, NCs, and related signatures.
 */
import { z } from "zod";
import { eq, and, asc, desc, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { TRPCError } from "@trpc/server";
import {
  parts,
  partRevisions,
  documents,
  documentRevisions,
  companies,
  users,
  dataSheets,
  capabilitySnapshots,
  dimensions,
  measurements,
  routings,
  routingRevisions,
  routingOperations,
  workOrders,
  workOrderOperations,
  operationExecutions,
  workOrderOperationDocuments,
  nonconformances,
  signatures,
  auditLogs,
} from "@datasheets/db";
import {
  generateDmrPdf,
  generateDhrPdf,
  type DmrPdfPayload,
  type DhrPdfPayload,
} from "@datasheets/exports";
import { router, tenantProcedure, asTenant } from "../trpc.js";

type Tx = Parameters<Parameters<typeof asTenant>[2]>[0];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DmrDocumentEntry = {
  id: string;
  docNumber: string;
  docType: "drw" | "pro" | "wi" | "frm";
  title: string | null;
  releasedRevision: {
    id: string;
    rev: string;
    status: "released";
    releasedAt: Date | null;
    releasedBy: string | null;
    releasedByName: string | null;
    pdfFileId: string | null;
  };
};

export type DmrSignatureEntry = {
  id: string;
  meaning: string;
  signerName: string | null;
  signedAt: Date;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
};

export type DmrRoutingOperation = {
  /** Preferred field — routing op number */
  opNumber: number;
  /** Alias for UI that still reads `seq` */
  seq: number;
  name: string;
  workCenter: string | null;
  wiDocumentId: string | null;
  wiDocNumber: string | null;
  requiresDataSheet: boolean;
  /** @deprecated use wiDocumentId */
  wiDocId: string | null;
  procedureDocId: string | null;
};

export type DmrResult = {
  kind: "dmr";
  assembledAt: Date;
  completeness: "documents_only" | "partial" | "full";
  companyName: string;
  part: {
    id: string;
    partNumber: string;
    description: string | null;
    customer: string | null;
  };
  documents: DmrDocumentEntry[];
  routing: {
    id: string;
    routingId: string;
    name: string;
    rev: string;
    status: string;
    releasedAt: Date | null;
    releasedBy: string | null;
    releasedByName: string | null;
    partRevisionId: string | null;
    operations: DmrRoutingOperation[];
  } | null;
  signatures: DmrSignatureEntry[];
  billOfMaterials: [];
  specifications: [];
  notes: string[];
};

export type DhrExecutionEntry = {
  id: string;
  qtyGood: number;
  qtyScrap: number;
  performedBy: string;
  performedByName: string | null;
  performedAt: Date;
  note: string | null;
  dataSheetId: string | null;
};

export type DhrFrozenDocument = {
  id: string;
  role: string;
  documentId: string;
  documentRevisionId: string;
  docNumber: string | null;
  title: string | null;
  rev: string | null;
};

export type DhrCapabilityEntry = {
  id: string;
  dimensionId: string;
  dimensionName: string | null;
  n: number;
  mean: number | null;
  stdDev: number | null;
  cp: number | null;
  cpk: number | null;
  percentYellow: number;
  percentRed: number;
};

export type DhrMeasurementEntry = {
  id: string;
  dimensionId: string;
  dimensionName: string | null;
  sampleIndex: number;
  value: number;
  disposition: string;
};

export type DhrDataSheetEntry = {
  id: string;
  lotNumber: string;
  status: string;
  completedAt: Date | null;
  workOrderOperationId: string | null;
  capabilitySnapshots: DhrCapabilityEntry[];
  measurements: DhrMeasurementEntry[];
};

export type DhrNcEntry = {
  id: string;
  ncNumber: string;
  /** NC workflow status (initiation → closure) */
  phase: string;
  status: string;
  disposition: string | null;
  title: string | null;
  workOrderOperationId: string | null;
};

export type DhrOperationEntry = {
  id: string;
  opNumber: number;
  /** Alias for UI */
  seq: number;
  name: string;
  workCenter: string | null;
  status: string;
  startedAt: Date | null;
  startedBy: string | null;
  startedByName: string | null;
  completedAt: Date | null;
  completedBy: string | null;
  completedByName: string | null;
  qtyComplete: number;
  qtyScrap: number;
  wiDocNumber: string | null;
  wiRev: string | null;
  operatorName: string | null;
  executions: DhrExecutionEntry[];
  documents: DhrFrozenDocument[];
  dataSheets: DhrDataSheetEntry[];
  nonconformances: DhrNcEntry[];
};

export type DhrSignatureEntry = {
  id: string;
  meaning: string;
  signerName: string | null;
  signedAt: Date;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
};

export type DhrResult = {
  kind: "dhr";
  assembledAt: Date;
  completeness: "stub" | "partial" | "full";
  companyName: string;
  workOrderId: string;
  workOrder: {
    id: string;
    woNumber: string | null;
    partId: string | null;
    partNumber: string | null;
    partRevisionId: string | null;
    partRevision: string | null;
    routingRevisionId: string | null;
    routingRevision: string | null;
    lotNumber: string | null;
    quantity: number | null;
    status: string | null;
    releasedAt: Date | null;
    /** Earliest work-order operation start; null if no op has started */
    startedAt: Date | null;
    completedAt: Date | null;
  } | null;
  operations: DhrOperationEntry[];
  /** Flat convenience lists for UI sections */
  dataSheets: Array<{
    id: string;
    lotNumber: string;
    status: string;
    completedAt: Date | null;
  }>;
  nonConformances: Array<{
    id: string;
    ncNumber: string;
    phase: string;
    disposition: string | null;
  }>;
  signatures: DhrSignatureEntry[];
  labels: [];
  notes: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFileToken(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]+/g, "_");
}

function toIso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function deriveOpStatus(
  startedAt: Date | null,
  completedAt: Date | null,
): string {
  if (completedAt) return "completed";
  if (startedAt) return "in_progress";
  return "pending";
}

async function loadCompanyName(tx: Tx, companyId: string): Promise<string> {
  const [row] = await tx
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row?.name ?? "Company";
}

async function assembleDmr(
  tx: Tx,
  companyId: string,
  partId: string,
): Promise<DmrResult> {
  const [part] = await tx
    .select()
    .from(parts)
    .where(eq(parts.id, partId))
    .limit(1);
  if (!part) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Part not found" });
  }

  const companyName = await loadCompanyName(tx, companyId);
  const releasedByUser = alias(users, "dmr_released_by_user");

  const docRows = await tx
    .select({
      id: documents.id,
      docNumber: documents.docNumber,
      docType: documents.docType,
      title: documents.title,
      revisionId: documentRevisions.id,
      rev: documentRevisions.rev,
      releasedAt: documentRevisions.releasedAt,
      releasedBy: documentRevisions.releasedBy,
      releasedByName: releasedByUser.name,
      pdfFileId: documentRevisions.pdfFileId,
    })
    .from(documents)
    .innerJoin(
      documentRevisions,
      and(
        eq(documentRevisions.documentId, documents.id),
        eq(documentRevisions.companyId, documents.companyId),
      ),
    )
    .leftJoin(releasedByUser, eq(releasedByUser.id, documentRevisions.releasedBy))
    .where(
      and(
        eq(documents.partId, partId),
        eq(documents.isActive, true),
        eq(documentRevisions.status, "released"),
        inArray(documents.docType, ["drw", "pro", "wi", "frm"]),
      ),
    )
    .orderBy(asc(documents.docType), asc(documents.docNumber));

  const documentEntries: DmrDocumentEntry[] = docRows.map((row) => ({
    id: row.id,
    docNumber: row.docNumber,
    docType: row.docType,
    title: row.title,
    releasedRevision: {
      id: row.revisionId,
      rev: row.rev,
      status: "released",
      releasedAt: row.releasedAt,
      releasedBy: row.releasedBy,
      releasedByName: row.releasedByName,
      pdfFileId: row.pdfFileId,
    },
  }));

  const routing = await loadReleasedRouting(tx, partId);

  const revisionIds = documentEntries.map((d) => d.releasedRevision.id);
  const sigRows =
    revisionIds.length === 0
      ? []
      : await tx
          .select({
            id: signatures.id,
            meaning: signatures.meaning,
            signerName: signatures.signerName,
            signedAt: signatures.signedAt,
            entityType: signatures.entityType,
            entityId: signatures.entityId,
          })
          .from(signatures)
          .where(
            and(
              eq(signatures.entityType, "document_revision"),
              inArray(signatures.entityId, revisionIds),
            ),
          )
          .orderBy(asc(signatures.signedAt));

  const revLabelById = new Map(
    documentEntries.map((d) => [
      d.releasedRevision.id,
      `${d.docNumber} Rev ${d.releasedRevision.rev}`,
    ]),
  );

  const signatureEntries: DmrSignatureEntry[] = sigRows.map((s) => ({
    id: s.id,
    meaning: s.meaning,
    signerName: s.signerName,
    signedAt: s.signedAt,
    entityType: s.entityType,
    entityId: s.entityId,
    entityLabel: revLabelById.get(s.entityId) ?? null,
  }));

  const notes: string[] = [];
  if (!routing) {
    notes.push(
      "No released routing found for this part. Documents are included; routing will appear once a routing revision is released.",
    );
  } else if (routing.operations.length === 0) {
    notes.push("Released routing found, but it has no operations.");
  }

  if (documentEntries.length === 0) {
    notes.push(
      "No released controlled documents (DRW/PRO/WI/FRM) are linked to this part yet.",
    );
  }

  let completeness: DmrResult["completeness"] = "documents_only";
  if (routing && routing.operations.length > 0 && documentEntries.length > 0) {
    completeness = "full";
  } else if (routing || documentEntries.length > 0) {
    completeness = routing ? "partial" : "documents_only";
  }

  return {
    kind: "dmr",
    assembledAt: new Date(),
    completeness,
    companyName,
    part: {
      id: part.id,
      partNumber: part.partNumber,
      description: part.description,
      customer: part.customer,
    },
    documents: documentEntries,
    routing,
    signatures: signatureEntries,
    billOfMaterials: [],
    specifications: [],
    notes,
  };
}

async function loadReleasedRouting(
  tx: Tx,
  partId: string,
): Promise<DmrResult["routing"]> {
  const releasedByUser = alias(users, "routing_released_by_user");

  const [rev] = await tx
    .select({
      revisionId: routingRevisions.id,
      routingId: routings.id,
      name: routings.name,
      rev: routingRevisions.rev,
      status: routingRevisions.status,
      releasedAt: routingRevisions.releasedAt,
      releasedBy: routingRevisions.releasedBy,
      releasedByName: releasedByUser.name,
    })
    .from(routingRevisions)
    .innerJoin(
      routings,
      and(
        eq(routings.id, routingRevisions.routingId),
        eq(routings.companyId, routingRevisions.companyId),
      ),
    )
    .leftJoin(releasedByUser, eq(releasedByUser.id, routingRevisions.releasedBy))
    .where(
      and(
        eq(routings.partId, partId),
        eq(routings.isActive, true),
        eq(routingRevisions.status, "released"),
      ),
    )
    .orderBy(desc(routingRevisions.releasedAt), desc(routingRevisions.createdAt))
    .limit(1);

  if (!rev) return null;

  const [partRev] = await tx
    .select({ id: partRevisions.id })
    .from(partRevisions)
    .where(
      and(
        eq(partRevisions.partId, partId),
        eq(partRevisions.status, "released"),
      ),
    )
    .orderBy(desc(partRevisions.releasedAt), desc(partRevisions.createdAt))
    .limit(1);

  const opRows = await tx
    .select({
      opNumber: routingOperations.opNumber,
      name: routingOperations.name,
      workCenter: routingOperations.workCenter,
      wiDocumentId: routingOperations.wiDocumentId,
      requiresDataSheet: routingOperations.requiresDataSheet,
      wiDocNumber: documents.docNumber,
    })
    .from(routingOperations)
    .leftJoin(
      documents,
      and(
        eq(documents.id, routingOperations.wiDocumentId),
        eq(documents.companyId, routingOperations.companyId),
      ),
    )
    .where(eq(routingOperations.routingRevisionId, rev.revisionId))
    .orderBy(asc(routingOperations.opNumber));

  const operations: DmrRoutingOperation[] = opRows.map((op) => ({
    opNumber: op.opNumber,
    seq: op.opNumber,
    name: op.name,
    workCenter: op.workCenter,
    wiDocumentId: op.wiDocumentId,
    wiDocNumber: op.wiDocNumber ?? null,
    requiresDataSheet: op.requiresDataSheet,
    wiDocId: op.wiDocumentId,
    procedureDocId: null,
  }));

  return {
    id: rev.revisionId,
    routingId: rev.routingId,
    name: rev.name,
    rev: rev.rev,
    status: rev.status,
    releasedAt: rev.releasedAt,
    releasedBy: rev.releasedBy,
    releasedByName: rev.releasedByName,
    partRevisionId: partRev?.id ?? null,
    operations,
  };
}

async function assembleDhr(
  tx: Tx,
  companyId: string,
  workOrderId: string,
): Promise<DhrResult> {
  const companyName = await loadCompanyName(tx, companyId);

  const [woRow] = await tx
    .select({
      id: workOrders.id,
      woNumber: workOrders.woNumber,
      partId: workOrders.partId,
      partNumber: parts.partNumber,
      partRevisionId: workOrders.partRevisionId,
      partRevision: partRevisions.rev,
      routingRevisionId: workOrders.routingRevisionId,
      routingRevision: routingRevisions.rev,
      lotNumber: workOrders.lotNumber,
      qty: workOrders.qty,
      status: workOrders.status,
      releasedAt: workOrders.releasedAt,
      completedAt: workOrders.completedAt,
    })
    .from(workOrders)
    .leftJoin(
      parts,
      and(eq(parts.id, workOrders.partId), eq(parts.companyId, workOrders.companyId)),
    )
    .leftJoin(
      partRevisions,
      and(
        eq(partRevisions.id, workOrders.partRevisionId),
        eq(partRevisions.companyId, workOrders.companyId),
      ),
    )
    .leftJoin(
      routingRevisions,
      and(
        eq(routingRevisions.id, workOrders.routingRevisionId),
        eq(routingRevisions.companyId, workOrders.companyId),
      ),
    )
    .where(eq(workOrders.id, workOrderId))
    .limit(1);

  if (!woRow) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Work order not found" });
  }

  const startedByUser = alias(users, "started_by_user");
  const completedByUser = alias(users, "completed_by_user");
  const performedByUser = alias(users, "performed_by_user");

  const opRows = await tx
    .select({
      id: workOrderOperations.id,
      qtyComplete: workOrderOperations.qtyComplete,
      qtyScrap: workOrderOperations.qtyScrap,
      startedAt: workOrderOperations.startedAt,
      startedBy: workOrderOperations.startedBy,
      startedByName: startedByUser.name,
      completedAt: workOrderOperations.completedAt,
      completedBy: workOrderOperations.completedBy,
      completedByName: completedByUser.name,
      opNumber: routingOperations.opNumber,
      name: routingOperations.name,
      workCenter: routingOperations.workCenter,
      wiDocumentId: routingOperations.wiDocumentId,
    })
    .from(workOrderOperations)
    .innerJoin(
      routingOperations,
      and(
        eq(routingOperations.id, workOrderOperations.routingOperationId),
        eq(routingOperations.companyId, workOrderOperations.companyId),
      ),
    )
    .leftJoin(
      startedByUser,
      eq(startedByUser.id, workOrderOperations.startedBy),
    )
    .leftJoin(
      completedByUser,
      eq(completedByUser.id, workOrderOperations.completedBy),
    )
    .where(eq(workOrderOperations.workOrderId, workOrderId))
    .orderBy(asc(routingOperations.opNumber));

  const wooIds = opRows.map((o) => o.id);

  const executions =
    wooIds.length === 0
      ? []
      : await tx
          .select({
            id: operationExecutions.id,
            workOrderOperationId: operationExecutions.workOrderOperationId,
            qtyGood: operationExecutions.qtyGood,
            qtyScrap: operationExecutions.qtyScrap,
            performedBy: operationExecutions.performedBy,
            performedByName: performedByUser.name,
            performedAt: operationExecutions.performedAt,
            note: operationExecutions.note,
            dataSheetId: operationExecutions.dataSheetId,
          })
          .from(operationExecutions)
          .leftJoin(
            performedByUser,
            eq(performedByUser.id, operationExecutions.performedBy),
          )
          .where(inArray(operationExecutions.workOrderOperationId, wooIds))
          .orderBy(asc(operationExecutions.performedAt));

  const frozenDocs =
    wooIds.length === 0
      ? []
      : await tx
          .select({
            id: workOrderOperationDocuments.id,
            workOrderOperationId:
              workOrderOperationDocuments.workOrderOperationId,
            role: workOrderOperationDocuments.role,
            documentId: workOrderOperationDocuments.documentId,
            documentRevisionId: workOrderOperationDocuments.documentRevisionId,
            snapshot: workOrderOperationDocuments.snapshot,
            docNumber: documents.docNumber,
            title: documents.title,
            rev: documentRevisions.rev,
          })
          .from(workOrderOperationDocuments)
          .leftJoin(
            documents,
            and(
              eq(documents.id, workOrderOperationDocuments.documentId),
              eq(documents.companyId, workOrderOperationDocuments.companyId),
            ),
          )
          .leftJoin(
            documentRevisions,
            and(
              eq(
                documentRevisions.id,
                workOrderOperationDocuments.documentRevisionId,
              ),
              eq(
                documentRevisions.companyId,
                workOrderOperationDocuments.companyId,
              ),
            ),
          )
          .where(
            inArray(workOrderOperationDocuments.workOrderOperationId, wooIds),
          );

  const sheetRows =
    wooIds.length === 0
      ? []
      : await tx
          .select({
            id: dataSheets.id,
            lotNumber: dataSheets.lotNumber,
            status: dataSheets.status,
            completedAt: dataSheets.completedAt,
            workOrderOperationId: dataSheets.workOrderOperationId,
          })
          .from(dataSheets)
          .where(inArray(dataSheets.workOrderOperationId, wooIds))
          .orderBy(asc(dataSheets.createdAt));

  const sheetIds = sheetRows.map((s) => s.id);
  const capRows =
    sheetIds.length === 0
      ? []
      : await tx
          .select({
            id: capabilitySnapshots.id,
            dataSheetId: capabilitySnapshots.dataSheetId,
            dimensionId: capabilitySnapshots.dimensionId,
            dimensionName: dimensions.name,
            n: capabilitySnapshots.n,
            mean: capabilitySnapshots.mean,
            stdDev: capabilitySnapshots.stdDev,
            cp: capabilitySnapshots.cp,
            cpk: capabilitySnapshots.cpk,
            percentYellow: capabilitySnapshots.percentYellow,
            percentRed: capabilitySnapshots.percentRed,
          })
          .from(capabilitySnapshots)
          .leftJoin(
            dimensions,
            and(
              eq(dimensions.id, capabilitySnapshots.dimensionId),
              eq(dimensions.companyId, capabilitySnapshots.companyId),
            ),
          )
          .where(inArray(capabilitySnapshots.dataSheetId, sheetIds));

  const measurementRows =
    sheetIds.length === 0
      ? []
      : await tx
          .select({
            id: measurements.id,
            dataSheetId: measurements.dataSheetId,
            dimensionId: measurements.dimensionId,
            dimensionName: dimensions.name,
            sampleIndex: measurements.sampleIndex,
            value: measurements.value,
            disposition: measurements.disposition,
          })
          .from(measurements)
          .leftJoin(
            dimensions,
            and(
              eq(dimensions.id, measurements.dimensionId),
              eq(dimensions.companyId, measurements.companyId),
            ),
          )
          .where(
            and(
              inArray(measurements.dataSheetId, sheetIds),
              eq(measurements.isCurrent, true),
            ),
          )
          .orderBy(
            asc(measurements.dataSheetId),
            asc(dimensions.name),
            asc(measurements.sampleIndex),
          );

  const ncRows = await tx
    .select({
      id: nonconformances.id,
      ncNumber: nonconformances.ncNumber,
      status: nonconformances.status,
      disposition: nonconformances.disposition,
      title: nonconformances.title,
      workOrderOperationId: nonconformances.workOrderOperationId,
    })
    .from(nonconformances)
    .where(eq(nonconformances.workOrderId, workOrderId))
    .orderBy(asc(nonconformances.createdAt));

  const ncIds = ncRows.map((n) => n.id);
  const sigRows =
    ncIds.length === 0
      ? []
      : await tx
          .select({
            id: signatures.id,
            meaning: signatures.meaning,
            signerName: signatures.signerName,
            signedAt: signatures.signedAt,
            entityType: signatures.entityType,
            entityId: signatures.entityId,
          })
          .from(signatures)
          .where(
            and(
              eq(signatures.entityType, "nonconformance"),
              inArray(signatures.entityId, ncIds),
            ),
          )
          .orderBy(asc(signatures.signedAt));

  const ncById = new Map(ncRows.map((n) => [n.id, n]));

  const executionsByOp = new Map<string, DhrExecutionEntry[]>();
  for (const ex of executions) {
    const list = executionsByOp.get(ex.workOrderOperationId) ?? [];
    list.push({
      id: ex.id,
      qtyGood: ex.qtyGood,
      qtyScrap: ex.qtyScrap,
      performedBy: ex.performedBy,
      performedByName: ex.performedByName,
      performedAt: ex.performedAt,
      note: ex.note,
      dataSheetId: ex.dataSheetId,
    });
    executionsByOp.set(ex.workOrderOperationId, list);
  }

  const docsByOp = new Map<string, DhrFrozenDocument[]>();
  for (const d of frozenDocs) {
    const snap = (d.snapshot ?? {}) as Record<string, unknown>;
    const list = docsByOp.get(d.workOrderOperationId) ?? [];
    list.push({
      id: d.id,
      role: d.role,
      documentId: d.documentId,
      documentRevisionId: d.documentRevisionId,
      docNumber:
        d.docNumber ??
        (typeof snap.docNumber === "string" ? snap.docNumber : null),
      title: d.title ?? (typeof snap.title === "string" ? snap.title : null),
      rev: d.rev ?? (typeof snap.rev === "string" ? snap.rev : null),
    });
    docsByOp.set(d.workOrderOperationId, list);
  }

  const capsBySheet = new Map<string, DhrCapabilityEntry[]>();
  for (const c of capRows) {
    const list = capsBySheet.get(c.dataSheetId) ?? [];
    list.push({
      id: c.id,
      dimensionId: c.dimensionId,
      dimensionName: c.dimensionName,
      n: c.n,
      mean: c.mean,
      stdDev: c.stdDev,
      cp: c.cp,
      cpk: c.cpk,
      percentYellow: c.percentYellow,
      percentRed: c.percentRed,
    });
    capsBySheet.set(c.dataSheetId, list);
  }

  const measurementsBySheet = new Map<string, DhrMeasurementEntry[]>();
  for (const m of measurementRows) {
    const list = measurementsBySheet.get(m.dataSheetId) ?? [];
    list.push({
      id: m.id,
      dimensionId: m.dimensionId,
      dimensionName: m.dimensionName,
      sampleIndex: m.sampleIndex,
      value: m.value,
      disposition: m.disposition,
    });
    measurementsBySheet.set(m.dataSheetId, list);
  }

  const sheetsByOp = new Map<string, DhrDataSheetEntry[]>();
  for (const s of sheetRows) {
    if (!s.workOrderOperationId) continue;
    const list = sheetsByOp.get(s.workOrderOperationId) ?? [];
    list.push({
      id: s.id,
      lotNumber: s.lotNumber,
      status: s.status,
      completedAt: s.completedAt,
      workOrderOperationId: s.workOrderOperationId,
      capabilitySnapshots: capsBySheet.get(s.id) ?? [],
      measurements: measurementsBySheet.get(s.id) ?? [],
    });
    sheetsByOp.set(s.workOrderOperationId, list);
  }

  const ncsByOp = new Map<string, DhrNcEntry[]>();
  const allNcs: DhrNcEntry[] = ncRows.map((n) => ({
    id: n.id,
    ncNumber: n.ncNumber,
    phase: n.status,
    status: n.status,
    disposition: n.disposition,
    title: n.title,
    workOrderOperationId: n.workOrderOperationId,
  }));
  for (const n of allNcs) {
    if (!n.workOrderOperationId) continue;
    const list = ncsByOp.get(n.workOrderOperationId) ?? [];
    list.push(n);
    ncsByOp.set(n.workOrderOperationId, list);
  }

  const operations: DhrOperationEntry[] = opRows.map((op) => {
    const docs = docsByOp.get(op.id) ?? [];
    const wiDoc = docs.find((d) => d.role === "wi");
    const status = deriveOpStatus(op.startedAt, op.completedAt);
    return {
      id: op.id,
      opNumber: op.opNumber,
      seq: op.opNumber,
      name: op.name,
      workCenter: op.workCenter,
      status,
      startedAt: op.startedAt,
      startedBy: op.startedBy,
      startedByName: op.startedByName,
      completedAt: op.completedAt,
      completedBy: op.completedBy,
      completedByName: op.completedByName,
      qtyComplete: op.qtyComplete,
      qtyScrap: op.qtyScrap,
      wiDocNumber: wiDoc?.docNumber ?? null,
      wiRev: wiDoc?.rev ?? null,
      operatorName: op.completedByName ?? op.startedByName,
      executions: executionsByOp.get(op.id) ?? [],
      documents: docs,
      dataSheets: sheetsByOp.get(op.id) ?? [],
      nonconformances: ncsByOp.get(op.id) ?? [],
    };
  });

  const signatureEntries: DhrSignatureEntry[] = sigRows.map((s) => {
    const nc = ncById.get(s.entityId);
    return {
      id: s.id,
      meaning: s.meaning,
      signerName: s.signerName,
      signedAt: s.signedAt,
      entityType: s.entityType,
      entityId: s.entityId,
      entityLabel: nc ? nc.ncNumber : null,
    };
  });

  const notes: string[] = [];
  if (operations.length === 0) {
    notes.push("Work order has no operations yet.");
  }

  const hasEvidence =
    operations.some(
      (o) =>
        o.executions.length > 0 ||
        o.documents.length > 0 ||
        o.dataSheets.length > 0,
    ) ||
    allNcs.length > 0 ||
    signatureEntries.length > 0;

  let completeness: DhrResult["completeness"] = "partial";
  if (
    woRow.status === "completed" ||
    woRow.status === "closed"
  ) {
    completeness =
      operations.length > 0 &&
      operations.every((o) => o.completedAt != null)
        ? "full"
        : "partial";
  } else if (!hasEvidence && operations.every((o) => !o.startedAt)) {
    completeness = "partial";
  }

  const opStartTimes = opRows
    .map((o) => o.startedAt)
    .filter((d): d is Date => d != null)
    .map((d) => d.getTime());
  const woStartedAt =
    opStartTimes.length > 0 ? new Date(Math.min(...opStartTimes)) : null;

  return {
    kind: "dhr",
    assembledAt: new Date(),
    completeness,
    companyName,
    workOrderId,
    workOrder: {
      id: woRow.id,
      woNumber: woRow.woNumber,
      partId: woRow.partId,
      partNumber: woRow.partNumber,
      partRevisionId: woRow.partRevisionId,
      partRevision: woRow.partRevision,
      routingRevisionId: woRow.routingRevisionId,
      routingRevision: woRow.routingRevision,
      lotNumber: woRow.lotNumber,
      quantity: woRow.qty,
      status: woRow.status,
      releasedAt: woRow.releasedAt,
      startedAt: woStartedAt,
      completedAt: woRow.completedAt,
    },
    operations,
    dataSheets: sheetRows.map((s) => ({
      id: s.id,
      lotNumber: s.lotNumber,
      status: s.status,
      completedAt: s.completedAt,
    })),
    nonConformances: allNcs.map((n) => ({
      id: n.id,
      ncNumber: n.ncNumber,
      phase: n.phase,
      disposition: n.disposition,
    })),
    signatures: signatureEntries,
    labels: [],
    notes,
  };
}

function dmrToPdfPayload(dmr: DmrResult): DmrPdfPayload {
  return {
    companyName: dmr.companyName,
    partNumber: dmr.part.partNumber,
    description: dmr.part.description,
    customer: dmr.part.customer,
    assembledAt: dmr.assembledAt.toISOString(),
    completeness: dmr.completeness,
    documents: dmr.documents.map((d) => ({
      docNumber: d.docNumber,
      docType: d.docType,
      title: d.title,
      rev: d.releasedRevision.rev,
      releasedAt: toIso(d.releasedRevision.releasedAt),
      releasedByName: d.releasedRevision.releasedByName,
    })),
    routing: dmr.routing
      ? {
          name: dmr.routing.name,
          rev: dmr.routing.rev,
          status: dmr.routing.status,
          releasedAt: toIso(dmr.routing.releasedAt),
          releasedByName: dmr.routing.releasedByName,
          operations: dmr.routing.operations.map((op) => ({
            opNumber: op.opNumber,
            name: op.name,
            workCenter: op.workCenter,
            wiDocNumber: op.wiDocNumber,
          })),
        }
      : null,
    signatures: dmr.signatures.map((s) => ({
      meaning: s.meaning,
      signerName: s.signerName,
      signedAt: s.signedAt.toISOString(),
      entityLabel: s.entityLabel,
    })),
    notes: dmr.notes,
  };
}

function dhrToPdfPayload(dhr: DhrResult): DhrPdfPayload {
  if (!dhr.workOrder) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Work order not found",
    });
  }
  return {
    companyName: dhr.companyName,
    assembledAt: dhr.assembledAt.toISOString(),
    completeness: dhr.completeness,
    workOrder: {
      woNumber: dhr.workOrder.woNumber ?? dhr.workOrderId,
      partNumber: dhr.workOrder.partNumber,
      partRevisionId: dhr.workOrder.partRevisionId,
      partRevision: dhr.workOrder.partRevision,
      routingRevisionId: dhr.workOrder.routingRevisionId,
      routingRevision: dhr.workOrder.routingRevision,
      lotNumber: dhr.workOrder.lotNumber,
      quantity: dhr.workOrder.quantity,
      status: dhr.workOrder.status ?? "—",
      releasedAt: toIso(dhr.workOrder.releasedAt),
      startedAt: toIso(dhr.workOrder.startedAt),
      completedAt: toIso(dhr.workOrder.completedAt),
    },
    operations: dhr.operations.map((op) => ({
      opNumber: op.opNumber,
      name: op.name,
      workCenter: op.workCenter,
      status: op.status,
      startedAt: toIso(op.startedAt),
      startedByName: op.startedByName,
      completedAt: toIso(op.completedAt),
      completedByName: op.completedByName,
      qtyComplete: op.qtyComplete,
      qtyScrap: op.qtyScrap,
      executions: op.executions.map((ex) => ({
        performedByName: ex.performedByName,
        performedAt: ex.performedAt.toISOString(),
        qtyGood: ex.qtyGood,
        qtyScrap: ex.qtyScrap,
        note: ex.note,
      })),
      documents: op.documents.map((d) => ({
        role: d.role,
        docNumber: d.docNumber,
        rev: d.rev,
        title: d.title,
      })),
      dataSheets: op.dataSheets.map((ds) => ({
        lotNumber: ds.lotNumber,
        status: ds.status,
        completedAt: toIso(ds.completedAt),
        capabilities: ds.capabilitySnapshots.map((c) => ({
          dimensionName: c.dimensionName,
          n: c.n,
          mean: c.mean,
          stdDev: c.stdDev,
          cp: c.cp,
          cpk: c.cpk,
        })),
        measurements: ds.measurements.map((m) => ({
          dimensionName: m.dimensionName,
          sampleIndex: m.sampleIndex,
          value: m.value,
          disposition: m.disposition,
        })),
      })),
      nonconformances: op.nonconformances.map((n) => ({
        ncNumber: n.ncNumber,
        status: n.status,
        disposition: n.disposition,
        title: n.title,
      })),
    })),
    signatures: dhr.signatures.map((s) => ({
      meaning: s.meaning,
      signerName: s.signerName,
      signedAt: s.signedAt.toISOString(),
      entityLabel: s.entityLabel,
    })),
    notes: dhr.notes,
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const recordsRouter = router({
  /** Device Master Record for a part — released documents + released routing. */
  dmrForPart: tenantProcedure
    .input(z.object({ partId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<DmrResult> => {
      return asTenant(ctx.db, ctx.companyId, async (tx) =>
        assembleDmr(tx, ctx.companyId, input.partId),
      );
    }),

  /** Device History Record for a work order — full execution evidence pack. */
  dhrForWorkOrder: tenantProcedure
    .input(z.object({ workOrderId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<DhrResult> => {
      return asTenant(ctx.db, ctx.companyId, async (tx) =>
        assembleDhr(tx, ctx.companyId, input.workOrderId),
      );
    }),

  /** PDF export of the assembled DMR. */
  exportDmrPdf: tenantProcedure
    .input(z.object({ partId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const dmr = await asTenant(ctx.db, ctx.companyId, async (tx) =>
        assembleDmr(tx, ctx.companyId, input.partId),
      );
      const buffer = await generateDmrPdf(dmrToPdfPayload(dmr));
      const fileName = `DMR_${sanitizeFileToken(dmr.part.partNumber)}.pdf`;

      await asTenant(ctx.db, ctx.companyId, async (tx) => {
        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "records.generate_dmr",
          entityType: "part",
          entityId: input.partId,
          metadata: {
            fileName,
            completeness: dmr.completeness,
            documentCount: dmr.documents.length,
          },
        });
      });

      return {
        fileName,
        contentBase64: buffer.toString("base64"),
      };
    }),

  /** PDF export of the assembled DHR. */
  exportDhrPdf: tenantProcedure
    .input(z.object({ workOrderId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const dhr = await asTenant(ctx.db, ctx.companyId, async (tx) =>
        assembleDhr(tx, ctx.companyId, input.workOrderId),
      );
      const buffer = await generateDhrPdf(dhrToPdfPayload(dhr));
      const woLabel = sanitizeFileToken(
        dhr.workOrder?.woNumber ?? input.workOrderId.slice(0, 8),
      );
      const fileName = `DHR_${woLabel}.pdf`;

      await asTenant(ctx.db, ctx.companyId, async (tx) => {
        await tx.insert(auditLogs).values({
          companyId: ctx.companyId,
          actorId: ctx.auth.user.id,
          action: "records.generate_dhr",
          entityType: "work_order",
          entityId: input.workOrderId,
          metadata: {
            fileName,
            completeness: dhr.completeness,
            operationCount: dhr.operations.length,
          },
        });
      });

      return {
        fileName,
        contentBase64: buffer.toString("base64"),
      };
    }),
});
