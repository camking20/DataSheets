"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Circle,
  Loader2,
  PenLine,
} from "lucide-react";
import {
  canCloseNc,
  nextNcStatus,
  type NcDisposition,
  type NcStatus,
} from "@datasheets/core";
import { trpc, type AppRouter } from "@/lib/trpc";
import { formatApiError } from "@/lib/errors";
import { useSession } from "@/hooks/use-session";
import { cn, formatDateTime, titleCase } from "@/lib/utils";
import {
  AuditTrail,
  SignatureModal,
  type AuditTrailEntry,
} from "@/components/qms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";

const NC_PHASES: readonly NcStatus[] = [
  "initiation",
  "containment",
  "disposition_planning",
  "disposition_execution",
  "investigation",
  "closure",
] as const;

const PHASE_LABELS: Record<NcStatus, string> = {
  initiation: "Initiation",
  containment: "Containment",
  disposition_planning: "Disposition plan",
  disposition_execution: "Disposition exec",
  investigation: "Investigation",
  closure: "Closure",
};

const DISPOSITIONS: readonly NcDisposition[] = [
  "use_as_is",
  "rework",
  "repair",
  "scrap",
  "return_to_vendor",
] as const;

/** Display-only — server computes the real content hash on sign. */
const SERVER_HASH_LABEL = "Computed by server on sign";

type NcDetail = inferRouterOutputs<AppRouter>["nc"]["getById"];
type NcEvent = NcDetail["events"][number];
type LinkedCapa = NcDetail["capas"][number];

type SignTarget = "disposition" | "closure" | "acceptable" | null;

function isPastDispositionPlanning(status: NcStatus): boolean {
  return NC_PHASES.indexOf(status) > NC_PHASES.indexOf("disposition_planning");
}

export default function NcDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { me } = useSession();
  const canSignDisposition =
    me?.role === "quality" || me?.role === "admin";

  const [actionError, setActionError] = useState<string | null>(null);
  const [signTarget, setSignTarget] = useState<SignTarget>(null);
  const [dispositionChoice, setDispositionChoice] =
    useState<NcDisposition>("rework");

  const [containmentActions, setContainmentActions] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [riskAnalysis, setRiskAnalysis] = useState("");
  const [dispositionNotes, setDispositionNotes] = useState("");
  const [quantityAffected, setQuantityAffected] = useState("");

  const detailQuery = trpc.nc.getById.useQuery({ id }, { enabled: !!id });

  const detail = detailQuery.data;
  const nc = detail?.nonconformance;
  const events = detail?.events ?? [];
  const capas = detail?.capas ?? [];
  const signatures = detail?.signatures ?? [];

  useEffect(() => {
    if (!nc) return;
    setContainmentActions(nc.containmentActions ?? "");
    setRootCause(nc.rootCause ?? "");
    setRiskAnalysis(nc.riskAnalysis ?? "");
    setDispositionNotes(nc.dispositionNotes ?? "");
    setQuantityAffected(
      nc.quantityAffected != null ? String(nc.quantityAffected) : "",
    );
    if (nc.disposition) setDispositionChoice(nc.disposition);
  }, [
    nc?.id,
    nc?.containmentActions,
    nc?.rootCause,
    nc?.riskAnalysis,
    nc?.dispositionNotes,
    nc?.quantityAffected,
    nc?.disposition,
  ]);

  const utils = trpc.useUtils();
  function invalidate() {
    void utils.nc.getById.invalidate({ id });
    void utils.nc.list.invalidate();
    void utils.nc.listTriage.invalidate();
  }

  const triageMutation = trpc.nc.triage.useMutation({
    onSuccess: () => {
      setSignTarget(null);
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to triage NC.")),
  });

  const advanceMutation = trpc.nc.advancePhase.useMutation({
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to advance phase.")),
  });

  const updateMutation = trpc.nc.updateFields.useMutation({
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to save fields.")),
  });

  const dispositionMutation = trpc.nc.setDisposition.useMutation({
    onSuccess: () => {
      setSignTarget(null);
      setActionError(null);
      invalidate();
    },
  });

  const closeMutation = trpc.nc.close.useMutation({
    onSuccess: () => {
      setSignTarget(null);
      setActionError(null);
      invalidate();
    },
  });

  const auditEntries: AuditTrailEntry[] = useMemo(
    () =>
      events.map((ev: NcEvent) => ({
        createdAt: ev.createdAt,
        actorName: null,
        action: ev.eventType,
        metadata: {
          ...(ev.fromStatus ? { from: ev.fromStatus } : {}),
          ...(ev.toStatus ? { to: ev.toStatus } : {}),
          ...(ev.note ? { note: ev.note } : {}),
          ...(ev.metadata ?? {}),
        },
      })),
    [events],
  );

  if (detailQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (detailQuery.isError || !nc) {
    return (
      <Card className="mx-auto max-w-4xl">
        <CardContent className="py-10 text-center text-sm text-zinc-500">
          Couldn&apos;t load this nonconformance.
          <div className="mt-4">
            <Link
              href="/quality/nc"
              className="text-sm font-medium text-zinc-800 underline-offset-2 hover:underline"
            >
              Back to NC queue
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const needsTriage =
    nc.status === "initiation" && nc.triageDecision == null;
  const next = nextNcStatus(nc.status);
  const canAdvance =
    next != null &&
    next !== "disposition_execution" &&
    next !== "closure" &&
    nc.status !== "initiation";
  const canSetDisposition = nc.status === "disposition_planning";
  const isClosed = nc.status === "closure";

  const hasDispositionSig = signatures.some((s) => s.meaning === "disposition");
  const fieldsFrozen =
    hasDispositionSig || isPastDispositionPlanning(nc.status);

  const openCapaCount = capas.filter(
    (c: LinkedCapa) => c.status !== "closed",
  ).length;
  const closeGate = canCloseNc({
    status: nc.status,
    capaRequired: nc.capaRequired,
    rootCause: nc.rootCause,
    containmentActions: nc.containmentActions,
    openCapaCount,
  });
  const canClose = nc.status === "investigation";

  const signMeaningLabel =
    signTarget === "disposition"
      ? "NC disposition"
      : signTarget === "acceptable"
        ? "Acceptable disposition (close)"
        : "NC closure";

  const signEntitySummary = `${nc.ncNumber}${nc.title ? ` — ${nc.title}` : ""} (${PHASE_LABELS[nc.status]}${
    signTarget === "disposition"
      ? ` → ${titleCase(dispositionChoice.replace(/_/g, " "))}`
      : signTarget === "acceptable"
        ? " → use as is / closure"
        : ""
  })`;

  async function handleSaveFields(e: React.FormEvent) {
    e.preventDefault();
    if (fieldsFrozen) {
      setActionError(
        "Disposition, root cause, containment, and risk fields are frozen after disposition",
      );
      return;
    }
    const qty =
      quantityAffected.trim() === ""
        ? null
        : Number.parseInt(quantityAffected, 10);
    if (quantityAffected.trim() !== "" && Number.isNaN(qty)) {
      setActionError("Quantity affected must be a number.");
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: nc!.id,
        containmentActions: containmentActions.trim() || null,
        rootCause: rootCause.trim() || null,
        riskAnalysis: riskAnalysis.trim() || null,
        dispositionNotes: dispositionNotes.trim() || null,
        quantityAffected: qty,
      });
    } catch (err) {
      setActionError(formatApiError(err, "Unable to save fields."));
    }
  }

  async function handleSign({ password }: { password: string }) {
    try {
      if (signTarget === "disposition") {
        await dispositionMutation.mutateAsync({
          id: nc!.id,
          disposition: dispositionChoice,
          dispositionNotes: dispositionNotes.trim() || undefined,
          password,
        });
      } else if (signTarget === "closure") {
        await closeMutation.mutateAsync({
          id: nc!.id,
          password,
        });
      } else if (signTarget === "acceptable") {
        await triageMutation.mutateAsync({
          id: nc!.id,
          decision: "acceptable",
          password,
        });
      }
    } catch (err) {
      const message =
        signTarget === "closure"
          ? formatApiError(err, "Unable to close NC.")
          : signTarget === "acceptable"
            ? formatApiError(err, "Unable to triage NC.")
            : formatApiError(err, "Unable to set disposition.");
      setActionError(message);
      throw new Error(message);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/quality/nc"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to NC queue
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
                {nc.ncNumber}
              </h1>
              <Badge tone="neutral">{PHASE_LABELS[nc.status]}</Badge>
              {needsTriage ? <Badge tone="amber">Needs triage</Badge> : null}
              {nc.capaRequired ? <Badge tone="rose">CAPA required</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              {nc.title?.trim() || "Untitled nonconformance"}
            </p>
          </div>
        </div>
      </div>

      {actionError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {actionError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Lifecycle</CardTitle>
          <CardDescription>
            Linear flow — acceptable product can skip from initiation to
            closure via triage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhaseStepper currentPhase={nc.status} />
        </CardContent>
      </Card>

      {needsTriage ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader>
            <CardTitle>Engineer triage</CardTitle>
            <CardDescription>
              Choose Acceptable, NC, or NC + CAPA before advancing. Acceptable
              requires a quality/admin e-signature.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="gap-1.5"
                disabled={triageMutation.isPending || !canSignDisposition}
                title={
                  canSignDisposition
                    ? undefined
                    : "Only quality or admin may accept and close with disposition signature"
                }
                onClick={() => setSignTarget("acceptable")}
              >
                <PenLine className="h-3.5 w-3.5" />
                Acceptable
              </Button>
              <Button
                type="button"
                disabled={triageMutation.isPending}
                onClick={() =>
                  triageMutation.mutate({ id: nc.id, decision: "nc" })
                }
              >
                NC
              </Button>
              <Button
                type="button"
                disabled={triageMutation.isPending}
                onClick={() =>
                  triageMutation.mutate({ id: nc.id, decision: "nc_capa" })
                }
              >
                NC + CAPA
              </Button>
            </div>
            {!canSignDisposition ? (
              <p className="text-xs text-zinc-500">
                Acceptable is signed by quality or admin only.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Record</CardTitle>
              <CardDescription>
                Description, containment, root cause, risk, and disposition.
                {fieldsFrozen
                  ? " Frozen fields cannot be edited after disposition."
                  : null}
              </CardDescription>
            </div>
            {!isClosed && !fieldsFrozen ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                isLoading={updateMutation.isPending}
                onClick={handleSaveFields}
              >
                Save fields
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveFields} className="space-y-4">
            <div>
              <Label>Description</Label>
              <p className="mt-1 whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800">
                {nc.description}
              </p>
            </div>
            <div>
              <Label htmlFor="containment">Containment</Label>
              <Textarea
                id="containment"
                value={containmentActions}
                onChange={(e) => setContainmentActions(e.target.value)}
                rows={3}
                disabled={isClosed || fieldsFrozen || updateMutation.isPending}
                placeholder="Quarantine / hold actions taken"
              />
            </div>
            <div>
              <Label htmlFor="root-cause">Root cause</Label>
              <Textarea
                id="root-cause"
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
                rows={3}
                disabled={isClosed || fieldsFrozen || updateMutation.isPending}
                placeholder="Why did this happen?"
              />
            </div>
            <div>
              <Label htmlFor="risk">Risk analysis</Label>
              <Textarea
                id="risk"
                value={riskAnalysis}
                onChange={(e) => setRiskAnalysis(e.target.value)}
                rows={3}
                disabled={isClosed || fieldsFrozen || updateMutation.isPending}
                placeholder="Impact and risk to product / patient / process"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="qty">Quantity affected</Label>
                <Input
                  id="qty"
                  type="number"
                  min={0}
                  value={quantityAffected}
                  onChange={(e) => setQuantityAffected(e.target.value)}
                  disabled={isClosed || updateMutation.isPending}
                />
              </div>
              <div>
                <Label>Current disposition</Label>
                <p className="mt-2 text-sm font-medium text-zinc-900">
                  {nc.disposition
                    ? titleCase(nc.disposition.replace(/_/g, " "))
                    : "—"}
                </p>
              </div>
            </div>
            <div>
              <Label htmlFor="disp-notes">Disposition notes</Label>
              <Textarea
                id="disp-notes"
                value={dispositionNotes}
                onChange={(e) => setDispositionNotes(e.target.value)}
                rows={2}
                disabled={isClosed || fieldsFrozen || updateMutation.isPending}
              />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
          <CardDescription>
            Advance phases, sign disposition, or close with e-signature.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canAdvance ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                className="gap-1.5"
                isLoading={advanceMutation.isPending}
                onClick={() => advanceMutation.mutate({ id: nc.id })}
              >
                Advance to {PHASE_LABELS[next!]}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
              <p className="text-sm text-zinc-500">
                Moves {PHASE_LABELS[nc.status]} → {PHASE_LABELS[next!]}
              </p>
            </div>
          ) : null}

          {canSetDisposition ? (
            <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/60 p-4">
              <p className="text-sm font-medium text-zinc-900">
                Set disposition (signed)
              </p>
              <div className="flex flex-wrap gap-2">
                {DISPOSITIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDispositionChoice(d)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors",
                      dispositionChoice === d
                        ? "bg-zinc-900 text-white ring-zinc-900"
                        : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50",
                    )}
                  >
                    {titleCase(d.replace(/_/g, " "))}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                className="gap-1.5"
                disabled={!canSignDisposition}
                title={
                  canSignDisposition
                    ? undefined
                    : "Only quality or admin may sign disposition"
                }
                onClick={() => setSignTarget("disposition")}
              >
                <PenLine className="h-3.5 w-3.5" />
                Sign disposition
              </Button>
            </div>
          ) : null}

          {canClose ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  className="gap-1.5"
                  disabled={!canSignDisposition || !closeGate.ok}
                  title={
                    !canSignDisposition
                      ? "Only quality or admin may close"
                      : !closeGate.ok
                        ? closeGate.reason
                        : undefined
                  }
                  onClick={() => setSignTarget("closure")}
                >
                  <PenLine className="h-3.5 w-3.5" />
                  Close NC
                </Button>
                <p className="text-sm text-zinc-500">
                  Requires quality/admin e-signature.
                </p>
              </div>
              {!closeGate.ok && closeGate.reason ? (
                <p className="text-sm text-amber-700">{closeGate.reason}</p>
              ) : null}
            </div>
          ) : null}

          {!canAdvance && !canSetDisposition && !canClose && !needsTriage ? (
            <p className="text-sm text-zinc-500">
              {isClosed
                ? `Closed ${nc.closedAt ? formatDateTime(nc.closedAt) : ""}.`
                : "No phase actions available right now."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {capas.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Linked CAPAs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {capas.map((c: LinkedCapa) => (
              <Link
                key={c.id}
                href={`/quality/capa/${c.id}`}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2.5 text-sm transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                <span className="font-medium text-zinc-900">
                  {c.capaNumber}
                  {c.title ? (
                    <span className="ml-2 font-normal text-zinc-500">
                      {c.title}
                    </span>
                  ) : null}
                </span>
                <Badge tone="neutral">{titleCase(c.status)}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Event timeline</CardTitle>
          <CardDescription>
            Phase transitions, triage, disposition, and closure events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditTrail
            entries={auditEntries}
            emptyMessage="No events yet."
          />
        </CardContent>
      </Card>

      <SignatureModal
        open={signTarget != null}
        onClose={() => setSignTarget(null)}
        meaningLabel={signMeaningLabel}
        entitySummary={signEntitySummary}
        contentSha256={SERVER_HASH_LABEL}
        onSign={handleSign}
      />
    </div>
  );
}

function PhaseStepper({ currentPhase }: { currentPhase: NcStatus }) {
  const currentIndex = NC_PHASES.indexOf(currentPhase);

  return (
    <ol className="flex flex-col gap-0 sm:flex-row sm:items-start sm:justify-between">
      {NC_PHASES.map((phase, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li
            key={phase}
            className="relative flex flex-1 items-start gap-3 sm:flex-col sm:items-center sm:gap-2"
          >
            {index < NC_PHASES.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px sm:left-[calc(50%+14px)] sm:top-[15px] sm:h-px sm:w-[calc(100%-28px)]",
                  done ? "bg-zinc-900" : "bg-zinc-200",
                )}
              />
            ) : null}
            <span
              className={cn(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-2 ring-offset-2 ring-offset-white",
                done && "bg-zinc-900 text-white ring-zinc-900",
                active && "bg-white text-zinc-900 ring-zinc-900",
                !done && !active && "bg-white text-zinc-400 ring-zinc-200",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <div className="pb-6 sm:pb-0 sm:text-center">
              <p
                className={cn(
                  "text-sm font-medium",
                  active || done ? "text-zinc-900" : "text-zinc-400",
                )}
              >
                {PHASE_LABELS[phase]}
              </p>
              {active ? (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500 sm:justify-center">
                  <Circle className="h-1.5 w-1.5 fill-amber-500 text-amber-500" />
                  Current
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
