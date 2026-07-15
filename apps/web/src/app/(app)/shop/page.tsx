"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers, Plus, X } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc, type AppRouter } from "@/lib/trpc";
import { useSession } from "@/hooks/use-session";
import { formatApiError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { cn, titleCase } from "@/lib/utils";
import type { WorkOrderStatus } from "@datasheets/core";

const STATUS_FILTERS: Array<{ value: WorkOrderStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "planned", label: "Planned" },
  { value: "released", label: "Released" },
  { value: "in_progress", label: "In progress" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_TONE: Record<
  WorkOrderStatus,
  "neutral" | "emerald" | "amber" | "rose" | "sky"
> = {
  planned: "neutral",
  released: "sky",
  in_progress: "amber",
  on_hold: "rose",
  completed: "emerald",
  closed: "neutral",
  cancelled: "neutral",
};

type RouterOutputs = inferRouterOutputs<AppRouter>;
type WoListItem = RouterOutputs["workOrders"]["list"][number];
type PartRow = RouterOutputs["parts"]["list"][number];

export default function ShopPage() {
  const { me } = useSession();
  const canCreate = me?.role === "engineer" || me?.role === "admin";
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatus | "all">("all");
  const [showForm, setShowForm] = useState(false);

  const utils = trpc.useUtils();

  const listQuery = trpc.workOrders.list.useQuery(
    statusFilter === "all" ? undefined : { status: statusFilter },
  );
  const items: WoListItem[] = listQuery.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
            Shop floor
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Work orders for MES execution — one operation at a time, controlled WI only.
          </p>
        </div>
        {canCreate ? (
          <Button
            onClick={() => setShowForm((v) => !v)}
            className="min-h-[44px] gap-2"
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? "Cancel" : "New work order"}
          </Button>
        ) : null}
      </div>

      {showForm && canCreate ? (
        <CreateWorkOrderForm
          onCreated={() => {
            setShowForm(false);
            void utils.workOrders.list.invalidate();
          }}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = statusFilter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                "min-h-[44px] rounded-md px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <p className="p-6 text-sm text-zinc-500">Loading work orders…</p>
          ) : listQuery.isError ? (
            <p className="p-6 text-sm text-zinc-500">
              Couldn&apos;t load work orders. Check that the API is running.
            </p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100">
                <Layers className="h-5 w-5 text-zinc-400" />
              </span>
              <p className="text-sm font-medium text-zinc-900">No work orders</p>
              <p className="max-w-sm text-sm text-zinc-500">
                {canCreate
                  ? statusFilter === "all"
                    ? "Create a work order against a released part routing to start production."
                    : `No work orders with status “${titleCase(statusFilter)}”.`
                  : "Released work orders will appear here for operator execution."}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <th className="px-5 py-3">WO</th>
                  <th className="px-5 py-3">Part</th>
                  <th className="px-5 py-3">Lot</th>
                  <th className="px-5 py-3">Qty</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {items.map((wo) => (
                  <tr key={wo.id} className="hover:bg-zinc-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/shop/wo/${wo.id}`}
                        className="font-medium text-zinc-900 hover:underline"
                      >
                        {wo.woNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-zinc-600">{wo.partNumber}</td>
                    <td className="px-5 py-3 text-zinc-600">{wo.lotNumber ?? "—"}</td>
                    <td className="px-5 py-3 text-zinc-600">{wo.qty}</td>
                    <td className="px-5 py-3">
                      <Badge tone={STATUS_TONE[wo.status]}>
                        {titleCase(wo.status)}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/shop/wo/${wo.id}`}
                        className="inline-flex min-h-[44px] items-center text-xs font-medium text-zinc-500 hover:text-zinc-900 hover:underline"
                      >
                        Open
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

function CreateWorkOrderForm({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  const partsQuery = trpc.parts.list.useQuery();
  const parts = useMemo(() => {
    const list: PartRow[] = partsQuery.data ?? [];
    return list.filter((p) => p.isActive);
  }, [partsQuery.data]);

  const create = trpc.workOrders.create.useMutation({
    onSuccess: (wo) => {
      onCreated();
      router.push(`/shop/wo/${wo.id}`);
    },
    onError: (err) => {
      setError(formatApiError(err, "Unable to create work order."));
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const qtyNum = Number(qty);
    if (!partId || !Number.isInteger(qtyNum) || qtyNum < 1) {
      setError("Select a part and enter a positive quantity.");
      return;
    }
    create.mutate({
      partId,
      qty: qtyNum,
      lotNumber: lotNumber.trim() || undefined,
    });
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>New work order</CardTitle>
          <CardDescription>
            Uses the released part revision and active released routing. Starts as planned.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        >
          <div className="sm:col-span-2">
            <Label htmlFor="partId">Part</Label>
            <Select
              id="partId"
              required
              value={partId}
              onChange={(e) => setPartId(e.target.value)}
              className="min-h-[44px]"
              disabled={partsQuery.isLoading}
            >
              <option value="">
                {partsQuery.isLoading ? "Loading parts…" : "Select part…"}
              </option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.partNumber}
                  {p.description ? ` — ${p.description}` : ""}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="qty">Quantity</Label>
            <Input
              id="qty"
              type="number"
              min={1}
              required
              inputMode="numeric"
              className="min-h-[44px] text-base"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="25"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="lotNumber">Lot number</Label>
            <Input
              id="lotNumber"
              className="min-h-[44px] text-base"
              value={lotNumber}
              onChange={(e) => setLotNumber(e.target.value)}
              placeholder="Optional"
            />
          </div>
          {error ? (
            <p className="sm:col-span-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              {error}
            </p>
          ) : null}
          <div className="sm:col-span-3">
            <Button
              type="submit"
              className="min-h-[44px]"
              isLoading={create.isPending}
            >
              Create work order
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
