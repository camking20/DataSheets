"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileUp,
  GitBranch,
  Loader2,
  PenLine,
  Send,
  ShieldCheck,
} from "lucide-react";
import {
  PREFIX_BY_DOC_TYPE,
  type DocumentType,
  type SignatureMeaning,
} from "@datasheets/core";
import { trpc, type AppRouter } from "@/lib/trpc";
import { useSession } from "@/hooks/use-session";
import { formatApiError } from "@/lib/errors";
import { cn, formatDateTime, titleCase } from "@/lib/utils";
import {
  AuditTrail,
  DocStatusPill,
  PdfPreview,
  SignatureModal,
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
import { Label, Textarea } from "@/components/ui/input";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type DocumentDetail = RouterOutputs["documents"]["getById"];
type DocumentRevisionRow = DocumentDetail["revisions"][number];
type SignatureRow = DocumentDetail["signatures"][number];

type SignTarget = Extract<SignatureMeaning, "me_approval" | "qa_approval"> | null;

const TYPE_LABELS: Record<DocumentType, string> = {
  drw: "Drawing",
  pro: "Procedure",
  wi: "Work instruction",
  frm: "Form",
};

/** Local until shared MEANING_LABELS lands in @/components/qms. */
const MEANING_LABELS: Record<string, string> = {
  me_approval: "ME approval",
  qa_approval: "QA approval",
  disposition: "Disposition",
  closure: "Closure",
  change_approval_me: "Change approval (ME)",
  change_approval_qa: "Change approval (QA)",
};

function truncateActorId(actorId: string): string {
  return actorId.length > 8 ? `${actorId.slice(0, 8)}…` : actorId;
}

function resolveActorName(
  actorId: string | null | undefined,
  actorName?: string | null,
): string | null {
  if (actorName?.trim()) return actorName.trim();
  if (actorId) return truncateActorId(actorId);
  return null;
}

function pickDefaultRevision(revisions: DocumentRevisionRow[]): DocumentRevisionRow | null {
  if (revisions.length === 0) return null;
  const released = revisions.find((r) => r.status === "released");
  if (released) return released;
  const inReview = revisions.find((r) => r.status === "in_review");
  if (inReview) return inReview;
  const draft = revisions.find((r) => r.status === "draft");
  if (draft) return draft;
  return [...revisions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0]!;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unable to read file"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const { me } = useSession();
  const role = me?.role ?? null;

  const canEdit =
    role === "engineer" || role === "admin" || role === "quality";
  const canUpload = role === "engineer" || role === "admin";
  const canBranch = role === "engineer" || role === "admin";
  const canSignMe = role === "engineer" || role === "admin";
  const canSignQa = role === "quality" || role === "admin";

  const utils = trpc.useUtils();

  const detailQuery = trpc.documents.getById.useQuery({ id: params.id });
  const detail = detailQuery.data;

  const [selectedRevId, setSelectedRevId] = useState<string | null>(null);
  const [changeSummary, setChangeSummary] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [summaryDirty, setSummaryDirty] = useState(false);
  const [signTarget, setSignTarget] = useState<SignTarget>(null);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const cadInputRef = useRef<HTMLInputElement>(null);

  const revisions = detail?.revisions ?? [];
  const activeRevision = useMemo(() => {
    if (!revisions.length) return null;
    if (selectedRevId) {
      return revisions.find((r) => r.id === selectedRevId) ?? pickDefaultRevision(revisions);
    }
    return pickDefaultRevision(revisions);
  }, [revisions, selectedRevId]);

  useEffect(() => {
    if (!activeRevision) return;
    if (!summaryDirty) {
      setChangeSummary(activeRevision.changeSummary ?? "");
    }
  }, [activeRevision?.id, activeRevision?.changeSummary, summaryDirty]);

  useEffect(() => {
    setSummaryDirty(false);
    setActionError(null);
    setSignTarget(null);
  }, [activeRevision?.id]);

  const pdfFileId = activeRevision?.pdfFileId ?? null;

  const pdfMetaQuery = trpc.files.getById.useQuery(
    { id: pdfFileId! },
    { enabled: !!pdfFileId },
  );
  const pdfMeta = pdfMetaQuery.data;

  const pdfDownloadQuery = trpc.files.getDownload.useQuery(
    { id: pdfFileId! },
    { enabled: !!pdfFileId },
  );
  const pdfDownload = pdfDownloadQuery.data;

  /** Server PDF digest — binds signatures; never client-hashed. */
  const contentSha256 = pdfMeta?.sha256?.trim().toLowerCase() ?? "";

  const invalidate = () => {
    void utils.documents.getById.invalidate({ id: params.id });
  };

  const updateDraft = trpc.documents.updateDraft.useMutation({
    onSuccess: () => {
      setSummaryDirty(false);
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to save change summary.")),
  });

  const submitForReview = trpc.documents.submitForReview.useMutation({
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to submit for review.")),
  });

  const uploadPdf = trpc.documents.uploadPdf.useMutation({
    onSuccess: () => {
      setActionError(null);
      invalidate();
      void utils.files.getById.invalidate();
      void utils.files.getDownload.invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to upload PDF.")),
  });

  const uploadCad = trpc.documents.uploadCad.useMutation({
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to upload CAD file.")),
  });

  const branchRevision = trpc.documents.createRevisionFromReleased.useMutation({
    onSuccess: (rev) => {
      setActionError(null);
      setSelectedRevId(rev.id);
      invalidate();
    },
    onError: (err) =>
      setActionError(formatApiError(err, "Unable to branch revision.")),
  });

  const signMutation = trpc.signatures.sign.useMutation({
    onSuccess: () => {
      setSignTarget(null);
      setActionError(null);
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
          Couldn&apos;t load this document.
          <div className="mt-4">
            <Link
              href="/documents"
              className="text-sm font-medium text-zinc-800 underline-offset-2 hover:underline"
            >
              Back to documents
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { document: doc, part, signatures, audit } = detail;
  const rev = activeRevision;
  const isDraft = rev?.status === "draft";
  const isInReview = rev?.status === "in_review";
  const hasGoogle = !!rev?.googleFileId;
  const googleEditUrl = hasGoogle
    ? `https://docs.google.com/document/d/${rev!.googleFileId}/edit`
    : null;

  const revSignatures = signatures.filter((s) => s.entityId === rev?.id);
  const hasMeSig = revSignatures.some((s) => s.meaning === "me_approval");
  const hasQaSig = revSignatures.some((s) => s.meaning === "qa_approval");

  const auditEntries: AuditTrailEntry[] = audit.map((row) => ({
    createdAt: row.createdAt,
    actorName: resolveActorName(row.actorId),
    action: row.action,
    metadata: row.metadata,
  }));

  async function handleUpload(
    kind: "pdf" | "cad",
    fileList: FileList | null,
  ) {
    if (!rev || !fileList?.[0]) return;
    const file = fileList[0];
    setActionError(null);
    try {
      const contentBase64 = await fileToBase64(file);
      const payload = {
        revisionId: rev.id,
        fileName: file.name,
        mimeType: file.type || (kind === "pdf" ? "application/pdf" : "application/octet-stream"),
        contentBase64,
      };
      if (kind === "pdf") {
        await uploadPdf.mutateAsync(payload);
      } else {
        await uploadCad.mutateAsync(payload);
      }
    } catch (err) {
      setActionError(
        formatApiError(err, kind === "pdf" ? "Unable to upload PDF." : "Unable to upload CAD."),
      );
    } finally {
      if (kind === "pdf" && pdfInputRef.current) pdfInputRef.current.value = "";
      if (kind === "cad" && cadInputRef.current) cadInputRef.current.value = "";
    }
  }

  function saveChangeSummary() {
    if (!rev || !isDraft || !canEdit) return;
    updateDraft.mutate({
      revisionId: rev.id,
      changeSummary: changeSummary.trim() || undefined,
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Link href="/documents" className="flex items-center gap-1 hover:text-zinc-900">
          <ArrowLeft className="h-3.5 w-3.5" /> Documents
        </Link>
        <span className="text-zinc-300">/</span>
        <span className="font-medium text-zinc-700">{doc.docNumber}</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              {doc.docNumber}
            </h1>
            <Badge tone="sky">{PREFIX_BY_DOC_TYPE[doc.docType]}</Badge>
            {rev ? <DocStatusPill status={rev.status} /> : null}
            {rev ? (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200">
                Rev {rev.rev}
              </span>
            ) : null}
          </div>
          <p className="text-base text-zinc-700">
            {doc.title?.trim() || (
              <span className="italic text-zinc-400">Untitled document</span>
            )}
          </p>
          <p className="text-sm text-zinc-500">
            {TYPE_LABELS[doc.docType]}
            {part ? (
              <>
                {" "}
                · Linked part{" "}
                <Link
                  href={`/parts/${part.id}`}
                  className="font-medium text-zinc-800 underline-offset-2 hover:underline"
                >
                  {part.partNumber}
                </Link>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && isDraft && rev ? (
            <Button
              className="gap-2"
              isLoading={submitForReview.isPending}
              onClick={() => {
                setActionError(null);
                submitForReview.mutate({ revisionId: rev.id });
              }}
            >
              <Send className="h-4 w-4" /> Mark ready for Change Control
            </Button>
          ) : null}

          {canSignMe && isInReview && rev && !hasMeSig ? (
            <Button
              variant="outline"
              className="gap-2"
              disabled={!contentSha256 || contentSha256.length !== 64}
              onClick={() => setSignTarget("me_approval")}
            >
              <PenLine className="h-4 w-4" /> Sign ME approval
            </Button>
          ) : null}

          {canSignQa && isInReview && rev && !hasQaSig ? (
            <Button
              variant="outline"
              className="gap-2"
              disabled={!contentSha256 || contentSha256.length !== 64}
              onClick={() => setSignTarget("qa_approval")}
            >
              <ShieldCheck className="h-4 w-4" /> Sign QA approval
            </Button>
          ) : null}

          {canBranch && rev?.status === "released" ? (
            <Button
              variant="outline"
              className="gap-2"
              isLoading={branchRevision.isPending}
              onClick={() => {
                setActionError(null);
                branchRevision.mutate({ documentId: doc.id });
              }}
            >
              <GitBranch className="h-4 w-4" /> Branch next rev
            </Button>
          ) : null}

          {canEdit && (isDraft || isInReview) ? (
            <Link href="/changes/new">
              <Button variant="secondary" className="gap-2">
                <GitBranch className="h-4 w-4" /> Open Change Control
              </Button>
            </Link>
          ) : null}

          {canUpload && isDraft && doc.docType === "drw" && rev ? (
            <>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => handleUpload("pdf", e.target.files)}
              />
              <input
                ref={cadInputRef}
                type="file"
                accept=".dwg,.dxf,.step,.stp,.iges,.igs,.sldprt,.prt,.cad"
                className="hidden"
                onChange={(e) => handleUpload("cad", e.target.files)}
              />
              <Button
                variant="outline"
                className="gap-2"
                isLoading={uploadPdf.isPending}
                onClick={() => pdfInputRef.current?.click()}
              >
                <FileUp className="h-4 w-4" /> Upload PDF
              </Button>
              <Button
                variant="secondary"
                className="gap-2"
                isLoading={uploadCad.isPending}
                onClick={() => cadInputRef.current?.click()}
              >
                <FileUp className="h-4 w-4" /> Upload CAD
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          {actionError}
        </p>
      ) : null}

      {isInReview && !pdfFileId ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-inset ring-amber-200">
          This revision has no PDF — electronic signatures require a server-bound PDF digest.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Revision timeline */}
        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader className="pb-3">
            <div>
              <CardTitle>Revisions</CardTitle>
              <CardDescription>Select a revision to inspect.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {revisions.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-zinc-400">
                No revisions yet.
              </p>
            ) : (
              <ol className="relative divide-y divide-zinc-100">
                {revisions.map((row, index) => {
                  const selected = row.id === rev?.id;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRevId(row.id);
                          setSummaryDirty(false);
                        }}
                        className={cn(
                          "flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors",
                          selected
                            ? "bg-zinc-50"
                            : "hover:bg-zinc-50/80",
                        )}
                      >
                        <span className="relative mt-1.5 flex flex-col items-center">
                          <span
                            className={cn(
                              "h-2.5 w-2.5 rounded-full ring-2 ring-white",
                              selected ? "bg-zinc-900" : "bg-zinc-300",
                            )}
                          />
                          {index < revisions.length - 1 ? (
                            <span className="absolute top-3 h-[calc(100%+0.75rem)] w-px bg-zinc-200" />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-zinc-900">
                              Rev {row.rev}
                            </span>
                            <DocStatusPill status={row.status} />
                          </span>
                          <span className="mt-1 block text-xs text-zinc-400">
                            {formatDateTime(row.updatedAt)}
                          </span>
                          {row.changeSummary ? (
                            <span className="mt-1 line-clamp-2 block text-xs text-zinc-500">
                              {row.changeSummary}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Main workspace */}
        <div className="space-y-6">
          {!rev ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-zinc-500">
                This document has no revisions to display.
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Change summary */}
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Change summary</CardTitle>
                    <CardDescription>
                      {isDraft
                        ? "Describe what changed in this revision before submitting for review."
                        : "Locked for this revision status."}
                    </CardDescription>
                  </div>
                  {canEdit && isDraft ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!summaryDirty}
                      isLoading={updateDraft.isPending}
                      onClick={saveChangeSummary}
                    >
                      Save
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent>
                  {canEdit && isDraft ? (
                    <div>
                      <Label htmlFor="change-summary">Summary</Label>
                      <Textarea
                        id="change-summary"
                        rows={3}
                        value={changeSummary}
                        placeholder="e.g. Updated torque specification on step 4; clarified inspection hold points."
                        onChange={(e) => {
                          setChangeSummary(e.target.value);
                          setSummaryDirty(true);
                        }}
                      />
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap text-sm text-zinc-700">
                      {rev.changeSummary?.trim() || (
                        <span className="italic text-zinc-400">No change summary recorded.</span>
                      )}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Google editor */}
              {isDraft && hasGoogle && googleEditUrl ? (
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle>Google Doc editor</CardTitle>
                      <CardDescription>
                        Edit the controlled content in Google Docs. You must be signed into
                        Google with access to this company&apos;s Drive.
                      </CardDescription>
                    </div>
                    <a
                      href={googleEditUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-800 underline-offset-2 hover:underline"
                    >
                      Open in Google <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                      <iframe
                        title={`${doc.docNumber} Google Doc`}
                        src={googleEditUrl}
                        className="h-[560px] w-full border-0 bg-white"
                        allow="clipboard-read; clipboard-write"
                      />
                    </div>
                    <p className="text-xs text-zinc-400">
                      If the editor is blank, open the document in Google and confirm you are
                      logged into the correct account.
                    </p>
                  </CardContent>
                </Card>
              ) : null}

              {/* PDF preview */}
              {pdfFileId ? (
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle>PDF preview</CardTitle>
                      <CardDescription>
                        Controlled PDF snapshot used for review and electronic signatures.
                        {contentSha256 ? (
                          <>
                            {" "}
                            <span className="font-mono text-[11px] text-zinc-400">
                              SHA-256 {contentSha256.slice(0, 12)}…
                            </span>
                          </>
                        ) : null}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {pdfDownloadQuery.isLoading ? (
                      <div className="flex h-48 items-center justify-center text-sm text-zinc-400">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading PDF…
                      </div>
                    ) : (
                      <PdfPreview
                        base64={pdfDownload?.contentBase64}
                        title={`${doc.docNumber} rev ${rev.rev} PDF`}
                        height={520}
                      />
                    )}
                  </CardContent>
                </Card>
              ) : isDraft && doc.docType === "drw" ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                    <FileUp className="h-8 w-8 text-zinc-300" />
                    <div>
                      <p className="text-sm font-medium text-zinc-700">
                        No PDF attached to this drawing revision
                      </p>
                      <p className="mt-1 max-w-sm text-xs text-zinc-400">
                        Upload a PDF (and optional CAD) before submitting for ME/QA review.
                      </p>
                    </div>
                    {canUpload ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        isLoading={uploadPdf.isPending}
                        onClick={() => pdfInputRef.current?.click()}
                      >
                        <FileUp className="h-3.5 w-3.5" /> Upload PDF
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              ) : isDraft && !hasGoogle ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-zinc-500">
                    No Google Doc is linked yet. Connect Google Drive in Settings, or upload a
                    PDF if this is a drawing.
                  </CardContent>
                </Card>
              ) : null}

              {/* Signatures */}
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Signatures</CardTitle>
                    <CardDescription>
                      Part 11-style approvals recorded against this revision.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  {isInReview ? (
                    <div className="mb-4 grid gap-2 sm:grid-cols-2">
                      <SignatureStatus
                        label="ME approval"
                        done={hasMeSig}
                        signer={revSignatures.find((s) => s.meaning === "me_approval")}
                      />
                      <SignatureStatus
                        label="QA approval"
                        done={hasQaSig}
                        signer={revSignatures.find((s) => s.meaning === "qa_approval")}
                      />
                    </div>
                  ) : null}

                  {revSignatures.length === 0 ? (
                    <p className="text-sm text-zinc-400">No signatures on this revision yet.</p>
                  ) : (
                    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-100">
                      {revSignatures.map((sig) => (
                        <li
                          key={sig.id}
                          className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3"
                        >
                          <div>
                            <p className="text-sm font-medium text-zinc-900">
                              {MEANING_LABELS[sig.meaning] ?? titleCase(sig.meaning)}
                            </p>
                            <p className="text-sm text-zinc-500">
                              {sig.signerName?.trim() ||
                                (sig.signerId
                                  ? truncateActorId(sig.signerId)
                                  : "Unknown signer")}
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
                      Immutable events for this controlled document.
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <AuditTrail entries={auditEntries} emptyMessage="No audit events yet." />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {rev ? (
        <SignatureModal
          open={signTarget != null}
          onClose={() => setSignTarget(null)}
          meaningLabel={
            signTarget === "me_approval"
              ? "Manufacturing Engineering approval"
              : "Quality Assurance approval"
          }
          entitySummary={`${doc.docNumber} rev ${rev.rev}${
            doc.title?.trim() ? ` — ${doc.title.trim()}` : ""
          }`}
          contentSha256={contentSha256 || "waiting for server hash…"}
          onSign={async ({ password }) => {
            if (!signTarget || !contentSha256 || contentSha256.length !== 64) {
              throw new Error(
                "Server content hash is not ready. Ensure a PDF is attached and try again.",
              );
            }
            await signMutation.mutateAsync({
              entityType: "document_revision",
              entityId: rev.id,
              meaning: signTarget,
              password,
              contentSha256,
            });
          }}
        />
      ) : null}
    </div>
  );
}

function SignatureStatus({
  label,
  done,
  signer,
}: {
  label: string;
  done: boolean;
  signer?: SignatureRow;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        done
          ? "border-emerald-200 bg-emerald-50/60"
          : "border-amber-200 bg-amber-50/50",
      )}
    >
      <div className="flex items-center gap-2">
        {done ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <PenLine className="h-4 w-4 text-amber-600" />
        )}
        <span className="text-sm font-medium text-zinc-900">{label}</span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {done
          ? `${signer?.signerName?.trim() || (signer?.signerId ? truncateActorId(signer.signerId) : "Signed")} · ${formatDateTime(signer?.signedAt)}`
          : "Pending electronic signature"}
      </p>
    </div>
  );
}
