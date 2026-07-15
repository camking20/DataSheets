"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Factory,
  ShieldAlert,
  AlertCircle,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc, type AppRouter } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { downloadBase64, formatDateTime, titleCase } from "@/lib/utils";
import { formatApiError } from "@/lib/errors";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type DhrResult = RouterOutputs["records"]["dhrForWorkOrder"];
type DhrOperation = DhrResult["operations"][number];
type DhrExecution = DhrOperation["executions"][number];
type DhrFrozenDoc = DhrOperation["documents"][number];
type DhrDataSheet = DhrResult["dataSheets"][number];
type DhrNcRow = {
  id: string;
  ncNumber: string;
  phase: string;
  disposition: string | null;
  title?: string | null;
};

function opNumber(op: DhrOperation): number {
  return op.opNumber ?? op.seq;
}

function executionWho(ex: DhrExecution): string {
  return ex.performedByName || `${ex.performedBy.slice(0, 8)}…`;
}

function executionQty(ex: DhrExecution): string {
  return ex.qtyScrap > 0
    ? `${ex.qtyGood} good / ${ex.qtyScrap} scrap`
    : `${ex.qtyGood} good`;
}

function frozenDocLabel(doc: DhrFrozenDoc): string {
  const number = doc.docNumber || "Document";
  return doc.rev ? `${number} · Rev ${doc.rev}` : number;
}

const completenessTone = {
  stub: "amber" as const,
  partial: "amber" as const,
  full: "emerald" as const,
};

const completenessLabel = {
  stub: "Placeholder",
  partial: "Partial",
  full: "Complete",
};

export default function WorkOrderDhrPage() {
  const params = useParams<{ id: string }>();
  const workOrderId = params.id ?? "";
  const { data, isLoading, isError, error } = trpc.records.dhrForWorkOrder.useQuery(
    { workOrderId },
    { enabled: Boolean(workOrderId), retry: 1 },
  );
  const exportPdf = trpc.records.exportDhrPdf.useMutation();
  const [exportError, setExportError] = useState<string | null>(null);

  async function handleExportPdf() {
    setExportError(null);
    try {
      const result = await exportPdf.mutateAsync({ workOrderId });
      if (!result.contentBase64) {
        setExportError("PDF export returned no file content.");
        return;
      }
      const woLabel = data?.workOrder?.woNumber ?? workOrderId.slice(0, 8);
      downloadBase64(
        result.fileName || `DHR-${woLabel}.pdf`,
        "application/pdf",
        result.contentBase64,
      );
    } catch (err) {
      setExportError(formatApiError(err, "Couldn't export DHR PDF."));
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackToWo workOrderId={workOrderId} />
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <AlertCircle className="h-5 w-5 text-zinc-400" />
            <p className="text-sm text-zinc-500">
              {error?.message ?? "Couldn't load the Device History Record."}
            </p>
            <Link
              href={`/shop/wo/${workOrderId}`}
              className="text-sm font-medium text-zinc-900 hover:underline"
            >
              Back to work order
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const dhr = data;
  const wo = dhr.workOrder;
  const woLabel = wo?.woNumber ?? workOrderId.slice(0, 8);
  const qty = wo?.quantity ?? null;

  const sheets: DhrDataSheet[] =
    dhr.dataSheets.length > 0
      ? dhr.dataSheets
      : dedupeById(
          dhr.operations.flatMap((op) =>
            op.dataSheets.map((s) => ({
              id: s.id,
              lotNumber: s.lotNumber,
              status: s.status,
              completedAt: s.completedAt,
            })),
          ),
        );

  const ncs: DhrNcRow[] = dedupeById([
    ...dhr.operations.flatMap((op) => op.nonconformances),
    ...dhr.nonConformances,
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 print:max-w-none print:space-y-4">
      <div className="border-b border-zinc-200 pb-5 print:border-zinc-300">
        <BackToWo workOrderId={workOrderId} />
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Device History Record
            </p>
            <h1 className="mt-1 font-serif text-2xl tracking-tight text-zinc-900">
              WO {woLabel}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {[
                wo?.partNumber ? `Part ${wo.partNumber}` : null,
                wo?.lotNumber ? `Lot ${wo.lotNumber}` : null,
                qty != null ? `Qty ${qty}` : null,
                wo?.status ? titleCase(wo.status) : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Auto-assembled production record"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge tone={completenessTone[dhr.completeness]}>
                {completenessLabel[dhr.completeness]}
              </Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 print:hidden"
                isLoading={exportPdf.isPending}
                onClick={handleExportPdf}
              >
                {!exportPdf.isPending ? <Download className="h-3.5 w-3.5" /> : null}
                Export PDF
              </Button>
            </div>
            <p className="text-xs text-zinc-400">
              Assembled {formatDateTime(dhr.assembledAt)}
            </p>
            {exportError ? (
              <p className="max-w-xs text-right text-xs text-rose-600 print:hidden">
                {exportError}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {dhr.notes.length > 0 ? (
        <div className="rounded-lg border border-sky-100 bg-sky-50/50 px-4 py-3 text-sm text-sky-900 print:border-zinc-200 print:bg-transparent">
          <ul className="list-disc space-y-1 pl-4">
            {dhr.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {wo ? (
        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white print:rounded-none">
          <SectionHeader
            icon={ClipboardList}
            title="Work order"
            description="Production run identity from MES."
          />
          <div className="px-5 py-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <Meta label="Part" value={wo.partNumber} />
              <Meta label="Lot" value={wo.lotNumber} />
              <Meta label="Quantity" value={qty != null ? String(qty) : null} />
              <Meta label="Status" value={wo.status ? titleCase(wo.status) : null} />
              <Meta label="Started" value={formatDateTime(wo.startedAt ?? null)} />
              <Meta label="Completed" value={formatDateTime(wo.completedAt ?? null)} />
            </dl>
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white print:rounded-none">
        <SectionHeader
          icon={Factory}
          title="Operations & executions"
          description="Routing steps with who completed how many, and when."
          count={dhr.operations.length}
        />
        {dhr.operations.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">
            No operation history for this work order yet.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100">
            {dhr.operations.map((op) => (
                <div key={op.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-7 min-w-7 items-center justify-center rounded-md bg-zinc-100 px-1.5 text-xs font-semibold text-zinc-700">
                        {opNumber(op)}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-zinc-900">{op.name}</p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {[
                            op.workCenter,
                            op.wiDocNumber
                              ? `WI ${op.wiDocNumber}${op.wiRev ? ` rev ${op.wiRev}` : ""}`
                              : null,
                            `${op.qtyComplete} complete${op.qtyScrap ? ` / ${op.qtyScrap} scrap` : ""}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <p className="mt-1 text-xs text-zinc-400">
                          {[
                            op.startedAt
                              ? `Started ${formatDateTime(op.startedAt)}${op.startedByName ? ` by ${op.startedByName}` : ""}`
                              : null,
                            op.completedAt
                              ? `Completed ${formatDateTime(op.completedAt)}${op.completedByName ? ` by ${op.completedByName}` : op.operatorName ? ` by ${op.operatorName}` : ""}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Not started"}
                        </p>
                      </div>
                    </div>
                    <Badge tone={op.status === "completed" ? "emerald" : "neutral"}>
                      {titleCase(op.status)}
                    </Badge>
                  </div>

                  <div className="mt-3 space-y-3 pl-10">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                        Executions
                      </p>
                      {op.executions.length === 0 ? (
                        <p className="mt-1 text-xs text-zinc-500">No execution rows recorded.</p>
                      ) : (
                        <ul className="mt-1.5 divide-y divide-zinc-100 rounded-md border border-zinc-100">
                          {op.executions.map((ex) => (
                            <li
                              key={ex.id}
                              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                            >
                              <span className="font-medium text-zinc-800">
                                {executionWho(ex)}
                              </span>
                              <span className="text-zinc-600">{executionQty(ex)}</span>
                              <span className="text-zinc-400">
                                {formatDateTime(ex.performedAt)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                        Frozen documents
                      </p>
                      {op.documents.length === 0 ? (
                        <p className="mt-1 text-xs text-zinc-500">
                          No frozen WI / drawing revs captured for this op.
                        </p>
                      ) : (
                        <ul className="mt-1.5 space-y-1">
                          {op.documents.map((doc) => (
                            <li
                              key={doc.id}
                              className="flex flex-wrap items-center gap-2 text-xs"
                            >
                              <Badge tone="neutral">{doc.role.toUpperCase()}</Badge>
                              <Link
                                href={`/documents/${doc.documentId}`}
                                className="font-medium text-zinc-800 hover:underline"
                              >
                                {frozenDocLabel(doc)}
                              </Link>
                              {doc.title ? (
                                <span className="text-zinc-500">{doc.title}</span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white print:rounded-none">
        <SectionHeader
          icon={FileSpreadsheet}
          title="Inspection data sheets"
          description="Lot inspection records tied to this production run."
          count={sheets.length}
        />
        {sheets.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">
            No data sheets linked to this work order.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {sheets.map((sheet) => (
              <li
                key={sheet.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <div className="min-w-0">
                  <Link
                    href={`/sheets/${sheet.id}`}
                    className="font-medium text-zinc-900 hover:underline"
                  >
                    Lot {sheet.lotNumber}
                  </Link>
                  <p className="text-xs text-zinc-500">
                    {sheet.completedAt
                      ? `Completed ${formatDateTime(sheet.completedAt)}`
                      : "In progress"}
                  </p>
                </div>
                <Badge tone={sheet.status === "completed" ? "emerald" : "neutral"}>
                  {titleCase(sheet.status)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white print:rounded-none">
        <SectionHeader
          icon={ShieldAlert}
          title="Nonconformances"
          description="NCs raised against this work order or its operations."
          count={ncs.length}
        />
        {ncs.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">
            No nonconformances recorded for this work order.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {ncs.map((nc) => (
              <li
                key={nc.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-zinc-900">{nc.ncNumber}</p>
                  <p className="text-xs text-zinc-500">
                    {[
                      nc.title,
                      `Phase ${titleCase(nc.phase)}`,
                      nc.disposition ? titleCase(nc.disposition) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Badge tone={nc.disposition ? "emerald" : "amber"}>
                  {nc.disposition ? titleCase(nc.disposition) : "Open"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dhr.signatures.length > 0 ? (
        <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white print:rounded-none">
          <SectionHeader
            icon={FileText}
            title="Signatures"
            description="Required e-signatures collected for this record."
            count={dhr.signatures.length}
          />
          <ul className="divide-y divide-zinc-100">
            {dhr.signatures.map((sig) => (
              <li
                key={sig.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-zinc-900">{titleCase(sig.meaning)}</p>
                  <p className="text-xs text-zinc-500">
                    {[sig.signerName || "Unknown signer", sig.entityLabel]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className="text-xs text-zinc-400">{formatDateTime(sig.signedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function BackToWo({ workOrderId }: { workOrderId: string }) {
  return (
    <Link
      href={`/shop/wo/${workOrderId}`}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 print:hidden"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to work order
    </Link>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  description,
  count,
}: {
  icon: typeof Factory;
  title: string;
  description: string;
  count?: number;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 print:hidden">
          <Icon className="h-4 w-4 text-zinc-600" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
        </div>
      </div>
      {typeof count === "number" ? <Badge tone="neutral">{count}</Badge> : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="font-medium text-zinc-900">{value || "—"}</dd>
    </div>
  );
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
