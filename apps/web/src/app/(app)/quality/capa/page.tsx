"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import type { CapaStatus } from "@datasheets/core";
import { ClipboardCheck, Loader2, Plus } from "lucide-react";
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

type RouterOutputs = inferRouterOutputs<AppRouter>;
type CapaListItem = RouterOutputs["capa"]["list"][number];

export default function CapaListPage() {
  const router = useRouter();
  const [status, setStatus] = useState<CapaStatus | "all" | "overdue">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const listQuery = trpc.capa.list.useQuery(
    status === "overdue"
      ? { overdue: true }
      : status === "all"
        ? {}
        : { status },
  );
  const createMutation = trpc.capa.create.useMutation({
    onSuccess: (row) => {
      router.push(`/quality/capa/${row.id}`);
    },
    onError: (err) => setFormError(formatApiError(err)),
  });

  const items = useMemo((): CapaListItem[] => {
    const data = listQuery.data;
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return [];
  }, [listQuery.data]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            CAPA
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Corrective and preventive actions — effectiveness checks and Part 11
            closure signatures.
          </p>
        </div>
        <Button type="button" onClick={() => setShowCreate((v) => !v)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New CAPA
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["overdue", "Overdue"],
            ["open", "Open"],
            ["in_progress", "In progress"],
            ["verification", "Verification"],
            ["closed", "Closed"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatus(key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              status === key
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {showCreate ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create CAPA</CardTitle>
            <CardDescription>
              Link from an NC triage when systemic issues need corrective action.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="capa-title">Title</Label>
              <Input
                id="capa-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Prevent OD bore undersize from tool wear"
              />
            </div>
            <div>
              <Label htmlFor="capa-desc">Description</Label>
              <Textarea
                id="capa-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                required
              />
            </div>
            {formError ? (
              <p className="text-sm text-red-600">{formError}</p>
            ) : null}
            <Button
              type="button"
              disabled={!description.trim() || createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  title: title.trim() || undefined,
                  description: description.trim(),
                })
              }
            >
              {createMutation.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : null}
              Create
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register</CardTitle>
        </CardHeader>
        <CardContent>
          {listQuery.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : listQuery.isError ? (
            <p className="text-sm text-red-600">
              {formatApiError(listQuery.error)}
            </p>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center">
              <ClipboardCheck className="mx-auto h-8 w-8 text-zinc-300" />
              <p className="mt-3 text-sm font-medium text-zinc-700">
                No CAPAs yet
              </p>
              <p className="mt-1 text-sm text-zinc-500">
                Open a CAPA from NC triage (NC + CAPA) or create one here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-400">
                    <th className="pb-2 pr-3 font-medium">Number</th>
                    <th className="pb-2 pr-3 font-medium">Title</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 pr-3 font-medium">Due</th>
                    <th className="pb-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => {
                    const due =
                      row.dueAt != null ? new Date(row.dueAt) : null;
                    const overdue =
                      due &&
                      row.status !== "closed" &&
                      due.getTime() < Date.now();
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-zinc-100 last:border-0"
                      >
                        <td className="py-3 pr-3 font-mono text-xs">
                          <Link
                            href={`/quality/capa/${row.id}`}
                            className="font-medium text-zinc-900 hover:underline"
                          >
                            {row.capaNumber}
                          </Link>
                        </td>
                        <td className="py-3 pr-3 text-zinc-700">
                          {row.title ?? row.description.slice(0, 80) ?? "—"}
                        </td>
                        <td className="py-3 pr-3">
                          <Badge tone={row.status === "closed" ? "emerald" : "neutral"}>
                            {titleCase(row.status)}
                          </Badge>
                        </td>
                        <td className="py-3 pr-3 text-zinc-600">
                          {due ? (
                            <span className={overdue ? "text-red-600" : ""}>
                              {formatDateTime(due)}
                              {overdue ? " · overdue" : ""}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-3 text-zinc-500">
                          {row.updatedAt
                            ? formatDateTime(new Date(row.updatedAt))
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
