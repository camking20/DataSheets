"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowLeft,
  BookOpen,
  Download,
  FileText,
  Loader2,
  Route,
  AlertCircle,
} from "lucide-react";
import { trpc, type AppRouter } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DocStatusPill } from "@/components/qms/DocStatusPill";
import { downloadBase64, formatDate, formatDateTime, titleCase } from "@/lib/utils";
import { formatApiError } from "@/lib/errors";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type DmrResult = RouterOutputs["records"]["dmrForPart"];
type DmrRoutingOp = NonNullable<DmrResult["routing"]>["operations"][number];

type DocType = DmrResult["documents"][number]["docType"];

const DOC_TYPE_LABEL: Record<DocType, string> = {
  drw: "Drawing",
  pro: "Procedure",
  wi: "Work instruction",
  frm: "Form",
};

const DOC_TYPE_ORDER: DocType[] = ["drw", "pro", "wi", "frm"];

const completenessTone = {
  documents_only: "sky" as const,
  partial: "amber" as const,
  full: "emerald" as const,
};

const completenessLabel = {
  documents_only: "Documents only",
  partial: "Partial",
  full: "Complete",
};

function opLabel(op: DmrRoutingOp): number {
  return op.opNumber ?? op.seq;
}

export default function PartDmrPage() {
  const params = useParams<{ id: string }>();
  const partId = params.id ?? "";
  const { data, isLoading, isError, error } = trpc.records.dmrForPart.useQuery(
    { partId },
    { enabled: Boolean(partId), retry: 1 },
  );
  const exportPdf = trpc.records.exportDmrPdf.useMutation();
  const [exportError, setExportError] = useState<string | null>(null);
  const dmr = data;

  async function handleExportPdf() {
    setExportError(null);
    try {
      const result = await exportPdf.mutateAsync({ partId });
      if (!result.contentBase64) {
        setExportError("PDF export returned no file content.");
        return;
      }
      downloadBase64(
        result.fileName || `DMR-${dmr?.part.partNumber ?? partId}.pdf`,
        "application/pdf",
        result.contentBase64,
      );
    } catch (err) {
      setExportError(formatApiError(err, "Couldn't export DMR PDF."));
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (isError || !dmr) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <BackToPart partId={partId} />
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <AlertCircle className="h-5 w-5 text-zinc-400" />
            <p className="text-sm text-zinc-500">
              {error?.message ?? "Couldn't load the Device Master Record."}
            </p>
            <Link
              href={`/parts/${partId}`}
              className="text-sm font-medium text-zinc-900 hover:underline"
            >
              Back to part
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const byType = DOC_TYPE_ORDER.map((type) => ({
    type,
    docs: dmr.documents.filter((d) => d.docType === type),
  })).filter((g) => g.docs.length > 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6 print:max-w-none print:space-y-4">
      <div className="border-b border-zinc-200 pb-5 print:border-zinc-300">
        <BackToPart partId={dmr.part.id} />
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Device Master Record
            </p>
            <h1 className="mt-1 font-serif text-2xl tracking-tight text-zinc-900">
              {dmr.part.partNumber}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {[
                dmr.part.description || "No description",
                dmr.part.customer,
                dmr.companyName,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge tone={completenessTone[dmr.completeness]}>
                {completenessLabel[dmr.completeness]}
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
              Assembled {formatDateTime(dmr.assembledAt)}
            </p>
            {exportError ? (
              <p className="max-w-xs text-right text-xs text-rose-600 print:hidden">
                {exportError}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {dmr.notes.length > 0 ? (
        <div className="rounded-lg border border-sky-100 bg-sky-50/50 px-4 py-3 text-sm text-sky-900 print:border-zinc-200 print:bg-transparent">
          <ul className="list-disc space-y-1 pl-4">
            {dmr.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white print:rounded-none">
        <div className="border-b border-zinc-100 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 print:hidden">
              <FileText className="h-4 w-4 text-zinc-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Released documents</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Controlled drawings, procedures, work instructions, and forms linked to
                this part. Only the released revision is listed.
              </p>
            </div>
          </div>
        </div>
        {dmr.documents.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-zinc-500">
            No released documents linked to this part yet.
          </p>
        ) : (
          <div className="divide-y divide-zinc-100">
            {byType.map(({ type, docs }) => (
              <div key={type}>
                <div className="flex items-center gap-2 bg-zinc-50/90 px-5 py-2 print:bg-zinc-50">
                  <BookOpen className="h-3.5 w-3.5 text-zinc-400 print:hidden" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    {DOC_TYPE_LABEL[type]}
                  </span>
                  <span className="text-xs text-zinc-400">({docs.length})</span>
                </div>
                <ul className="divide-y divide-zinc-100">
                  {docs.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex items-center justify-between gap-4 px-5 py-3"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/documents/${doc.id}`}
                            className="truncate text-sm font-medium text-zinc-900 hover:underline"
                          >
                            {doc.docNumber}
                          </Link>
                          <Badge tone="neutral">{doc.docType.toUpperCase()}</Badge>
                          <DocStatusPill status={doc.releasedRevision.status} />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-zinc-500">
                          {doc.title || "Untitled"}
                          {" · "}
                          Rev {doc.releasedRevision.rev}
                          {doc.releasedRevision.releasedAt
                            ? ` · Released ${formatDate(doc.releasedRevision.releasedAt)}`
                            : ""}
                        </p>
                      </div>
                      {doc.releasedRevision.pdfFileId ? (
                        <span className="shrink-0 text-xs font-medium text-emerald-700">
                          PDF on file
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs text-zinc-400">No PDF</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white print:rounded-none">
        <div className="border-b border-zinc-100 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 print:hidden">
              <Route className="h-4 w-4 text-zinc-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Released routing</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Manufacturing operation sequence from the released routing.
              </p>
            </div>
          </div>
        </div>
        <div className="px-5 py-4">
          {!dmr.routing ? (
            <p className="text-sm text-zinc-500">
              No released routing for this part.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-zinc-900">
                  {dmr.routing.name ? `${dmr.routing.name} · ` : ""}
                  Rev {dmr.routing.rev}
                </span>
                <Badge tone="emerald">{titleCase(dmr.routing.status)}</Badge>
              </div>
              {dmr.routing.operations.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Routing is released, but no operations are listed yet.
                </p>
              ) : (
                <ol className="divide-y divide-zinc-100 rounded-md border border-zinc-100">
                  {dmr.routing.operations.map((op) => (
                    <li
                      key={`${opLabel(op)}-${op.name}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-7 min-w-7 items-center justify-center rounded-md bg-zinc-100 px-1.5 text-xs font-semibold text-zinc-700">
                          {opLabel(op)}
                        </span>
                        <div>
                          <p className="font-medium text-zinc-900">{op.name}</p>
                          <p className="text-xs text-zinc-500">
                            {[
                              op.workCenter,
                              op.wiDocNumber ? `WI ${op.wiDocNumber}` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function BackToPart({ partId }: { partId: string }) {
  return (
    <Link
      href={`/parts/${partId}`}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 print:hidden"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to part
    </Link>
  );
}
