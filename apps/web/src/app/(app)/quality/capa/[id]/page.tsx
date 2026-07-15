"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeft, Check, Loader2, Plus } from "lucide-react";
import { trpc, type AppRouter } from "@/lib/trpc";
import { formatApiError } from "@/lib/errors";
import { cn, formatDateTime, titleCase } from "@/lib/utils";
import { meaningLabel, SignatureModal } from "@/components/qms";
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

type RouterOutputs = inferRouterOutputs<AppRouter>;
type CapaDetail = RouterOutputs["capa"]["getById"];
type CapaAction = CapaDetail["actions"][number];

/**
 * Preview hash for SignatureModal display only.
 * Close mutation omits contentSha256 — server computes and binds.
 * Matches packages/core hashCapaContent canonical JSON shape.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

async function previewCapaContentSha256(input: {
  id: string;
  capaNumber: string;
  status: string;
  title: string | null;
  description: string;
  rootCause: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  effectivenessCheck: string | null;
  actionSummaries: string[];
}): Promise<string> {
  const payload = {
    ...input,
    actionSummaries: [...input.actionSummaries].sort(),
  };
  const data = new TextEncoder().encode(JSON.stringify(canonicalize(payload)));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function CapaDetailPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const utils = trpc.useUtils();

  const [actionDesc, setActionDesc] = useState("");
  const [effectiveness, setEffectiveness] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [signOpen, setSignOpen] = useState(false);
  const [previewSha256, setPreviewSha256] = useState("");
  const [error, setError] = useState<string | null>(null);

  const query = trpc.capa.getById.useQuery({ id }, { enabled: Boolean(id) });
  const payload = query.data;
  const capa = payload?.capa;
  const actions = payload?.actions ?? [];
  const nonconformance = payload?.nonconformance ?? null;

  const actionSummaries = useMemo(
    () => (payload?.actions ?? []).map((a) => a.description),
    [payload?.actions],
  );

  useEffect(() => {
    if (!capa?.id) return;
    if (capa.effectivenessCheck) setEffectiveness(capa.effectivenessCheck);
  }, [capa?.id, capa?.effectivenessCheck]);

  useEffect(() => {
    if (!capa || !signOpen) {
      setPreviewSha256("");
      return;
    }
    let cancelled = false;
    void previewCapaContentSha256({
      id: capa.id,
      capaNumber: capa.capaNumber,
      status: capa.status,
      title: capa.title,
      description: capa.description,
      rootCause: capa.rootCause,
      correctiveAction: capa.correctiveAction,
      preventiveAction: capa.preventiveAction,
      effectivenessCheck: capa.effectivenessCheck,
      actionSummaries,
    }).then((hash) => {
      if (!cancelled) setPreviewSha256(hash);
    });
    return () => {
      cancelled = true;
    };
  }, [
    signOpen,
    capa?.id,
    capa?.capaNumber,
    capa?.status,
    capa?.title,
    capa?.description,
    capa?.rootCause,
    capa?.correctiveAction,
    capa?.preventiveAction,
    capa?.effectivenessCheck,
    actionSummaries,
  ]);

  const addAction = trpc.capa.addAction.useMutation({
    onSuccess: () => {
      setActionDesc("");
      void query.refetch();
    },
    onError: (e) => setError(formatApiError(e)),
  });
  const completeAction = trpc.capa.completeAction.useMutation({
    onSuccess: () => void query.refetch(),
    onError: (e) => setError(formatApiError(e)),
  });
  const setStatus = trpc.capa.setStatus.useMutation({
    onSuccess: () => void query.refetch(),
    onError: (e) => setError(formatApiError(e)),
  });
  const recordEffectiveness = trpc.capa.recordEffectiveness.useMutation({
    onSuccess: () => {
      setVerifyPassword("");
      void query.refetch();
    },
    onError: (e) => setError(formatApiError(e)),
  });
  const closeMutation = trpc.capa.close.useMutation({
    onSuccess: async () => {
      setSignOpen(false);
      await query.refetch();
      await utils.capa.list.invalidate();
    },
    onError: (e) => setError(formatApiError(e)),
  });

  const nextStatus = useMemo(() => {
    if (!capa) return null;
    if (capa.status === "open") return "in_progress" as const;
    if (capa.status === "in_progress") return "verification" as const;
    return null;
  }, [capa?.status]);

  if (query.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (query.isError || !capa) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <Link
          href="/quality/capa"
          className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back to CAPAs
        </Link>
        <p className="text-sm text-red-600">
          {query.error ? formatApiError(query.error) : "CAPA not found"}
        </p>
      </div>
    );
  }

  const closed = capa.status === "closed";
  const canClose = capa.status === "verification";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/quality/capa"
            className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900"
          >
            <ArrowLeft className="h-4 w-4" /> CAPAs
          </Link>
          <h1 className="mt-2 font-mono text-xl font-semibold text-zinc-900">
            {capa.capaNumber}
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            {capa.title ?? capa.description}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={closed ? "emerald" : "amber"}>
              {titleCase(capa.status)}
            </Badge>
            {nonconformance ? (
              <Link
                href={`/quality/nc/${nonconformance.id}`}
                className="text-xs font-medium text-sky-700 hover:underline"
              >
                Linked {nonconformance.ncNumber}
              </Link>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {nextStatus ? (
            <Button
              type="button"
              variant="secondary"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ id: capa.id, status: nextStatus })}
            >
              Advance to {titleCase(nextStatus)}
            </Button>
          ) : null}
          {canClose ? (
            <Button type="button" onClick={() => setSignOpen(true)}>
              Close with signature
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan</CardTitle>
          <CardDescription>
            Root cause, corrective and preventive actions.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Root cause" value={capa.rootCause} />
          <Field label="Risk assessment" value={capa.riskAssessment} />
          <Field label="Corrective action" value={capa.correctiveAction} />
          <Field label="Preventive action" value={capa.preventiveAction} />
          <div className="sm:col-span-2">
            <Field label="Description" value={capa.description} />
          </div>
          <p className="text-xs text-zinc-500 sm:col-span-2">
            Due{" "}
            {capa.dueAt ? formatDateTime(new Date(capa.dueAt)) : "—"}
            {capa.closedAt
              ? ` · Closed ${formatDateTime(new Date(capa.closedAt))}`
              : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Action items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2">
            {actions.map((a: CapaAction) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2"
              >
                <div>
                  <p
                    className={cn(
                      "text-sm text-zinc-800",
                      a.status === "completed" && "line-through text-zinc-400",
                    )}
                  >
                    {a.description}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {titleCase(a.status)}
                    {a.dueAt
                      ? ` · due ${formatDateTime(new Date(a.dueAt))}`
                      : ""}
                  </p>
                </div>
                {a.status !== "completed" && !closed ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => completeAction.mutate({ id: a.id })}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Complete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {!closed ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={actionDesc}
                onChange={(e) => setActionDesc(e.target.value)}
                placeholder="New action item…"
                className="flex-1"
              />
              <Button
                type="button"
                disabled={!actionDesc.trim() || addAction.isPending}
                onClick={() =>
                  addAction.mutate({
                    capaId: capa.id,
                    description: actionDesc.trim(),
                  })
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                Add
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Effectiveness</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="eff">Effectiveness check</Label>
          <Textarea
            id="eff"
            value={effectiveness}
            onChange={(e) => setEffectiveness(e.target.value)}
            disabled={closed}
            rows={3}
          />
          {!closed ? (
            <>
              <div>
                <Label htmlFor="eff-password">Password (required to verify)</Label>
                <Input
                  id="eff-password"
                  type="password"
                  autoComplete="current-password"
                  value={verifyPassword}
                  onChange={(e) => setVerifyPassword(e.target.value)}
                  placeholder="Confirm your password"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={
                  !effectiveness.trim() ||
                  !verifyPassword ||
                  recordEffectiveness.isPending
                }
                onClick={() =>
                  recordEffectiveness.mutate({
                    id: capa.id,
                    effectivenessCheck: effectiveness.trim(),
                    verify: true,
                    password: verifyPassword,
                  })
                }
              >
                Save & verify
              </Button>
            </>
          ) : (
            <p className="text-sm text-zinc-600">
              {capa.effectivenessCheck ?? "—"}
            </p>
          )}
        </CardContent>
      </Card>

      <SignatureModal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        meaningLabel={meaningLabel("closure")}
        entitySummary={`${capa.capaNumber} — ${capa.title ?? "CAPA"}`}
        contentSha256={previewSha256 || "computing…"}
        onSign={async ({ password }) => {
          try {
            // Server computes and binds contentSha256 — do not send a client hash.
            await closeMutation.mutateAsync({
              id: capa.id,
              password,
            });
          } catch (e) {
            throw new Error(formatApiError(e));
          }
        }}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">
        {value?.trim() ? value : "—"}
      </p>
    </div>
  );
}
