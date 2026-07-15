"use client";

import { useState } from "react";
import Link from "next/link";
import { GitPullRequestArrow, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/hooks/use-session";
import { formatApiError } from "@/lib/errors";
import { cn, formatDateTime, titleCase } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ChangeOrderStatus } from "@datasheets/core";

const STATUS_FILTERS: Array<{ value: ChangeOrderStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "implemented", label: "Implemented" },
];

const statusTone: Record<
  ChangeOrderStatus,
  "neutral" | "emerald" | "amber" | "rose" | "sky"
> = {
  draft: "amber",
  in_review: "sky",
  approved: "emerald",
  rejected: "rose",
  implemented: "neutral",
};

export default function ChangeControlPage() {
  const { me } = useSession();
  const canCreate = me?.role === "engineer" || me?.role === "admin";
  const [statusFilter, setStatusFilter] = useState<ChangeOrderStatus | "all">(
    "all",
  );

  const listQuery = trpc.changeOrders.list.useQuery(
    statusFilter === "all" ? undefined : { status: statusFilter },
  );

  const rows = listQuery.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            Change Control
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            One place to release controlled documents and routings. Select what
            is changing together, describe what and why, then open a change
            order — ME + QA approvals happen on the detail page.
          </p>
        </div>
        {canCreate ? (
          <Link href="/changes/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New change
            </Button>
          </Link>
        ) : null}
      </div>

      <Card className="border-sky-200 bg-sky-50/60">
        <CardContent className="flex gap-3 py-4">
          <GitPullRequestArrow className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
          <div className="text-sm text-sky-900">
            <p className="font-medium">How it works</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-sky-800">
              <li>Branch or edit drafts on Documents / Routings</li>
              <li>
                Open <strong>New change</strong> and check every draft object in
                this release
              </li>
              <li>
                Submit for review on the detail page → ME and QA sign once → all
                items release together
              </li>
            </ol>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              statusFilter === f.value
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change orders</CardTitle>
        </CardHeader>
        <CardContent>
          {listQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>
          ) : listQuery.isError ? (
            <p className="text-sm text-red-600">
              {formatApiError(listQuery.error)}
            </p>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center">
              <p className="text-sm font-medium text-zinc-700">No change orders</p>
              <p className="mt-1 text-sm text-zinc-500">
                Start a change when you have draft document or routing revisions
                ready to release together.
              </p>
              {canCreate ? (
                <Link href="/changes/new" className="mt-4 inline-block">
                  <Button className="gap-2">
                    <Plus className="h-4 w-4" />
                    New change
                  </Button>
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-400">
                    <th className="pb-2 pr-3 font-medium">CO</th>
                    <th className="pb-2 pr-3 font-medium">Title</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 pr-3 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-zinc-100 last:border-0"
                    >
                      <td className="py-3 pr-3 font-mono text-xs">
                        <Link
                          href={`/changes/${row.id}`}
                          className="font-medium text-zinc-900 hover:underline"
                        >
                          {row.coNumber}
                        </Link>
                      </td>
                      <td className="py-3 pr-3 text-zinc-700">
                        {row.title ?? row.description.slice(0, 80)}
                      </td>
                      <td className="py-3 pr-3">
                        <Badge tone={statusTone[row.status]}>
                          {titleCase(row.status)}
                        </Badge>
                      </td>
                      <td className="py-3 text-zinc-500">
                        {formatDateTime(row.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
