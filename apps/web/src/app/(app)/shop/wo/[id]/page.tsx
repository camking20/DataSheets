"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  ClipboardCheck,
  FileText,
  Hash,
  Loader2,
  Pause,
  Play,
  ExternalLink,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc, type AppRouter } from "@/lib/trpc";
import { useSession } from "@/hooks/use-session";
import { formatApiError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { PdfPreview } from "@/components/qms";
import { cn, titleCase } from "@/lib/utils";
import type { WorkOrderStatus } from "@datasheets/core";

const STATUS_TONE: Record<
  WorkOrderStatus,
  "neutral" | "emerald" | "amber" | "rose" | "sky"
> = {
  planned: "neutral",
  released: "sky",
  in_progress: "amber",
  on_hold: "rose",
  completed: "emerald",
  closed: "neutral",
  cancelled: "neutral",
};

type RouterOutputs = inferRouterOutputs<AppRouter>;
type GetByIdResult = RouterOutputs["workOrders"]["getById"];
type WoOperation = GetByIdResult["operations"][number];
type FrozenDoc = WoOperation["documents"][number];

type FrozenDocSnapshot = {
  docNumber?: string;
  title?: string;
  rev?: string;
};

function snapshotOf(doc: FrozenDoc): FrozenDocSnapshot {
  const s = doc.snapshot;
  if (!s || typeof s !== "object") return {};
  return {
    docNumber: typeof s.docNumber === "string" ? s.docNumber : undefined,
    title: typeof s.title === "string" ? s.title : undefined,
    rev: typeof s.rev === "string" ? s.rev : undefined,
  };
}

export default function WorkOrderWorkspacePage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";
  const router = useRouter();
  const { me } = useSession();
  const canEngineer = me?.role === "engineer" || me?.role === "admin";
  const canOperate =
    me?.role === "operator" ||
    me?.role === "engineer" ||
    me?.role === "admin";

  const [qtyGood, setQtyGood] = useState("");
  const [qtyScrap, setQtyScrap] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagTitle, setFlagTitle] = useState("");
  const [flagDescription, setFlagDescription] = useState("");
  const [flagError, setFlagError] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const detailQuery = trpc.workOrders.getById.useQuery(
    { id },
    { enabled: Boolean(id), retry: 1 },
  );
  const detail = detailQuery.data;
  const wo = detail?.workOrder;

  const currentOp = useMemo(() => {
    if (!detail?.operations?.length) return null;
    return (
      detail.operations.find((o) => !o.completedAt) ??
      detail.operations[detail.operations.length - 1] ??
      null
    );
  }, [detail?.operations]);

  const wiDoc = useMemo(() => {
    if (!currentOp?.documents?.length) return null;
    return (
      currentOp.documents.find((d) => d.role === "wi") ??
      currentOp.documents[0] ??
      null
    );
  }, [currentOp?.documents]);

  const wiSnap = wiDoc ? snapshotOf(wiDoc) : null;
  const wiDocumentId = wiDoc?.documentId ?? "";

  const docQuery = trpc.documents.getById.useQuery(
    { id: wiDocumentId },
    { enabled: wiDocumentId.length > 0 },
  );
  const frozenRev = docQuery.data?.revisions?.find(
    (r) => r.id === wiDoc?.documentRevisionId,
  );
  const pdfFileId = frozenRev?.pdfFileId ?? "";

  const pdfDownloadQuery = trpc.files.getDownload.useQuery(
    { id: pdfFileId },
    { enabled: pdfFileId.length > 0 },
  );
  const pdfDownload = pdfDownloadQuery.data;

  function invalidate() {
    void utils.workOrders.getById.invalidate({ id });
    void utils.workOrders.list.invalidate();
    void utils.workOrders.getCurrentOperation.invalidate({ workOrderId: id });
  }

  const releaseMut = trpc.workOrders.release.useMutation({
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to release work order.")),
  });

  const holdMut = trpc.workOrders.hold.useMutation({
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to hold work order.")),
  });

  const resumeMut = trpc.workOrders.resume.useMutation({
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to resume work order.")),
  });

  const startMut = trpc.workOrders.startOperation.useMutation({
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to start operation.")),
  });

  const recordMut = trpc.workOrders.recordExecution.useMutation({
    onSuccess: () => {
      setActionError(null);
      setQtyGood("");
      setQtyScrap("");
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to record execution.")),
  });

  const flagMut = trpc.nc.createFromFlag.useMutation({
    onSuccess: (nc) => {
      setFlagOpen(false);
      setFlagTitle("");
      setFlagDescription("");
      setFlagError(null);
      invalidate();
      router.push(`/quality/nc/${nc.id}`);
    },
    onError: (err) =>
      setFlagError(formatApiError(err, "Unable to flag nonconformance.")),
  });

  const status = wo?.status;
  const opStarted = Boolean(currentOp?.startedAt);
  const opComplete = Boolean(currentOp?.completedAt);
  const canRecord =
    canOperate &&
    opStarted &&
    !opComplete &&
    (status === "in_progress" || status === "released");
  const busy =
    releaseMut.isPending ||
    holdMut.isPending ||
    resumeMut.isPending ||
    startMut.isPending ||
    recordMut.isPending;

  function handleRecord(e: React.FormEvent) {
    e.preventDefault();
    if (!currentOp) return;
    setActionError(null);
    const good = Number(qtyGood || 0);
    const scrap = Number(qtyScrap || 0);
    if (!Number.isInteger(good) || !Number.isInteger(scrap)) {
      setActionError("Quantities must be whole numbers.");
      return;
    }
    if (good === 0 && scrap === 0) {
      setActionError("Enter qty good and/or qty scrap.");
      return;
    }
    recordMut.mutate({
      workOrderOperationId: currentOp.id,
      qtyGood: good,
      qtyScrap: scrap,
    });
  }

  function handleFlag(e: React.FormEvent) {
    e.preventDefault();
    setFlagError(null);
    const description = flagDescription.trim();
    if (!description) {
      setFlagError("Describe the issue.");
      return;
    }
    flagMut.mutate({
      description,
      title: flagTitle.trim() || undefined,
      workOrderId: id,
      workOrderOperationId: currentOp?.id,
      partId: wo?.partId,
    });
  }

  const inspectHref = useMemo(() => {
    if (!detail || !wo) return "/inspect";
    const q = new URLSearchParams();
    if (detail.partNumber) q.set("partNumber", detail.partNumber);
    if (wo.lotNumber) q.set("lotNumber", wo.lotNumber);
    q.set("qty", String(wo.qty));
    if (currentOp?.id) q.set("wooId", currentOp.id);
    q.set("workOrderId", wo.id);
    return `/inspect?${q.toString()}`;
  }, [detail, wo, currentOp?.id]);

  if (detailQuery.isLoading) {
    return (
      <div className="mx-auto flex max-w-4xl items-center justify-center gap-2 py-20 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading work order…
      </div>
    );
  }

  if (detailQuery.isError || !wo || !detail) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 py-10">
        <Link
          href="/shop"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Shop floor
        </Link>
        <Card>
          <CardContent className="py-10 text-center text-sm text-zinc-500">
            Work order not found or could not be loaded.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/shop"
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Shop floor
        </Link>
        <Link
          href={`/shop/wo/${id}/dhr`}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:underline"
        >
          Device history record
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      <header className="rounded-xl border border-zinc-200 bg-white p-5 shadow-panel sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
              Work order
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              {wo.woNumber}
            </h1>
            <p className="text-sm text-zinc-500">
              {detail.partNumber}
              {detail.partDescription ? ` · ${detail.partDescription}` : ""}
              {" · "}Lot {wo.lotNumber ?? "—"}
              {" · "}Qty {wo.qty}
            </p>
            {detail.linkedNcCount > 0 ? (
              <p className="text-xs text-rose-600">
                {detail.linkedNcCount} linked NC
                {detail.linkedNcCount === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={STATUS_TONE[wo.status]}
              className="px-3 py-1 text-sm"
            >
              {titleCase(wo.status)}
            </Badge>
            {canEngineer && wo.status === "planned" ? (
              <Button
                className="min-h-[44px]"
                disabled={busy}
                isLoading={releaseMut.isPending}
                onClick={() => releaseMut.mutate({ id })}
              >
                Release
              </Button>
            ) : null}
            {canOperate && wo.status === "in_progress" ? (
              <Button
                variant="outline"
                className="min-h-[44px] gap-2"
                disabled={busy}
                isLoading={holdMut.isPending}
                onClick={() => holdMut.mutate({ id })}
              >
                <Pause className="h-4 w-4" />
                Hold
              </Button>
            ) : null}
            {canOperate && wo.status === "on_hold" ? (
              <Button
                className="min-h-[44px] gap-2"
                disabled={busy}
                isLoading={resumeMut.isPending}
                onClick={() => resumeMut.mutate({ id })}
              >
                <Play className="h-4 w-4" />
                Resume
              </Button>
            ) : null}
          </div>
        </div>
        {actionError ? (
          <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            {actionError}
          </p>
        ) : null}
      </header>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Current operation</CardTitle>
            <CardDescription>
              Operators work one routing step at a time until qty is complete.
            </CardDescription>
          </div>
          {currentOp ? (
            <Badge tone={opComplete ? "emerald" : opStarted ? "amber" : "neutral"}>
              {opComplete ? "Complete" : opStarted ? "Started" : "Not started"}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          {!currentOp ? (
            <p className="text-sm text-zinc-500">
              No operations on this work order.
            </p>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xl font-semibold text-zinc-900">
                  Op {currentOp.opNumber} · {currentOp.name}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Work center · {currentOp.workCenter ?? "—"}
                  {" · "}
                  Complete {currentOp.qtyComplete} / scrap {currentOp.qtyScrap}{" "}
                  of {wo.qty}
                </p>
              </div>
              {canOperate &&
              !opStarted &&
              !opComplete &&
              (status === "released" ||
                status === "in_progress" ||
                status === "on_hold") ? (
                <Button
                  size="lg"
                  className="min-h-[48px] min-w-[160px]"
                  disabled={busy}
                  isLoading={startMut.isPending}
                  onClick={() =>
                    startMut.mutate({ workOrderOperationId: currentOp.id })
                  }
                >
                  Start operation
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5" />
                Work instruction
              </CardTitle>
              <CardDescription>
                Frozen revision captured when the operation started.
              </CardDescription>
            </div>
            {wiSnap?.rev ? (
              <Badge tone="emerald">Rev {wiSnap.rev}</Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {!opStarted ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-6 py-10 text-center">
                <FileText className="h-8 w-8 text-zinc-300" />
                <p className="text-sm font-medium text-zinc-700">
                  Start the operation to freeze the WI
                </p>
                <p className="max-w-xs text-sm text-zinc-500">
                  The released work instruction is locked in when you start — no
                  superseded revs on the floor.
                </p>
              </div>
            ) : wiDoc ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-zinc-900">
                    {wiSnap?.docNumber ?? "WI"}
                    {wiSnap?.rev ? ` · Rev ${wiSnap.rev}` : ""}
                    {wiSnap?.title ? ` — ${wiSnap.title}` : ""}
                  </p>
                  <Link
                    href={`/documents/${wiDoc.documentId}`}
                    className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-zinc-600 hover:text-zinc-900 hover:underline"
                  >
                    Open document
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
                {pdfFileId ? (
                  pdfDownloadQuery.isLoading ? (
                    <div className="flex min-h-[280px] items-center justify-center gap-2 text-sm text-zinc-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading PDF…
                    </div>
                  ) : (
                    <PdfPreview
                      base64={pdfDownload?.contentBase64}
                      title={`${wiSnap?.docNumber ?? "WI"} PDF`}
                      height={480}
                    />
                  )
                ) : (
                  <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
                    No PDF attached to this revision. Use Open document for the
                    controlled record.
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-6 py-10 text-center">
                <FileText className="h-8 w-8 text-zinc-300" />
                <p className="text-sm text-zinc-500">
                  No frozen WI for this operation.
                </p>
              </div>
            )}

            {currentOp?.requiresDataSheet ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-sky-50 px-4 py-3 ring-1 ring-inset ring-sky-100">
                <ClipboardCheck className="h-4 w-4 shrink-0 text-sky-700" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-sky-900">
                    Data sheet required
                  </p>
                  <p className="text-xs text-sky-700">
                    Start or continue inspection for this lot and operation.
                  </p>
                </div>
                <Link
                  href={inspectHref}
                  className={cn(
                    "inline-flex min-h-[44px] items-center justify-center rounded-md bg-sky-900 px-4 text-sm font-medium text-white",
                    "hover:bg-sky-800",
                  )}
                >
                  Start sheet
                </Link>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-1.5">
                  <Hash className="h-3.5 w-3.5" />
                  Record execution
                </CardTitle>
                <CardDescription>
                  Post good / scrap qty for this operation. No per-op signature.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRecord} className="space-y-4">
                <div>
                  <Label htmlFor="qtyGood">Qty good</Label>
                  <Input
                    id="qtyGood"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="min-h-[52px] text-center text-2xl font-semibold tabular-nums"
                    value={qtyGood}
                    onChange={(e) => setQtyGood(e.target.value)}
                    disabled={!canRecord || busy}
                    placeholder="0"
                  />
                </div>
                <div>
                  <Label htmlFor="qtyScrap">Qty scrap</Label>
                  <Input
                    id="qtyScrap"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="min-h-[52px] text-center text-2xl font-semibold tabular-nums"
                    value={qtyScrap}
                    onChange={(e) => setQtyScrap(e.target.value)}
                    disabled={!canRecord || busy}
                    placeholder="0"
                  />
                </div>
                <Button
                  type="submit"
                  size="lg"
                  className="min-h-[52px] w-full text-base"
                  disabled={!canRecord || busy}
                  isLoading={recordMut.isPending}
                >
                  Record execution
                </Button>
                {!opStarted && !opComplete ? (
                  <p className="text-xs leading-relaxed text-zinc-400">
                    Start the operation before recording quantity.
                  </p>
                ) : null}
                {status === "on_hold" ? (
                  <p className="text-xs leading-relaxed text-rose-600">
                    Work order is on hold — resume before recording.
                  </p>
                ) : null}
                {opComplete ? (
                  <p className="text-xs leading-relaxed text-emerald-700">
                    This operation is complete.
                  </p>
                ) : null}
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Flag issue
                </CardTitle>
                <CardDescription>
                  Open a nonconformance linked to this WO and current op.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {!flagOpen ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px] w-full"
                    onClick={() => setFlagOpen(true)}
                  >
                    Flag NC
                  </Button>
                  <Link
                    href={`/quality/nc?flag=1&wooId=${encodeURIComponent(currentOp?.id ?? "")}&workOrderId=${encodeURIComponent(id)}`}
                    className="block text-center text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:underline"
                  >
                    Or open NC create flow
                  </Link>
                </>
              ) : (
                <form onSubmit={handleFlag} className="space-y-3">
                  <div>
                    <Label htmlFor="flagTitle">Title</Label>
                    <Input
                      id="flagTitle"
                      className="min-h-[44px]"
                      value={flagTitle}
                      onChange={(e) => setFlagTitle(e.target.value)}
                      placeholder="Optional short title"
                    />
                  </div>
                  <div>
                    <Label htmlFor="flagDescription">Description</Label>
                    <Textarea
                      id="flagDescription"
                      rows={3}
                      required
                      value={flagDescription}
                      onChange={(e) => setFlagDescription(e.target.value)}
                      placeholder="What was observed?"
                    />
                  </div>
                  {flagError ? (
                    <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                      {flagError}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-[44px] flex-1"
                      onClick={() => {
                        setFlagOpen(false);
                        setFlagError(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="destructive"
                      className="min-h-[44px] flex-1"
                      isLoading={flagMut.isPending}
                    >
                      Create NC
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
