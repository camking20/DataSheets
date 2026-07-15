"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  FilePlus2,
  Info,
  Loader2,
  PenLine,
  Send,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import type { ChangeOrderStatus, SignatureMeaning } from "@datasheets/core";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/hooks/use-session";
import { formatApiError } from "@/lib/errors";
import { cn, formatDateTime, titleCase } from "@/lib/utils";
import {
  AuditTrail,
  DocStatusPill,
  MEANING_LABELS,
  SignatureModal,
  SignatureStatus,
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

/** Display label when no server-provided digest is available; hash is bound on sign. */
const SERVER_HASH_LABEL = "Computed by server on sign";

type SignTarget = Extract<
  SignatureMeaning,
  "change_approval_me" | "change_approval_qa"
> | null;

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

function ChangeOrderStatusPill({ status }: { status: ChangeOrderStatus }) {
  return <Badge tone={statusTone[status]}>{titleCase(status)}</Badge>;
}

function buildAuditEntries(
  co: {
    coNumber: string;
    createdAt: string | Date;
    approvedAt: string | Date | null;
    implementedAt: string | Date | null;
    updatedAt: string | Date;
    status: ChangeOrderStatus;
  },
  signatures: Array<{
    meaning: string;
    signedAt: string | Date;
    signerName: string | null;
    contentSha256: string;
  }>,
): AuditTrailEntry[] {
  const entries: AuditTrailEntry[] = [
    {
      createdAt: co.createdAt,
      action: "change_order.create",
      actorName: null,
      metadata: { coNumber: co.coNumber },
    },
  ];

  for (const sig of signatures) {
    entries.push({
      createdAt: sig.signedAt,
      action: `signature.${sig.meaning}`,
      actorName: sig.signerName,
      metadata: { contentSha256: sig.contentSha256 },
    });
  }

  if (co.approvedAt) {
    entries.push({
      createdAt: co.approvedAt,
      action: "change_order.approve",
      actorName: null,
    });
  }

  if (co.implementedAt) {
    entries.push({
      createdAt: co.implementedAt,
      action: "change_order.implement",
      actorName: null,
      metadata: {
        note: "All attached document revisions released atomically",
      },
    });
  }

  if (co.status === "rejected") {
    entries.push({
      createdAt: co.updatedAt,
      action: "change_order.reject",
      actorName: null,
    });
  }

  return entries.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export default function ChangeOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const { me } = useSession();
  const role = me?.role ?? null;

  const canEdit = role === "engineer" || role === "admin";
  const canSignMe = role === "engineer" || role === "admin";
  const canSignQa = role === "quality" || role === "admin";
  const canReject =
    role === "engineer" || role === "quality" || role === "admin";

  const utils = trpc.useUtils();

  const detailQuery = trpc.changeOrders.getById.useQuery({ id: params.id });
  const detail = detailQuery.data;

  const [actionError, setActionError] = useState<string | null>(null);
  const [signTarget, setSignTarget] = useState<SignTarget>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const [selectedDocRevIds, setSelectedDocRevIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedRoutingRevIds, setSelectedRoutingRevIds] = useState<
    Set<string>
  >(() => new Set());
  const [docFilter, setDocFilter] = useState("");
  const [rtgFilter, setRtgFilter] = useState("");

  const candidatesQuery = trpc.changeOrders.listReleaseCandidates.useQuery();

  const filteredDocs = useMemo(() => {
    const rows = candidatesQuery.data?.documents ?? [];
    const q = docFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (d) =>
        d.docNumber.toLowerCase().includes(q) ||
        (d.title ?? "").toLowerCase().includes(q),
    );
  }, [candidatesQuery.data?.documents, docFilter]);

  const filteredRtgs = useMemo(() => {
    const rows = candidatesQuery.data?.routings ?? [];
    const q = rtgFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [candidatesQuery.data?.routings, rtgFilter]);

  const invalidate = () => {
    void utils.changeOrders.getById.invalidate({ id: params.id });
  };

  const submitForReview = trpc.changeOrders.submitForReview.useMutation({
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to submit for review.")),
  });

  const addItem = trpc.changeOrders.addItem.useMutation({
    onSuccess: () => {
      setActionError(null);
      setSelectedDocRevIds(new Set());
      setSelectedRoutingRevIds(new Set());
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to add revision.")),
  });

  const removeItem = trpc.changeOrders.removeItem.useMutation({
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to remove item.")),
  });

  const reject = trpc.changeOrders.reject.useMutation({
    onSuccess: () => {
      setActionError(null);
      setShowReject(false);
      setRejectNotes("");
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to reject change order.")),
  });

  const markApprovedIfReady = trpc.changeOrders.markApprovedIfReady.useMutation({
    onSuccess: () => invalidate(),
  });

  const signMutation = trpc.signatures.sign.useMutation({
    onSuccess: async () => {
      setSignTarget(null);
      setActionError(null);
      try {
        await markApprovedIfReady.mutateAsync({ id: params.id });
      } catch {
        // Signatures router may already have implemented; refresh either way.
      }
      invalidate();
    },
    onError: (err) => {
      throw new Error(formatApiError(err, "Unable to apply signature."));
    },
  });

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
          Couldn&apos;t load this change order.
          <div className="mt-4">
            <Link
              href="/changes"
              className="text-sm font-medium text-zinc-800 underline-offset-2 hover:underline"
            >
              Back to change orders
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { changeOrder: co, items, signatures } = detail;
  const isDraft = co.status === "draft";
  const isInReview = co.status === "in_review";
  const canMutateItems = isDraft || isInReview;

  const hasMeSig = signatures.some((s) => s.meaning === "change_approval_me");
  const hasQaSig = signatures.some((s) => s.meaning === "change_approval_qa");
  const attachedDocIds = new Set(
    items
      .map((row) => row.item.documentRevisionId)
      .filter((id): id is string => Boolean(id)),
  );
  const attachedRoutingIds = new Set(
    items
      .map((row) => row.item.routingRevisionId)
      .filter((id): id is string => Boolean(id)),
  );

  const auditEntries = buildAuditEntries(co, signatures);

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

  function handleAttachSelected() {
    const documentRevisionIds = [...selectedDocRevIds].filter(
      (id) => !attachedDocIds.has(id),
    );
    const routingRevisionIds = [...selectedRoutingRevIds].filter(
      (id) => !attachedRoutingIds.has(id),
    );
    if (documentRevisionIds.length === 0 && routingRevisionIds.length === 0) {
      setActionError(
        "Select at least one document or routing that is not already attached.",
      );
      return;
    }
    setActionError(null);
    addItem.mutate({
      changeOrderId: co.id,
      documentRevisionIds:
        documentRevisionIds.length > 0 ? documentRevisionIds : undefined,
      routingRevisionIds:
        routingRevisionIds.length > 0 ? routingRevisionIds : undefined,
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        href="/changes"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Change orders
      </Link>

      {/* Header + workflow actions */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              {co.coNumber}
            </h1>
            <ChangeOrderStatusPill status={co.status} />
          </div>
          <p className="text-base text-zinc-700">
            {co.title?.trim() || (
              <span className="italic text-zinc-400">Untitled change order</span>
            )}
          </p>
          <p className="text-sm text-zinc-500">
            Updated {formatDateTime(co.updatedAt)}
            {co.implementedAt
              ? ` · Implemented ${formatDateTime(co.implementedAt)}`
              : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && isDraft ? (
            <Button
              className="gap-2"
              isLoading={submitForReview.isPending}
              onClick={() => {
                setActionError(null);
                submitForReview.mutate({ id: co.id });
              }}
            >
              <Send className="h-4 w-4" /> Submit for review
            </Button>
          ) : null}

          {canSignMe && isInReview && !hasMeSig ? (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setSignTarget("change_approval_me")}
            >
              <PenLine className="h-4 w-4" /> Sign ME approval
            </Button>
          ) : null}

          {canSignQa && isInReview && !hasQaSig ? (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setSignTarget("change_approval_qa")}
            >
              <ShieldCheck className="h-4 w-4" /> Sign QA approval
            </Button>
          ) : null}

          {canReject && isInReview ? (
            <Button
              variant="destructive"
              className="gap-2"
              onClick={() => {
                setShowReject(true);
                setActionError(null);
              }}
            >
              <XCircle className="h-4 w-4" /> Reject
            </Button>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          {actionError}
        </p>
      ) : null}

      {/* Atomic release notice */}
      <div className="flex gap-3 rounded-xl border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-sky-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <p>
          When both ME and QA change approvals are signed, this CO is{" "}
          <span className="font-medium">implemented</span> and{" "}
          <span className="font-medium">
            all attached document revisions are released atomically
          </span>
          — prior released revisions on those documents are superseded in the
          same transaction.
        </p>
      </div>

      {/* Description + reason */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <div>
              <CardTitle>Description</CardTitle>
              <CardDescription>What is changing (Part 11).</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800">
              {co.description}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <div>
              <CardTitle>Reason</CardTitle>
              <CardDescription>Why the change is needed (Part 11).</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800">
              {co.reason}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Reject form */}
      {showReject ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Reject change order</CardTitle>
              <CardDescription>
                Rejection notes are required and recorded in the audit trail.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="reject-notes">Rejection notes</Label>
              <Textarea
                id="reject-notes"
                rows={3}
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="Why this change order is being rejected…"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                isLoading={reject.isPending}
                onClick={() => {
                  const notes = rejectNotes.trim();
                  if (!notes) {
                    setActionError("Rejection notes are required.");
                    return;
                  }
                  setActionError(null);
                  reject.mutate({ id: co.id, notes });
                }}
              >
                Confirm reject
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowReject(false);
                  setRejectNotes("");
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Items */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Attached revisions</CardTitle>
            <CardDescription>
              Documents and routings released together when this CO is fully
              approved.
            </CardDescription>
          </div>
          <Badge tone="neutral">
            {items.length} item{items.length === 1 ? "" : "s"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4 p-0">
          {canEdit && canMutateItems ? (
            <div className="space-y-4 border-b border-zinc-100 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-zinc-900">
                  Add objects releasing together
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Check draft / in-review documents and draft routings, then
                  attach them in one step.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="co-doc-filter">Documents</Label>
                  <Input
                    id="co-doc-filter"
                    value={docFilter}
                    onChange={(e) => setDocFilter(e.target.value)}
                    placeholder="Filter by number or title…"
                    className="bg-white"
                  />
                  <ul className="max-h-52 overflow-y-auto rounded-md border border-zinc-200 bg-white">
                    {candidatesQuery.isLoading ? (
                      <li className="px-3 py-6 text-center text-sm text-zinc-400">
                        Loading…
                      </li>
                    ) : filteredDocs.length === 0 ? (
                      <li className="px-3 py-6 text-center text-sm text-zinc-400">
                        No draft / in-review documents
                      </li>
                    ) : (
                      filteredDocs.map((d) => {
                        const already = attachedDocIds.has(d.revisionId);
                        const checked =
                          already || selectedDocRevIds.has(d.revisionId);
                        return (
                          <li key={d.revisionId}>
                            <label
                              className={cn(
                                "flex cursor-pointer items-start gap-2.5 px-3 py-2.5 hover:bg-zinc-50",
                                already && "opacity-60",
                              )}
                            >
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={checked}
                                disabled={already}
                                onChange={() => toggleDoc(d.revisionId)}
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-zinc-900">
                                  {d.docNumber} · Rev {d.rev}
                                </span>
                                <span className="block truncate text-xs text-zinc-500">
                                  {d.title?.trim() || "Untitled"}
                                  {already ? " · already attached" : ""}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="co-rtg-filter">Routings</Label>
                  <Input
                    id="co-rtg-filter"
                    value={rtgFilter}
                    onChange={(e) => setRtgFilter(e.target.value)}
                    placeholder="Filter by name…"
                    className="bg-white"
                  />
                  <ul className="max-h-52 overflow-y-auto rounded-md border border-zinc-200 bg-white">
                    {candidatesQuery.isLoading ? (
                      <li className="px-3 py-6 text-center text-sm text-zinc-400">
                        Loading…
                      </li>
                    ) : filteredRtgs.length === 0 ? (
                      <li className="px-3 py-6 text-center text-sm text-zinc-400">
                        No draft routings
                      </li>
                    ) : (
                      filteredRtgs.map((r) => {
                        const already = attachedRoutingIds.has(r.revisionId);
                        const checked =
                          already || selectedRoutingRevIds.has(r.revisionId);
                        return (
                          <li key={r.revisionId}>
                            <label
                              className={cn(
                                "flex cursor-pointer items-start gap-2.5 px-3 py-2.5 hover:bg-zinc-50",
                                already && "opacity-60",
                              )}
                            >
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={checked}
                                disabled={already}
                                onChange={() => toggleRtg(r.revisionId)}
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-zinc-900">
                                  {r.name} · Rev {r.rev}
                                </span>
                                <span className="block truncate text-xs text-zinc-500">
                                  Draft routing
                                  {already ? " · already attached" : ""}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  className="gap-2"
                  isLoading={addItem.isPending}
                  disabled={
                    selectedDocRevIds.size === 0 &&
                    selectedRoutingRevIds.size === 0
                  }
                  onClick={handleAttachSelected}
                >
                  <FilePlus2 className="h-4 w-4" />
                  Attach selected (
                  {selectedDocRevIds.size + selectedRoutingRevIds.size})
                </Button>
              </div>
            </div>
          ) : null}

          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100">
                <FilePlus2 className="h-4 w-4 text-zinc-400" />
              </span>
              <p className="text-sm font-medium text-zinc-900">
                No revisions attached
              </p>
              <p className="max-w-sm text-sm text-zinc-500">
                {isDraft
                  ? "Attach at least one draft document or routing before submitting."
                  : "This change order has no linked revisions."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                    <th className="px-5 py-3">Revision</th>
                    <th className="px-5 py-3">Object</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Change summary</th>
                    {isDraft && canEdit ? (
                      <th className="px-5 py-3 text-right"> </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {items.map(({ item, revision, routingRevision }) => {
                    const isRouting = Boolean(item.routingRevisionId);
                    const revLabel = isRouting
                      ? routingRevision?.rev
                      : revision?.rev;
                    const summary = isRouting
                      ? routingRevision?.changeSummary
                      : revision?.changeSummary;
                    return (
                      <tr key={item.id} className="hover:bg-zinc-50/80">
                        <td className="px-5 py-3">
                          <div className="font-medium text-zinc-900">
                            Rev {revLabel ?? "—"}
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-400">
                            {isRouting ? "Routing" : "Document"}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-zinc-600">
                          {isRouting && routingRevision?.routingId ? (
                            <Link
                              href={`/routings/${routingRevision.routingId}`}
                              className="font-medium text-zinc-800 underline-offset-2 hover:underline"
                            >
                              Open routing
                            </Link>
                          ) : revision?.documentId ? (
                            <Link
                              href={`/documents/${revision.documentId}`}
                              className="font-medium text-zinc-800 underline-offset-2 hover:underline"
                            >
                              Open document
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {isRouting && routingRevision ? (
                            <Badge tone="amber">{routingRevision.status}</Badge>
                          ) : revision ? (
                            <DocStatusPill status={revision.status} />
                          ) : (
                            <Badge tone="rose">Missing</Badge>
                          )}
                        </td>
                        <td className="max-w-xs px-5 py-3 text-zinc-500">
                          <span className="line-clamp-2">
                            {summary?.trim() || "—"}
                          </span>
                        </td>
                        {isDraft && canEdit ? (
                          <td className="px-5 py-3 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                              isLoading={
                                removeItem.isPending &&
                                removeItem.variables?.itemId === item.id
                              }
                              onClick={() => {
                                setActionError(null);
                                removeItem.mutate({ itemId: item.id });
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Remove
                            </Button>
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

      {/* Signatures */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Signatures</CardTitle>
            <CardDescription>
              Part 11 e-signatures for this change order. Both ME and QA are
              required before atomic release.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(isInReview ||
            co.status === "approved" ||
            co.status === "implemented") && (
            <div className="grid gap-3 sm:grid-cols-2">
              <SignatureStatus
                label={MEANING_LABELS.change_approval_me}
                done={hasMeSig}
                signer={signatures.find((s) => s.meaning === "change_approval_me")}
              />
              <SignatureStatus
                label={MEANING_LABELS.change_approval_qa}
                done={hasQaSig}
                signer={signatures.find((s) => s.meaning === "change_approval_qa")}
              />
            </div>
          )}

          {signatures.length === 0 ? (
            <p className="text-sm text-zinc-400">
              No signatures on this change order yet.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-100">
              {signatures.map((sig) => (
                <li
                  key={sig.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-900">
                      {MEANING_LABELS[sig.meaning as SignatureMeaning] ??
                        titleCase(sig.meaning)}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {sig.signerName?.trim() || "Unknown signer"}
                    </p>
                  </div>
                  <time className="text-xs text-zinc-400">
                    {formatDateTime(sig.signedAt)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Audit trail */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Audit trail</CardTitle>
            <CardDescription>
              Lifecycle and signature events for this change order.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <AuditTrail
            entries={auditEntries}
            emptyMessage="No audit events yet."
          />
        </CardContent>
      </Card>

      <SignatureModal
        open={signTarget != null}
        onClose={() => setSignTarget(null)}
        meaningLabel={
          signTarget
            ? MEANING_LABELS[signTarget]
            : MEANING_LABELS.change_approval_me
        }
        entitySummary={`${co.coNumber}${co.title ? ` — ${co.title}` : ""} (${items.length} revision${items.length === 1 ? "" : "s"})`}
        contentSha256={SERVER_HASH_LABEL}
        onSign={async ({ password }) => {
          if (!signTarget) return;
          // Server applySignature computes the CO content hash; omit client hash.
          await signMutation.mutateAsync({
            entityType: "change_order",
            entityId: co.id,
            meaning: signTarget,
            password,
          });
        }}
      />
    </div>
  );
}
