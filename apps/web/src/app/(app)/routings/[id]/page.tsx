"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  GitBranch,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc, type AppRouter } from "@/lib/trpc";
import { useSession } from "@/hooks/use-session";
import { formatApiError } from "@/lib/errors";
import { cn, formatDate } from "@/lib/utils";
import { RevisionStatusPill } from "@/components/ui/status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type RoutingDetail = RouterOutputs["routings"]["getById"];
type RoutingRevisionRow = RoutingDetail["revisions"][number];
type RoutingOperationRow = RoutingDetail["operations"][number];
type WiDocumentOption = RouterOutputs["routings"]["listReleasedWiDocuments"][number];

function pickDefaultRevision(
  revisions: RoutingRevisionRow[],
): RoutingRevisionRow | null {
  if (revisions.length === 0) return null;
  const released = revisions.find((r) => r.status === "released");
  if (released) return released;
  const draft = revisions.find((r) => r.status === "draft");
  if (draft) return draft;
  return [...revisions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0]!;
}

type OpFormState = {
  opNumber: string;
  name: string;
  workCenter: string;
  wiDocumentId: string;
  requiresDataSheet: boolean;
  notes: string;
};

const emptyOpForm = (): OpFormState => ({
  opNumber: "",
  name: "",
  workCenter: "",
  wiDocumentId: "",
  requiresDataSheet: false,
  notes: "",
});

export default function RoutingDetailPage() {
  const params = useParams<{ id: string }>();
  const routingId = params.id ?? "";
  const { me } = useSession();
  const canEdit = me?.role === "engineer" || me?.role === "admin";
  const utils = trpc.useUtils();

  const [selectedRevId, setSelectedRevId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showOpForm, setShowOpForm] = useState(false);
  const [editingOpId, setEditingOpId] = useState<string | null>(null);
  const [opForm, setOpForm] = useState<OpFormState>(emptyOpForm);

  const detailQuery = trpc.routings.getById.useQuery(
    {
      id: routingId,
      revisionId: selectedRevId ?? undefined,
    },
    { enabled: Boolean(routingId) },
  );
  const detail = detailQuery.data;

  const partQuery = trpc.parts.getById.useQuery(
    { id: detail?.routing.partId ?? "" },
    { enabled: Boolean(detail?.routing.partId) },
  );
  const part = partQuery.data?.part;

  const wiQuery = trpc.routings.listReleasedWiDocuments.useQuery(undefined, {
    enabled: canEdit && (showOpForm || !!editingOpId),
  });
  const wiOptions: WiDocumentOption[] = wiQuery.data ?? [];

  const revisions = detail?.revisions ?? [];
  const activeRevision = useMemo(() => {
    if (!revisions.length) return null;
    if (selectedRevId) {
      return revisions.find((r) => r.id === selectedRevId) ?? pickDefaultRevision(revisions);
    }
    return detail?.selectedRevision ?? pickDefaultRevision(revisions);
  }, [revisions, selectedRevId, detail?.selectedRevision]);

  useEffect(() => {
    setActionError(null);
    setShowOpForm(false);
    setEditingOpId(null);
    setOpForm(emptyOpForm());
  }, [activeRevision?.id]);

  const operations = useMemo(() => {
    const ops = detail?.operations ?? [];
    return ops.slice().sort((a, b) => a.opNumber - b.opNumber);
  }, [detail?.operations]);

  const isDraft = activeRevision?.status === "draft";
  const hasReleased = revisions.some((r) => r.status === "released");
  const hasDraft = revisions.some((r) => r.status === "draft");

  const invalidate = () => {
    void utils.routings.getById.invalidate({ id: routingId });
    void utils.routings.list.invalidate();
  };

  const createRevision = trpc.routings.createRevisionFromReleased.useMutation({
    onSuccess: (rev) => {
      setActionError(null);
      setSelectedRevId(rev.id);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to branch next revision.")),
  });

  const addOperation = trpc.routings.addOperation.useMutation({
    onSuccess: () => {
      setActionError(null);
      setShowOpForm(false);
      setOpForm(emptyOpForm());
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to add operation.")),
  });

  const updateOperation = trpc.routings.updateOperation.useMutation({
    onSuccess: () => {
      setActionError(null);
      setEditingOpId(null);
      setOpForm(emptyOpForm());
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to update operation.")),
  });

  const removeOperation = trpc.routings.removeOperation.useMutation({
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to remove operation.")),
  });

  function startEdit(op: RoutingOperationRow) {
    setShowOpForm(false);
    setEditingOpId(op.id);
    setOpForm({
      opNumber: String(op.opNumber),
      name: op.name,
      workCenter: op.workCenter ?? "",
      wiDocumentId: op.wiDocumentId ?? "",
      requiresDataSheet: op.requiresDataSheet,
      notes: op.notes ?? "",
    });
  }

  function startAdd() {
    setEditingOpId(null);
    const nextOp =
      operations.length > 0
        ? Math.ceil(Math.max(...operations.map((o) => o.opNumber)) / 10) * 10 + 10
        : 10;
    setOpForm({
      ...emptyOpForm(),
      opNumber: String(nextOp),
    });
    setShowOpForm(true);
  }

  function submitOpForm(e: React.FormEvent) {
    e.preventDefault();
    if (!activeRevision || !isDraft) return;
    setActionError(null);

    const opNumber = Number.parseInt(opForm.opNumber, 10);
    if (!Number.isFinite(opNumber) || opNumber < 1) {
      setActionError("Op number must be a positive integer.");
      return;
    }
    const name = opForm.name.trim();
    if (!name) {
      setActionError("Operation name is required.");
      return;
    }

    const payload = {
      opNumber,
      name,
      workCenter: opForm.workCenter.trim() || null,
      wiDocumentId: opForm.wiDocumentId.trim() || null,
      requiresDataSheet: opForm.requiresDataSheet,
      notes: opForm.notes.trim() || null,
    };

    if (editingOpId) {
      updateOperation.mutate({ operationId: editingOpId, ...payload });
    } else {
      addOperation.mutate({
        routingRevisionId: activeRevision.id,
        ...payload,
      });
    }
  }

  if (detailQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (detailQuery.isError || !detail) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-zinc-500">
          Couldn&apos;t load this routing.
          <div className="mt-4">
            <Link
              href="/routings"
              className="text-sm font-medium text-zinc-800 underline-offset-2 hover:underline"
            >
              Back to routings
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { routing } = detail;
  const opMutating =
    addOperation.isPending || updateOperation.isPending || removeOperation.isPending;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/routings"
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Routings
          </Link>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Routing</p>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            {routing.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {part ? (
              <>
                Part{" "}
                <Link
                  href={`/parts/${part.id}`}
                  className="font-medium text-zinc-800 hover:underline"
                >
                  {part.partNumber}
                </Link>
                {part.description ? ` · ${part.description}` : ""}
              </>
            ) : (
              "No part linked"
            )}
          </p>
          {routing.description ? (
            <p className="mt-2 max-w-2xl text-sm text-zinc-600">{routing.description}</p>
          ) : null}
        </div>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            {hasReleased && !hasDraft ? (
              <Button
                variant="outline"
                className="gap-2"
                isLoading={createRevision.isPending}
                onClick={() => {
                  setActionError(null);
                  createRevision.mutate({ routingId: routing.id });
                }}
              >
                <GitBranch className="h-4 w-4" />
                Branch next rev
              </Button>
            ) : null}
            {isDraft && activeRevision ? (
              <Link href="/changes/new">
                <Button variant="secondary" className="gap-2">
                  <GitBranch className="h-4 w-4" />
                  Open Change Control
                </Button>
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {actionError ? (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          {actionError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Revisions</CardTitle>
            <CardDescription>
              Draft revisions are edited here and released through a change order. Only one
              released revision is current for the shop floor.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {revisions.length === 0 ? (
            <p className="px-5 py-8 text-sm text-zinc-500">No revisions yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {revisions.map((rev) => {
                const selected = activeRevision?.id === rev.id;
                return (
                  <li key={rev.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedRevId(rev.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors",
                        selected ? "bg-zinc-50" : "hover:bg-zinc-50/80",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold",
                            selected
                              ? "bg-zinc-900 text-white"
                              : "bg-zinc-100 text-zinc-700",
                          )}
                        >
                          {rev.rev}
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-zinc-900">
                              Revision {rev.rev}
                            </span>
                            <RevisionStatusPill status={rev.status} />
                            {selected ? (
                              <Badge tone="neutral">Selected</Badge>
                            ) : null}
                          </div>
                          <p className="text-xs text-zinc-500">
                            Created {formatDate(rev.createdAt)}
                            {rev.releasedAt
                              ? ` · Released ${formatDate(rev.releasedAt)}`
                              : ""}
                          </p>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>
              Operations
              {activeRevision ? (
                <span className="ml-2 text-sm font-normal text-zinc-500">
                  · Rev {activeRevision.rev}
                </span>
              ) : null}
            </CardTitle>
            <CardDescription>
              {isDraft
                ? "Edit ops on this draft. Link a released WI and mark ops that need a data sheet."
                : "Released and superseded revisions are read-only. Branch a new draft to change ops."}
            </CardDescription>
          </div>
          {canEdit && isDraft ? (
            <Button size="sm" className="gap-1.5" onClick={startAdd} disabled={showOpForm}>
              <Plus className="h-3.5 w-3.5" />
              Add op
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4 p-0 pb-4">
          {(showOpForm || editingOpId) && canEdit && isDraft ? (
            <form
              onSubmit={submitOpForm}
              className="mx-5 grid grid-cols-1 gap-3 rounded-lg border border-zinc-200 bg-zinc-50/80 p-4 sm:grid-cols-2"
            >
              <div>
                <Label htmlFor="opNumber">Op number</Label>
                <Input
                  id="opNumber"
                  required
                  inputMode="numeric"
                  className="tabular"
                  value={opForm.opNumber}
                  onChange={(e) =>
                    setOpForm((f) => ({ ...f, opNumber: e.target.value }))
                  }
                  placeholder="10"
                />
              </div>
              <div>
                <Label htmlFor="opName">Name</Label>
                <Input
                  id="opName"
                  required
                  value={opForm.name}
                  onChange={(e) => setOpForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="CNC mill OD bore"
                />
              </div>
              <div>
                <Label htmlFor="workCenter">Work center</Label>
                <Input
                  id="workCenter"
                  value={opForm.workCenter}
                  onChange={(e) =>
                    setOpForm((f) => ({ ...f, workCenter: e.target.value }))
                  }
                  placeholder="CNC-1"
                />
              </div>
              <div>
                <Label htmlFor="wiDocumentId">Work instruction</Label>
                <Select
                  id="wiDocumentId"
                  value={opForm.wiDocumentId}
                  onChange={(e) =>
                    setOpForm((f) => ({ ...f, wiDocumentId: e.target.value }))
                  }
                >
                  <option value="">None</option>
                  {wiOptions.map((wi) => (
                    <option key={wi.id} value={wi.id}>
                      {wi.docNumber}
                      {wi.title ? ` — ${wi.title}` : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="opNotes">Notes</Label>
                <Textarea
                  id="opNotes"
                  rows={2}
                  value={opForm.notes}
                  onChange={(e) => setOpForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-700 sm:col-span-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-300"
                  checked={opForm.requiresDataSheet}
                  onChange={(e) =>
                    setOpForm((f) => ({
                      ...f,
                      requiresDataSheet: e.target.checked,
                    }))
                  }
                />
                Requires data sheet
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <Button type="submit" isLoading={opMutating}>
                  {editingOpId ? "Save operation" : "Add operation"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowOpForm(false);
                    setEditingOpId(null);
                    setOpForm(emptyOpForm());
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}

          {operations.length === 0 ? (
            <p className="px-5 py-8 text-sm text-zinc-500">
              No operations on this revision yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                    <th className="px-5 py-3">Op</th>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Work center</th>
                    <th className="px-5 py-3">WI</th>
                    <th className="px-5 py-3">Data sheet</th>
                    {canEdit && isDraft ? <th className="px-5 py-3" /> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {operations.map((op) => {
                    const wiLabel =
                      wiOptions.find((w) => w.id === op.wiDocumentId)?.docNumber ?? null;
                    return (
                      <tr key={op.id} className="hover:bg-zinc-50">
                        <td className="px-5 py-3 font-medium tabular text-zinc-900">
                          {op.opNumber}
                        </td>
                        <td className="px-5 py-3 text-zinc-800">
                          <span className="font-medium">{op.name}</span>
                          {op.notes ? (
                            <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
                              {op.notes}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-zinc-600">
                          {op.workCenter ?? "—"}
                        </td>
                        <td className="px-5 py-3">
                          {op.wiDocumentId ? (
                            <Link
                              href={`/documents/${op.wiDocumentId}`}
                              className="font-medium tabular text-zinc-800 hover:underline"
                            >
                              {wiLabel ?? "WI"}
                            </Link>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {op.requiresDataSheet ? (
                            <Badge tone="sky">Required</Badge>
                          ) : (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                        {canEdit && isDraft ? (
                          <td className="px-5 py-3">
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Edit operation"
                                onClick={() => startEdit(op)}
                                disabled={opMutating}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Remove operation"
                                disabled={
                                  removeOperation.isPending &&
                                  removeOperation.variables?.operationId === op.id
                                }
                                onClick={() => {
                                  setActionError(null);
                                  removeOperation.mutate({ operationId: op.id });
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-rose-600" />
                              </Button>
                            </div>
                          </td>
                        ) : null}
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
