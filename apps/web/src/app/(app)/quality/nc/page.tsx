"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  ShieldAlert,
} from "lucide-react";
import type { NcStatus } from "@datasheets/core";
import { trpc, type AppRouter } from "@/lib/trpc";
import { formatApiError } from "@/lib/errors";
import { cn, formatDateTime, titleCase } from "@/lib/utils";
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

type FilterTab = "all" | "triage" | NcStatus;

type NcRow = inferRouterOutputs<AppRouter>["nc"]["list"][number];

export default function NcQueuePage() {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const listInput =
    filter === "all" || filter === "triage"
      ? undefined
      : { status: filter };

  const listQuery = trpc.nc.list.useQuery(listInput, {
    enabled: filter !== "triage",
  });
  const triageQuery = trpc.nc.listTriage.useQuery(undefined, {
    enabled: filter === "triage",
  });

  const createMutation = trpc.nc.createFromFlag.useMutation({
    onSuccess: (nc) => {
      setFormError(null);
      setTitle("");
      setDescription("");
      setShowCreate(false);
      void listQuery.refetch();
      void triageQuery.refetch();
      router.push(`/quality/nc/${nc.id}`);
    },
    onError: (err) =>
      setFormError(formatApiError(err, "Unable to create nonconformance.")),
  });

  const items: NcRow[] =
    filter === "triage" ? (triageQuery.data ?? []) : (listQuery.data ?? []);

  const isLoading =
    filter === "triage" ? triageQuery.isLoading : listQuery.isLoading;
  const isError =
    filter === "triage" ? triageQuery.isError : listQuery.isError;

  const triageCount = useMemo(
    () =>
      filter === "triage"
        ? items.length
        : items.filter(
            (n) => n.status === "initiation" && n.triageDecision == null,
          ).length,
    [filter, items],
  );

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      setFormError("Description is required.");
      return;
    }
    setFormError(null);
    await createMutation.mutateAsync({
      description: description.trim(),
      title: title.trim() || undefined,
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            Nonconformances
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Phase queue from initiation through closure. CAPAs spawn only when
            the issue is systemic.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Flag NC
        </Button>
      </div>

      <EngineerTriageCallout />

      {showCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>Flag standalone nonconformance</CardTitle>
            <CardDescription>
              Creates an NC at initiation for engineer triage. Description is
              required.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <Label htmlFor="nc-title">Title (optional)</Label>
                <Input
                  id="nc-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Short summary"
                  disabled={createMutation.isPending}
                />
              </div>
              <div>
                <Label htmlFor="nc-description">Description</Label>
                <Textarea
                  id="nc-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What was flagged, where, and how much?"
                  rows={4}
                  required
                  disabled={createMutation.isPending}
                />
              </div>
              {formError ? (
                <p className="text-sm text-rose-600" role="alert">
                  {formError}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <Button type="submit" isLoading={createMutation.isPending}>
                  Create NC
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreate(false)}
                  disabled={createMutation.isPending}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label="All phases"
        />
        <FilterChip
          active={filter === "triage"}
          onClick={() => setFilter("triage")}
          label="Triage"
          count={filter === "triage" ? triageCount : undefined}
          tone="amber"
        />
        {NC_PHASES.map((phase) => (
          <FilterChip
            key={phase}
            active={filter === phase}
            onClick={() => setFilter(phase)}
            label={PHASE_LABELS[phase]}
          />
        ))}
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-zinc-500">
            Couldn&apos;t load nonconformances.
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <EmptyNcQueue onCreate={() => setShowCreate(true)} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                    <th className="px-5 py-3">Number</th>
                    <th className="px-5 py-3">Title</th>
                    <th className="px-5 py-3">Phase</th>
                    <th className="px-5 py-3">Disposition</th>
                    <th className="px-5 py-3">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {items.map((row) => (
                    <tr key={row.id} className="hover:bg-zinc-50">
                      <td className="px-5 py-3">
                        <Link
                          href={`/quality/nc/${row.id}`}
                          className="font-medium text-zinc-900 underline-offset-2 hover:underline"
                        >
                          {row.ncNumber}
                        </Link>
                        {row.status === "initiation" &&
                        row.triageDecision == null ? (
                          <Badge tone="amber" className="ml-2">
                            Needs triage
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-zinc-600">
                        <Link
                          href={`/quality/nc/${row.id}`}
                          className="line-clamp-2 hover:text-zinc-900"
                        >
                          {row.title?.trim() || row.description}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <Badge tone="neutral">
                          {PHASE_LABELS[row.status] ?? titleCase(row.status)}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 text-zinc-600">
                        {row.disposition
                          ? titleCase(row.disposition.replace(/_/g, " "))
                          : "—"}
                      </td>
                      <td className="px-5 py-3 text-zinc-500">
                        {formatDateTime(row.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function EngineerTriageCallout() {
  return (
    <Card className="border-zinc-200 bg-zinc-50/80">
      <CardHeader className="border-b-0 pb-0">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-zinc-200">
            <ShieldAlert className="h-4 w-4 text-zinc-700" />
          </span>
          <div>
            <CardTitle>Engineer triage</CardTitle>
            <CardDescription>
              At initiation, decide the path — do not force a CAPA for every
              flag. Acceptable requires a quality/admin signature.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4 sm:grid-cols-3">
        <TriageOption
          icon={CheckCircle2}
          tone="emerald"
          title="Acceptable"
          body="Within use-as-is criteria or false alarm. Quality/admin signs disposition and closes from initiation."
        />
        <TriageOption
          icon={AlertTriangle}
          tone="amber"
          title="NC"
          body="Product nonconformance. Run containment → disposition → investigation as needed."
        />
        <TriageOption
          icon={ClipboardList}
          tone="rose"
          title="NC + CAPA"
          body="Systemic or recurring cause. Continue the NC and open a linked CAPA."
        />
      </CardContent>
    </Card>
  );
}

function TriageOption({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: typeof CheckCircle2;
  tone: "emerald" | "amber" | "rose";
  title: string;
  body: string;
}) {
  const iconTone =
    tone === "emerald"
      ? "text-emerald-600"
      : tone === "amber"
        ? "text-amber-600"
        : "text-rose-600";
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", iconTone)} />
        <p className="text-sm font-semibold text-zinc-900">{title}</p>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{body}</p>
    </div>
  );
}

function EmptyNcQueue({ onCreate }: { onCreate: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100">
          <ClipboardList className="h-5 w-5 text-zinc-400" />
        </span>
        <p className="text-sm font-medium text-zinc-900">No nonconformances</p>
        <p className="max-w-md text-sm text-zinc-500">
          Flags from inspection and shop floor land here at initiation. You can
          also create a standalone NC.
        </p>
        <Button type="button" variant="outline" className="mt-2" onClick={onCreate}>
          Flag NC
        </Button>
      </CardContent>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  tone?: "amber";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
        active
          ? tone === "amber"
            ? "bg-amber-700 text-white"
            : "bg-zinc-900 text-white"
          : "bg-white text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-900",
      )}
    >
      {label}
      {typeof count === "number" ? (
        <span
          className={cn(
            "tabular-nums",
            active ? "text-zinc-300" : "text-zinc-400",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
