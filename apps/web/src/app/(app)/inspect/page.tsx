"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPlus, Loader2, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatApiError } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { DataSheet, Part } from "@/lib/api-types";

export default function InspectPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [lotNumber, setLotNumber] = useState("");
  const [lotSize, setLotSize] = useState("");
  const [error, setError] = useState<string | null>(null);

  const search = trpc.parts.search.useQuery(
    { q: query },
    { enabled: query.trim().length > 0 },
  );
  const matches = (search.data as Part[] | undefined) ?? [];

  const createSheet = trpc.sheets.create.useMutation({
    onSuccess: (result: { sheet: DataSheet }) => {
      router.push(`/sheets/${result.sheet.id}`);
    },
    onError: (err) => {
      setError(
        formatApiError(
          err,
          "Unable to start inspection. The part may not have a released revision.",
        ),
      );
    },
  });

  const canSubmit = useMemo(
    () => !!selectedPart && lotNumber.trim().length > 0 && Number(lotSize) > 0,
    [selectedPart, lotNumber, lotSize],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPart) return;
    setError(null);
    createSheet.mutate({
      partNumber: selectedPart,
      lotNumber: lotNumber.trim(),
      lotSize: Number(lotSize),
    });
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 text-center sm:text-left">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-900 text-white sm:mx-0">
          <ClipboardPlus className="h-5 w-5" />
        </span>
        <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900">
          Start an inspection
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Look up a part, enter the lot details, and jump straight into measurement entry.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>New data sheet</CardTitle>
            <CardDescription>Uses the currently released revision for the part.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="relative">
              <Label htmlFor="partNumber">Part number</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <Input
                  id="partNumber"
                  className="pl-9"
                  placeholder="Start typing a part number..."
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSelectedPart(null);
                    setShowResults(true);
                  }}
                  onFocus={() => setShowResults(true)}
                  autoComplete="off"
                />
              </div>

              {showResults && query.trim().length > 0 ? (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
                  {search.isLoading ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-zinc-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
                    </div>
                  ) : matches.length === 0 ? (
                    <p className="px-3 py-2.5 text-sm text-zinc-500">No matching parts.</p>
                  ) : (
                    <ul className="max-h-56 overflow-y-auto">
                      {matches.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-zinc-50"
                            onClick={() => {
                              setSelectedPart(p.partNumber);
                              setQuery(p.partNumber);
                              setShowResults(false);
                            }}
                          >
                            <span className="text-sm font-medium text-zinc-900">{p.partNumber}</span>
                            {p.description ? (
                              <span className="text-xs text-zinc-500">{p.description}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="lotNumber">Lot number</Label>
                <Input
                  id="lotNumber"
                  required
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  placeholder="L-2408"
                />
              </div>
              <div>
                <Label htmlFor="lotSize">Lot size</Label>
                <Input
                  id="lotSize"
                  type="number"
                  min={1}
                  required
                  value={lotSize}
                  onChange={(e) => setLotSize(e.target.value)}
                  placeholder="250"
                />
              </div>
            </div>

            {error ? (
              <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              disabled={!canSubmit}
              isLoading={createSheet.isPending}
            >
              Start inspection
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
