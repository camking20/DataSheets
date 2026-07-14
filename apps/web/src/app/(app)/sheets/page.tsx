"use client";

import Link from "next/link";
import { FileStack } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { SheetStatusPill } from "@/components/ui/status-pill";
import { formatDateTime } from "@/lib/utils";
import type { SheetListRow } from "@/lib/api-types";

export default function SheetsPage() {
  const { data, isLoading, isError } = trpc.sheets.list.useQuery();
  const rows = (data as SheetListRow[] | undefined) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Data sheets</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Every inspection lot, in progress or completed.
          </p>
        </div>
        <Link
          href="/inspect"
          className="inline-flex h-9 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800"
        >
          New inspection
        </Link>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-zinc-500">Loading sheets…</p>
          ) : isError ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100">
                <FileStack className="h-5 w-5 text-zinc-400" />
              </span>
              <p className="text-sm font-medium text-zinc-900">Sheets unavailable</p>
              <p className="max-w-xs text-sm text-zinc-500">
                Couldn&apos;t reach the sheets service. Check that the API is running.
              </p>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100">
                <FileStack className="h-5 w-5 text-zinc-400" />
              </span>
              <p className="text-sm font-medium text-zinc-900">No data sheets yet</p>
              <p className="max-w-xs text-sm text-zinc-500">
                Start an inspection to create your first lot record.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <th className="px-5 py-3">Part</th>
                  <th className="px-5 py-3">Lot</th>
                  <th className="px-5 py-3">Lot size</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map(({ sheet, part, revision }) => (
                  <tr key={sheet.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/sheets/${sheet.id}`}
                        className="font-medium text-zinc-900 hover:underline"
                      >
                        {part.partNumber} rev {revision.rev}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-zinc-600">{sheet.lotNumber}</td>
                    <td className="px-5 py-3 tabular text-zinc-600">{sheet.lotSize}</td>
                    <td className="px-5 py-3">
                      <SheetStatusPill status={sheet.status} />
                    </td>
                    <td className="px-5 py-3 text-zinc-500">
                      {formatDateTime(sheet.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
