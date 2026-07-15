"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Factory,
  FileText,
  Gauge,
  GitBranch,
  Loader2,
  PenLine,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { trpc } from "@/lib/trpc";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DispositionDot } from "@/components/DispositionBadge";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/utils";
import type { DashboardOverview, Disposition } from "@/lib/api-types";

type PendingDocApproval = {
  document: {
    id: string;
    docNumber: string;
    title: string | null;
    docType: string;
  };
  revision: {
    id: string;
    rev: string;
    status: string;
    changeSummary: string | null;
    updatedAt: string | Date;
  };
  missing: {
    me_approval: boolean;
    qa_approval: boolean;
  };
};

type PendingChangeOrder = {
  id: string;
  coNumber: string;
  title: string | null;
  status: string;
  description: string;
  updatedAt: string | Date;
};

/** MES/QMS fields returned by dashboard.overview (Phase 2–5). */
type MesDashboardOverview = DashboardOverview & {
  counts: DashboardOverview["counts"] & {
    openWorkOrders?: {
      planned: number;
      released: number;
      inProgress: number;
      onHold: number;
      completed: number;
    };
    throughput7d?: number;
    throughput30d?: number;
    scrap7d?: number;
    firstPassYield7d?: number | null;
    openNcsByPhase?: Record<string, number>;
    ncAging?: number;
    capaDueSoon?: number;
    capaOverdue?: number;
  };
  wipByWorkCenter?: Array<{ workCenter: string; qtyOpsInProgress: number }>;
  mes?: {
    wipByWorkCenter: Array<{ workCenter: string; qtyOpsInProgress: number }>;
    openWorkOrdersByStatus: Array<{
      status: string;
      count: number;
      window?: string;
    }>;
    openNcsByPhase: Array<{ status: string; count: number }>;
    throughput: {
      good7d: number;
      good30d: number;
      scrap7d: number;
      firstPassYield7d: number | null;
    };
  };
};

const NC_PHASE_LABELS: Record<string, string> = {
  initiation: "Initiation",
  containment: "Containment",
  disposition_planning: "Disp. plan",
  disposition_execution: "Disp. exec",
  investigation: "Investigation",
};

function formatFpy(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export default function DashboardPage() {
  const { data, isLoading, isError } = trpc.dashboard.overview.useQuery();
  const overview = data as MesDashboardOverview | undefined;

  const pendingDocsQuery = trpc.documents.listPendingApprovals.useQuery();
  const pendingCosQuery = trpc.changeOrders.list.useQuery({ status: "in_review" });

  const pendingDocs = (pendingDocsQuery.data as PendingDocApproval[] | undefined) ?? [];
  const pendingCos = (pendingCosQuery.data as PendingChangeOrder[] | undefined) ?? [];
  const pendingCount = pendingDocs.length + pendingCos.length;
  const pendingLoading = pendingDocsQuery.isLoading || pendingCosQuery.isLoading;

  const chartData =
    overview?.latestCapabilitySnapshots
      .filter((row) => row.snapshot.cpk != null)
      .slice(0, 12)
      .reverse()
      .map((row) => ({
        label: row.partNumber,
        cpk: row.snapshot.cpk,
      })) ?? [];

  const partsByNumber = new Map<
    string,
    { partId: string; partNumber: string; worstCpk: number | null; disposition: Disposition | null }
  >();
  for (const row of overview?.latestCapabilitySnapshots ?? []) {
    const existing = partsByNumber.get(row.partNumber);
    const cpk = row.snapshot.cpk;
    const disposition: Disposition | null =
      row.snapshot.percentRed > 0
        ? "red"
        : row.snapshot.percentYellow > 0
          ? "yellow"
          : "green";
    if (!existing) {
      partsByNumber.set(row.partNumber, {
        partId: row.snapshot.partId,
        partNumber: row.partNumber,
        worstCpk: cpk,
        disposition,
      });
    } else if (cpk != null && (existing.worstCpk == null || cpk < existing.worstCpk)) {
      existing.worstCpk = cpk;
      existing.disposition = disposition;
    }
  }

  const wipChartData =
    overview?.mes?.wipByWorkCenter ?? overview?.wipByWorkCenter ?? [];
  const ncPhaseChartData =
    overview?.mes?.openNcsByPhase?.map((row) => ({
      label: NC_PHASE_LABELS[row.status] ?? row.status,
      count: row.count,
      status: row.status,
    })) ??
    Object.entries(overview?.counts.openNcsByPhase ?? {}).map(([status, count]) => ({
      label: NC_PHASE_LABELS[status] ?? status,
      count,
      status,
    }));

  const throughput7d = overview?.counts.throughput7d ?? overview?.mes?.throughput.good7d;
  const fpy = overview?.counts.firstPassYield7d ?? overview?.mes?.throughput.firstPassYield7d;
  const capaDueSoon = overview?.counts.capaDueSoon ?? 0;
  const capaOverdue = overview?.counts.capaOverdue ?? 0;
  const openNcTotal = ncPhaseChartData.reduce((sum, row) => sum + row.count, 0);
  const hasMes =
    overview?.mes != null ||
    overview?.wipByWorkCenter != null ||
    overview?.counts.throughput7d != null ||
    overview?.counts.openNcsByPhase != null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          Command center
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          A live snapshot of your inspection floor — active sheets, alerts, and process
          capability.
        </p>
      </div>

      <AwaitingSignatureCard
        pendingDocs={pendingDocs}
        pendingCos={pendingCos}
        pendingCount={pendingCount}
        isLoading={pendingLoading}
        isError={pendingDocsQuery.isError && pendingCosQuery.isError}
      />

      {isLoading ? (
        <LoadingState />
      ) : isError || !overview ? (
        <EmptyDashboard />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Active sheets"
              value={overview.counts.inProgressSheets}
              icon={Activity}
              tone="amber"
            />
            <KpiCard
              label="Completed sheets"
              value={overview.counts.completedSheets}
              icon={CheckCircle2}
              tone="emerald"
            />
            <KpiCard
              label="Parts in production"
              value={overview.counts.parts}
              icon={Boxes}
              tone="neutral"
            />
            <KpiCard
              label="Open alerts"
              value={overview.recentIssues.length}
              icon={AlertTriangle}
              tone={overview.recentIssues.length > 0 ? "rose" : "neutral"}
            />
          </div>

          {hasMes ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                  label="Throughput (7d)"
                  value={formatNumber(throughput7d ?? 0, 0)}
                  icon={Factory}
                  tone="neutral"
                  hint={
                    overview.counts.throughput30d != null
                      ? `${formatNumber(overview.counts.throughput30d, 0)} good / 30d`
                      : undefined
                  }
                />
                <KpiCard
                  label="First-pass yield"
                  value={formatFpy(fpy)}
                  icon={Gauge}
                  tone={
                    fpy == null
                      ? "neutral"
                      : fpy >= 0.95
                        ? "emerald"
                        : fpy >= 0.85
                          ? "amber"
                          : "rose"
                  }
                  hint={
                    overview.counts.scrap7d != null
                      ? `${formatNumber(overview.counts.scrap7d, 0)} scrap / 7d`
                      : undefined
                  }
                />
                <KpiCard
                  label="Open NCs"
                  value={openNcTotal}
                  icon={ShieldAlert}
                  tone={openNcTotal > 0 ? "amber" : "neutral"}
                  hint={
                    overview.counts.ncAging != null && overview.counts.ncAging > 0
                      ? `${overview.counts.ncAging} aging >7d`
                      : "By phase below"
                  }
                />
                <KpiCard
                  label="CAPA due / overdue"
                  value={`${capaDueSoon} / ${capaOverdue}`}
                  icon={ClipboardList}
                  tone={capaOverdue > 0 ? "rose" : capaDueSoon > 0 ? "amber" : "neutral"}
                  hint="Due in 7d · past due"
                />
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle className="flex items-center gap-1.5">
                        <Factory className="h-3.5 w-3.5" /> WIP by work center
                      </CardTitle>
                      <CardDescription>
                        In-progress operations that have started but not completed.
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {wipChartData.length === 0 ? (
                      <p className="text-sm text-zinc-500">
                        No WIP on the floor. Released work orders will show here when
                        ops start.
                      </p>
                    ) : (
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={wipChartData} margin={{ left: 0, right: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                            <XAxis
                              dataKey="workCenter"
                              tick={{ fontSize: 11, fill: "#71717a" }}
                            />
                            <YAxis
                              allowDecimals={false}
                              tick={{ fontSize: 11, fill: "#71717a" }}
                              width={28}
                            />
                            <Tooltip />
                            <Bar
                              dataKey="qtyOpsInProgress"
                              name="Ops in progress"
                              fill="#52525b"
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle className="flex items-center gap-1.5">
                        <ShieldAlert className="h-3.5 w-3.5" /> Open NCs by phase
                      </CardTitle>
                      <CardDescription>
                        Nonconformances still open across the quality workflow.
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {openNcTotal === 0 ? (
                      <p className="text-sm text-zinc-500">
                        No open NCs. Flagged scrap on the floor will appear here.
                      </p>
                    ) : (
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={ncPhaseChartData} margin={{ left: 0, right: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                            <XAxis
                              dataKey="label"
                              tick={{ fontSize: 10, fill: "#71717a" }}
                              interval={0}
                              angle={-20}
                              textAnchor="end"
                              height={48}
                            />
                            <YAxis
                              allowDecimals={false}
                              tick={{ fontSize: 11, fill: "#71717a" }}
                              width={28}
                            />
                            <Tooltip />
                            <Bar
                              dataKey="count"
                              name="Open NCs"
                              fill="#b45309"
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          ) : null}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <div>
                  <CardTitle>Recent alerts</CardTitle>
                  <CardDescription>
                    Yellow and red dispositions flagged across active lots.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {overview.recentIssues.length === 0 ? (
                  <p className="p-5 text-sm text-zinc-500">No alerts. Every dimension in spec.</p>
                ) : (
                  <ul className="divide-y divide-zinc-100">
                    {overview.recentIssues.map((alert) => (
                      <li
                        key={alert.measurement.id}
                        className="flex items-start gap-3 px-5 py-3"
                      >
                        <DispositionDot
                          disposition={alert.measurement.disposition}
                          className="mt-1.5 shrink-0"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-zinc-900">
                            {alert.partNumber} · {alert.dimensionName}
                          </p>
                          <p className="text-sm text-zinc-500">
                            Lot {alert.lotNumber}: {alert.measurement.value} {alert.unit} (
                            {alert.measurement.disposition})
                          </p>
                        </div>
                        <Link
                          href={`/sheets/${alert.dataSheetId}`}
                          className="shrink-0 text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:underline"
                        >
                          View sheet
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5" /> Latest Ppk
                  </CardTitle>
                  <CardDescription>Recent capability snapshots by part (overall sigma).</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                {chartData.length === 0 ? (
                  <p className="text-sm text-zinc-500">No capability data yet.</p>
                ) : (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} />
                        <YAxis tick={{ fontSize: 11, fill: "#71717a" }} width={30} />
                        <Tooltip />
                        <Line
                          type="monotone"
                          dataKey="cpk"
                          stroke="#059669"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Parts &amp; latest Ppk</CardTitle>
                <CardDescription>
                  Worst-case overall capability (Ppk) from latest snapshots.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {partsByNumber.size === 0 ? (
                <p className="p-5 text-sm text-zinc-500">
                  No capability data yet. Complete an inspection sheet to populate this.
                </p>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {[...partsByNumber.values()].map((p) => (
                    <li
                      key={p.partId}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <div>
                        <Link
                          href={`/parts/${p.partId}`}
                          className="text-sm font-medium text-zinc-900 hover:underline"
                        >
                          {p.partNumber}
                        </Link>
                      </div>
                      <div className="flex items-center gap-3">
                        {p.disposition ? (
                          <span className="flex items-center gap-1.5 text-sm font-medium tabular text-zinc-900">
                            <DispositionDot disposition={p.disposition} />
                            Ppk {formatNumber(p.worstCpk, 2)}
                          </span>
                        ) : (
                          <Badge tone="neutral">No data</Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function AwaitingSignatureCard({
  pendingDocs,
  pendingCos,
  pendingCount,
  isLoading,
  isError,
}: {
  pendingDocs: PendingDocApproval[];
  pendingCos: PendingChangeOrder[];
  pendingCount: number;
  isLoading: boolean;
  isError: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-1.5">
              <PenLine className="h-3.5 w-3.5" />
              Awaiting my signature
            </CardTitle>
            <CardDescription>
              Document revisions and change orders that need your ME or QA approval.
            </CardDescription>
          </div>
          {pendingCount > 0 ? (
            <Badge tone="amber">{pendingCount} pending</Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
            Loading approvals…
          </div>
        ) : isError ? (
          <p className="p-5 text-sm text-zinc-500">
            Couldn&apos;t load pending approvals. Check that the API is running.
          </p>
        ) : pendingCount === 0 ? (
          <p className="p-5 text-sm text-zinc-500">
            Nothing waiting on you. When a revision or change order enters review,
            it will show up here.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {pendingDocs.map((item) => {
              const needs: string[] = [];
              if (item.missing.me_approval) needs.push("ME");
              if (item.missing.qa_approval) needs.push("QA");
              return (
                <li
                  key={`doc-${item.revision.id}`}
                  className="flex items-start gap-3 px-5 py-3"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">
                      {item.document.docNumber}
                      {item.document.title ? ` · ${item.document.title}` : ""}
                    </p>
                    <p className="text-sm text-zinc-500">
                      Rev {item.revision.rev}
                      {needs.length > 0 ? ` · needs ${needs.join(" + ")}` : ""}
                      {" · "}
                      {formatDate(item.revision.updatedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="sky">{item.document.docType.toUpperCase()}</Badge>
                    <Link
                      href={`/documents/${item.document.id}`}
                      className="text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:underline"
                    >
                      Review
                    </Link>
                  </div>
                </li>
              );
            })}
            {pendingCos.map((co) => (
              <li key={`co-${co.id}`} className="flex items-start gap-3 px-5 py-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
                  <GitBranch className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900">
                    {co.coNumber}
                    {co.title ? ` · ${co.title}` : ""}
                  </p>
                  <p className="line-clamp-1 text-sm text-zinc-500">
                    {co.description || "Change order in review"}
                    {" · "}
                    {formatDate(co.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone="amber">CO</Badge>
                  <Link
                    href={`/changes/${co.id}`}
                    className="text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:underline"
                  >
                    Review
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="flex h-48 items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
    </div>
  );
}

function EmptyDashboard() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
        <p className="text-sm font-medium text-zinc-900">Dashboard unavailable</p>
        <p className="max-w-sm text-sm text-zinc-500">
          Sign in and make sure the API is running. Capability metrics appear after you
          complete inspection sheets.
        </p>
        <Link
          href="/inspect"
          className="mt-2 text-sm font-medium text-zinc-900 underline underline-offset-4"
        >
          Start an inspection
        </Link>
      </CardContent>
    </Card>
  );
}
