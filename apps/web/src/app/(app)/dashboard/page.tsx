"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Loader2,
  TrendingUp,
} from "lucide-react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { trpc } from "@/lib/trpc";
import { KpiCard } from "@/components/KpiCard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DispositionDot } from "@/components/DispositionBadge";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/utils";
import type { DashboardOverview, Disposition } from "@/lib/api-types";

export default function DashboardPage() {
  const { data, isLoading, isError } = trpc.dashboard.overview.useQuery();
  const overview = data as DashboardOverview | undefined;

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
