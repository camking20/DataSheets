"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Loader2, Route } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatApiError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function NewChangePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [selectedDocRevIds, setSelectedDocRevIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedRoutingRevIds, setSelectedRoutingRevIds] = useState<
    Set<string>
  >(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [docFilter, setDocFilter] = useState("");
  const [rtgFilter, setRtgFilter] = useState("");

  const candidatesQuery = trpc.changeOrders.listReleaseCandidates.useQuery();
  const createCo = trpc.changeOrders.create.useMutation();
  const addItem = trpc.changeOrders.addItem.useMutation();

  const docRows = candidatesQuery.data?.documents ?? [];
  const routingRows = candidatesQuery.data?.routings ?? [];

  const filteredDocs = useMemo(() => {
    const q = docFilter.trim().toLowerCase();
    if (!q) return docRows;
    return docRows.filter(
      (d) =>
        d.docNumber.toLowerCase().includes(q) ||
        (d.title ?? "").toLowerCase().includes(q),
    );
  }, [docRows, docFilter]);

  const filteredRtgs = useMemo(() => {
    const q = rtgFilter.trim().toLowerCase();
    if (!q) return routingRows;
    return routingRows.filter((r) => r.name.toLowerCase().includes(q));
  }, [routingRows, rtgFilter]);

  function toggleDoc(revId: string) {
    setSelectedDocRevIds((prev) => {
      const next = new Set(prev);
      if (next.has(revId)) next.delete(revId);
      else next.add(revId);
      return next;
    });
  }

  function toggleRtg(revId: string) {
    setSelectedRoutingRevIds((prev) => {
      const next = new Set(prev);
      if (next.has(revId)) next.delete(revId);
      else next.add(revId);
      return next;
    });
  }

  const selectedCount = selectedDocRevIds.size + selectedRoutingRevIds.size;
  const pending = createCo.isPending || addItem.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!description.trim() || !reason.trim()) {
      setError("Description (what) and reason (why) are required.");
      return;
    }
    if (selectedCount === 0) {
      setError("Select at least one document or routing revision to release.");
      return;
    }
    try {
      const co = await createCo.mutateAsync({
        title: title.trim() || undefined,
        description: description.trim(),
        reason: reason.trim(),
      });
      await addItem.mutateAsync({
        changeOrderId: co.id,
        documentRevisionIds: [...selectedDocRevIds],
        routingRevisionIds: [...selectedRoutingRevIds],
      });
      router.push(`/changes/${co.id}`);
    } catch (err) {
      setError(formatApiError(err, "Could not create change order."));
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/changes"
          className="inline-flex items-center gap-1 text-sm text-zinc-600 hover:text-zinc-900"
        >
          <ArrowLeft className="h-4 w-4" /> Change Control
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-zinc-900">
          New change
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Select every object that must release together in this change package.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What &amp; why</CardTitle>
            <CardDescription>
              Required for Part 11 change control audit trail.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="co-title">Title (optional)</Label>
              <Input
                id="co-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Tighten bore tolerance + update WI"
              />
            </div>
            <div>
              <Label htmlFor="co-desc">What is changing</Label>
              <Textarea
                id="co-desc"
                required
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the technical change across the selected objects…"
              />
            </div>
            <div>
              <Label htmlFor="co-reason">Why</Label>
              <Textarea
                id="co-reason"
                required
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Customer ECO, CAPA action, process improvement…"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Objects in this change</CardTitle>
                <CardDescription>
                  Check every draft / in-review revision that releases together.
                </CardDescription>
              </div>
              <Badge tone="sky">{selectedCount} selected</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-8">
            {candidatesQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
              </div>
            ) : candidatesQuery.isError ? (
              <p className="text-sm text-red-600">
                {formatApiError(candidatesQuery.error)}
              </p>
            ) : (
              <>
                <section>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <FileText className="h-4 w-4 text-zinc-500" />
                    <h3 className="text-sm font-semibold text-zinc-900">
                      Documents
                    </h3>
                    <Input
                      className="ml-auto max-w-xs"
                      placeholder="Filter documents…"
                      value={docFilter}
                      onChange={(e) => setDocFilter(e.target.value)}
                    />
                  </div>
                  {filteredDocs.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
                      No draft or in-review document revisions. Branch a new rev
                      on a document first.
                    </p>
                  ) : (
                    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                      {filteredDocs.map((d) => {
                        const checked = selectedDocRevIds.has(d.revisionId);
                        return (
                          <li key={d.revisionId}>
                            <label
                              className={cn(
                                "flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-zinc-50",
                                checked && "bg-sky-50/80",
                              )}
                            >
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 rounded border-zinc-300"
                                checked={checked}
                                onChange={() => toggleDoc(d.revisionId)}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="font-mono text-sm font-medium text-zinc-900">
                                  {d.docNumber}{" "}
                                  <span className="text-zinc-500">
                                    Rev {d.rev}
                                  </span>
                                </p>
                                <p className="truncate text-sm text-zinc-600">
                                  {d.title ?? "Untitled"}
                                </p>
                                <p className="text-xs uppercase tracking-wide text-zinc-400">
                                  {d.docType} · {d.status}
                                </p>
                              </div>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <section>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Route className="h-4 w-4 text-zinc-500" />
                    <h3 className="text-sm font-semibold text-zinc-900">
                      Routings
                    </h3>
                    <Input
                      className="ml-auto max-w-xs"
                      placeholder="Filter routings…"
                      value={rtgFilter}
                      onChange={(e) => setRtgFilter(e.target.value)}
                    />
                  </div>
                  {filteredRtgs.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
                      No draft routing revisions. Branch a routing from its
                      released revision first.
                    </p>
                  ) : (
                    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                      {filteredRtgs.map((r) => {
                        const checked = selectedRoutingRevIds.has(r.revisionId);
                        return (
                          <li key={r.revisionId}>
                            <label
                              className={cn(
                                "flex cursor-pointer items-start gap-3 px-3 py-3 hover:bg-zinc-50",
                                checked && "bg-sky-50/80",
                              )}
                            >
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 rounded border-zinc-300"
                                checked={checked}
                                onChange={() => toggleRtg(r.revisionId)}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-zinc-900">
                                  {r.name}{" "}
                                  <span className="font-mono text-zinc-500">
                                    Rev {r.rev}
                                  </span>
                                </p>
                                <p className="text-xs uppercase tracking-wide text-zinc-400">
                                  routing · {r.status}
                                </p>
                              </div>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </>
            )}
          </CardContent>
        </Card>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending} isLoading={pending}>
            Create change package
          </Button>
          <Link href="/changes">
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
