"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import { FileText, Plus, Search, X } from "lucide-react";
import {
  PREFIX_BY_DOC_TYPE,
  type DocumentRevisionStatus,
  type DocumentType,
} from "@datasheets/core";
import { trpc, type AppRouter } from "@/lib/trpc";
import { useSession } from "@/hooks/use-session";
import { formatApiError } from "@/lib/errors";
import { formatDate, cn } from "@/lib/utils";
import { DocStatusPill } from "@/components/qms";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type DocumentListItem = RouterOutputs["documents"]["list"][number];
type CreatedDocument = RouterOutputs["documents"]["create"];

const DOC_TYPES: DocumentType[] = ["drw", "pro", "wi", "frm"];

const STATUS_OPTIONS: Array<{ value: "" | DocumentRevisionStatus; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In review" },
  { value: "released", label: "Released" },
  { value: "superseded", label: "Superseded" },
  { value: "obsolete", label: "Obsolete" },
];

const TYPE_LABELS: Record<DocumentType, string> = {
  drw: "Drawing",
  pro: "Procedure",
  wi: "Work instruction",
  frm: "Form",
};

type TypeFilter = "all" | DocumentType;

export default function DocumentsPage() {
  const { me } = useSession();
  const canCreate =
    me?.role === "engineer" || me?.role === "admin" || me?.role === "quality";

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<"" | DocumentRevisionStatus>("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);

  const utils = trpc.useUtils();

  const listQuery = trpc.documents.list.useQuery({
    docType: typeFilter === "all" ? undefined : typeFilter,
    status: statusFilter || undefined,
  });

  const rows = useMemo(() => {
    const data: DocumentListItem[] = listQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(({ document: doc }) => {
      const number = doc.docNumber.toLowerCase();
      const title = (doc.title ?? "").toLowerCase();
      return number.includes(q) || title.includes(q);
    });
  }, [listQuery.data, search]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Documents</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Controlled drawings, procedures, work instructions, and forms — numbered,
            revisioned, and release-ready.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setShowForm((v) => !v)} className="gap-2">
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? "Cancel" : "New document"}
          </Button>
        ) : null}
      </div>

      {showForm && canCreate ? (
        <CreateDocumentForm
          onCreated={() => {
            setShowForm(false);
            void utils.documents.list.invalidate();
          }}
        />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <TypePills value={typeFilter} onChange={setTypeFilter} />
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="w-full sm:w-44">
            <Select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "" | DocumentRevisionStatus)
              }
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              placeholder="Search number or title…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <p className="p-6 text-sm text-zinc-500">Loading documents…</p>
          ) : listQuery.isError ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100">
                <FileText className="h-5 w-5 text-zinc-400" />
              </span>
              <p className="text-sm font-medium text-zinc-900">Documents unavailable</p>
              <p className="max-w-sm text-sm text-zinc-500">
                Couldn&apos;t reach the document service. Check that the API is running
                and document control is wired in.
              </p>
            </div>
          ) : rows.length === 0 ? (
            <EmptyDocuments
              canCreate={!!canCreate}
              filtered={typeFilter !== "all" || !!statusFilter || !!search.trim()}
              onCreate={() => setShowForm(true)}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                    <th className="px-5 py-3">Doc number</th>
                    <th className="px-5 py-3">Title</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Rev</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rows.map(({ document: doc, currentRevision }) => (
                    <tr key={doc.id} className="hover:bg-zinc-50">
                      <td className="px-5 py-3">
                        <Link
                          href={`/documents/${doc.id}`}
                          className="font-medium tabular text-zinc-900 hover:underline"
                        >
                          {doc.docNumber}
                        </Link>
                      </td>
                      <td className="max-w-[16rem] px-5 py-3 text-zinc-600">
                        <span className="line-clamp-1">{doc.title ?? "—"}</span>
                      </td>
                      <td className="px-5 py-3">
                        <DocTypeBadge type={doc.docType} />
                      </td>
                      <td className="px-5 py-3 font-medium tabular text-zinc-900">
                        {currentRevision?.rev ?? "—"}
                      </td>
                      <td className="px-5 py-3">
                        {currentRevision ? (
                          <DocStatusPill status={currentRevision.status} />
                        ) : (
                          <Badge tone="neutral">No rev</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-zinc-500">
                        {formatDate(currentRevision?.updatedAt ?? doc.updatedAt)}
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

function TypePills({
  value,
  onChange,
}: {
  value: TypeFilter;
  onChange: (v: TypeFilter) => void;
}) {
  const items: Array<{ id: TypeFilter; label: string }> = [
    { id: "all", label: "All" },
    ...DOC_TYPES.map((t) => ({ id: t as TypeFilter, label: PREFIX_BY_DOC_TYPE[t] })),
  ];

  return (
    <div
      className="inline-flex flex-wrap gap-1 rounded-lg bg-zinc-100/80 p-1"
      role="tablist"
      aria-label="Document type"
    >
      {items.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors",
              active
                ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200/80"
                : "text-zinc-500 hover:text-zinc-800",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function DocTypeBadge({ type }: { type: DocumentType }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-zinc-700">
      <span className="font-medium tabular text-zinc-900">{PREFIX_BY_DOC_TYPE[type]}</span>
      <span className="hidden text-zinc-400 sm:inline">·</span>
      <span className="hidden text-zinc-500 sm:inline">{TYPE_LABELS[type]}</span>
    </span>
  );
}

function EmptyDocuments({
  canCreate,
  filtered,
  onCreate,
}: {
  canCreate: boolean;
  filtered: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100">
        <FileText className="h-5 w-5 text-zinc-400" />
      </span>
      {filtered ? (
        <>
          <p className="text-sm font-medium text-zinc-900">No matching documents</p>
          <p className="max-w-xs text-sm text-zinc-500">
            Try a different type, status, or search term. Documents are numbered by type
            (DRW, PRO, WI, FRM).
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-zinc-900">No controlled documents yet</p>
          <p className="max-w-sm text-sm text-zinc-500">
            {canCreate
              ? "Create a drawing, procedure, work instruction, or form. Each gets an auto-number and starts as revision A in draft."
              : "Ask an engineer, quality, or admin to add the first controlled document."}
          </p>
          {canCreate ? (
            <Button variant="secondary" className="mt-2 gap-2" onClick={onCreate}>
              <Plus className="h-4 w-4" />
              New document
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function CreateDocumentForm({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [docType, setDocType] = useState<DocumentType>("pro");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = trpc.documents.create.useMutation({
    onSuccess: (data: CreatedDocument) => {
      onCreated();
      router.push(`/documents/${data.document.id}`);
    },
    onError: (err) => {
      setError(formatApiError(err, "Unable to create document."));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate({
      docType,
      title: title.trim(),
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>New document</CardTitle>
          <CardDescription>
            Allocates the next number for the type and opens revision A as a draft.
            Procedures, WIs, and forms can sync to Google Docs when connected.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="docType">Type</Label>
            <Select
              id="docType"
              required
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocumentType)}
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PREFIX_BY_DOC_TYPE[t]} — {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Incoming inspection procedure"
            />
          </div>
          {error ? (
            <p className="sm:col-span-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              {error}
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" isLoading={create.isPending}>
              Create document
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
