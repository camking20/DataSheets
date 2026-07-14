"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, Plus, Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/hooks/use-session";
import { formatApiError } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import type { Part } from "@/lib/api-types";

export default function PartsPage() {
  const { me } = useSession();
  const canCreate = me?.role === "engineer" || me?.role === "admin";
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");

  const utils = trpc.useUtils();
  const partsQuery = trpc.parts.list.useQuery();
  const parts = (partsQuery.data as Part[] | undefined) ?? [];

  const filtered = search
    ? parts.filter(
        (p) =>
          p.partNumber.toLowerCase().includes(search.toLowerCase()) ||
          (p.description ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : parts;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">Parts</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Manage part numbers, tolerances, and revision history.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={() => setShowForm((v) => !v)} className="gap-2">
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? "Cancel" : "New part"}
          </Button>
        ) : null}
      </div>

      {showForm ? (
        <CreatePartForm
          onCreated={() => {
            setShowForm(false);
            utils.parts.list.invalidate();
          }}
        />
      ) : null}

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <Input
          placeholder="Search parts..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {partsQuery.isLoading ? (
            <p className="p-6 text-sm text-zinc-500">Loading parts…</p>
          ) : partsQuery.isError ? (
            <p className="p-6 text-sm text-zinc-500">
              Couldn&apos;t load parts. Check that the API is running.
            </p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100">
                <Boxes className="h-5 w-5 text-zinc-400" />
              </span>
              <p className="text-sm font-medium text-zinc-900">No parts yet</p>
              <p className="max-w-xs text-sm text-zinc-500">
                {canCreate
                  ? "Create your first part to define tolerances and start inspections."
                  : "Ask an engineer or admin to add your first part."}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <th className="px-5 py-3">Part number</th>
                  <th className="px-5 py-3">Description</th>
                  <th className="px-5 py-3">Customer</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map((part) => (
                  <tr key={part.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/parts/${part.id}`}
                        className="font-medium text-zinc-900 hover:underline"
                      >
                        {part.partNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-zinc-600">{part.description ?? "—"}</td>
                    <td className="px-5 py-3 text-zinc-600">{part.customer ?? "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/parts/${part.id}`}
                        className="text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:underline"
                      >
                        View revisions
                      </Link>
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

function CreatePartForm({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [partNumber, setPartNumber] = useState("");
  const [description, setDescription] = useState("");
  const [customer, setCustomer] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = trpc.parts.create.useMutation({
    onSuccess: (data: { part: Part }) => {
      onCreated();
      router.push(`/parts/${data.part.id}`);
    },
    onError: (err) => {
      setError(formatApiError(err, "Unable to create part."));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate({
      partNumber,
      description: description || undefined,
      customer: customer || undefined,
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>New part</CardTitle>
          <CardDescription>
            Creates part revision A in draft status — add dimensions next.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="partNumber">Part number</Label>
            <Input
              id="partNumber"
              required
              value={partNumber}
              onChange={(e) => setPartNumber(e.target.value)}
              placeholder="PN-10245"
            />
          </div>
          <div>
            <Label htmlFor="customer">Customer</Label>
            <Input
              id="customer"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional — machined housing, bracket, etc."
            />
          </div>
          {error ? (
            <p className="sm:col-span-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              {error}
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" isLoading={create.isPending}>
              Create part
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
