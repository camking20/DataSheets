"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GitBranch, Plus, Search, X } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc, type AppRouter } from "@/lib/trpc";
import { useSession } from "@/hooks/use-session";
import { formatApiError } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea, Select } from "@/components/ui/input";
import { RevisionStatusPill } from "@/components/ui/status-pill";
import { Badge } from "@/components/ui/badge";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type RoutingListItem = RouterOutputs["routings"]["list"][number];
type PartRow = RouterOutputs["parts"]["list"][number];

export default function RoutingsPage() {
  const { me } = useSession();
  const canCreate = me?.role === "engineer" || me?.role === "admin";
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");

  const utils = trpc.useUtils();
  const listQuery = trpc.routings.list.useQuery();
  const partsQuery = trpc.parts.list.useQuery();

  const partById = useMemo(() => {
    const map = new Map<string, PartRow>();
    for (const p of partsQuery.data ?? []) map.set(p.id, p);
    return map;
  }, [partsQuery.data]);

  const rows = useMemo(() => {
    const data: RoutingListItem[] = listQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(({ routing }) => {
      const part = partById.get(routing.partId);
      const name = routing.name.toLowerCase();
      const desc = (routing.description ?? "").toLowerCase();
      const partNumber = (part?.partNumber ?? "").toLowerCase();
      return name.includes(q) || desc.includes(q) || partNumber.includes(q);
    });
  }, [listQuery.data, search, partById]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Routings</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Operation sequences for parts — draft, revise via change order, then release to the
            shop floor.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setShowForm((v) => !v)} className="gap-2">
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? "Cancel" : "New routing"}
          </Button>
        ) : null}
      </div>

      {showForm && canCreate ? (
        <CreateRoutingForm
          parts={partsQuery.data ?? []}
          partsLoading={partsQuery.isLoading}
          onCreated={() => {
            setShowForm(false);
            void utils.routings.list.invalidate();
          }}
        />
      ) : null}

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <Input
          placeholder="Search name or part…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <p className="p-6 text-sm text-zinc-500">Loading routings…</p>
          ) : listQuery.isError ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100">
                <GitBranch className="h-5 w-5 text-zinc-400" />
              </span>
              <p className="text-sm font-medium text-zinc-900">Routings unavailable</p>
              <p className="max-w-sm text-sm text-zinc-500">
                Couldn&apos;t reach the routings service. Check that the API is running and MES
                routings are wired in.
              </p>
            </div>
          ) : rows.length === 0 ? (
            <EmptyRoutings
              canCreate={!!canCreate}
              filtered={!!search.trim()}
              onCreate={() => setShowForm(true)}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-100 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Part</th>
                    <th className="px-5 py-3">Rev</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rows.map(({ routing, currentRevision }) => {
                    const part = partById.get(routing.partId);
                    return (
                      <tr key={routing.id} className="hover:bg-zinc-50">
                        <td className="px-5 py-3">
                          <Link
                            href={`/routings/${routing.id}`}
                            className="font-medium text-zinc-900 hover:underline"
                          >
                            {routing.name}
                          </Link>
                          {routing.description ? (
                            <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
                              {routing.description}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-zinc-600">
                          {part ? (
                            <Link
                              href={`/parts/${part.id}`}
                              className="font-medium tabular text-zinc-800 hover:underline"
                            >
                              {part.partNumber}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-5 py-3 font-medium tabular text-zinc-900">
                          {currentRevision?.rev ?? "—"}
                        </td>
                        <td className="px-5 py-3">
                          {currentRevision ? (
                            <RevisionStatusPill status={currentRevision.status} />
                          ) : (
                            <Badge tone="neutral">No rev</Badge>
                          )}
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

function EmptyRoutings({
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
        <GitBranch className="h-5 w-5 text-zinc-400" />
      </span>
      {filtered ? (
        <>
          <p className="text-sm font-medium text-zinc-900">No matching routings</p>
          <p className="max-w-xs text-sm text-zinc-500">
            Try a different name or part number.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-zinc-900">No routings yet</p>
          <p className="max-w-sm text-sm text-zinc-500">
            {canCreate
              ? "Create a routing for a part, add operations, then release through a change order."
              : "Ask an engineer or admin to add the first routing."}
          </p>
          {canCreate ? (
            <Button variant="secondary" className="mt-2 gap-2" onClick={onCreate}>
              <Plus className="h-4 w-4" />
              New routing
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

function CreateRoutingForm({
  parts,
  partsLoading,
  onCreated,
}: {
  parts: PartRow[];
  partsLoading: boolean;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [partId, setPartId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = trpc.routings.create.useMutation({
    onSuccess: (data) => {
      onCreated();
      router.push(`/routings/${data.routing.id}`);
    },
    onError: (err) => {
      setError(formatApiError(err, "Unable to create routing."));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedPartId = partId.trim();
    const trimmedName = name.trim();
    if (!trimmedPartId) {
      setError("Select a part or enter a part UUID.");
      return;
    }
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    create.mutate({
      partId: trimmedPartId,
      name: trimmedName,
      description: description.trim() || undefined,
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>New routing</CardTitle>
          <CardDescription>
            Creates revision A as a draft. Add operations next, then attach the draft to a change
            order to release.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="partId">Part</Label>
            {parts.length > 0 || partsLoading ? (
              <Select
                id="partId"
                required
                value={partId}
                onChange={(e) => setPartId(e.target.value)}
                disabled={partsLoading}
              >
                <option value="">
                  {partsLoading ? "Loading parts…" : "Select a part…"}
                </option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partNumber}
                    {p.description ? ` — ${p.description}` : ""}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id="partId"
                required
                value={partId}
                onChange={(e) => setPartId(e.target.value)}
                placeholder="Part UUID"
                className="font-mono text-xs"
              />
            )}
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Manifold machine & inspect"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — ops overview for engineers"
            />
          </div>
          {error ? (
            <p className="sm:col-span-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              {error}
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" isLoading={create.isPending}>
              Create routing
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
