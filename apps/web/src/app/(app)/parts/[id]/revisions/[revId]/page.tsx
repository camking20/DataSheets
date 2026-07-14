"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Pencil, Plus, Rocket, Trash2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/hooks/use-session";
import { formatApiError } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { RevisionStatusPill } from "@/components/ui/status-pill";
import type { Dimension, FrequencyType, Part, PartRevision } from "@/lib/api-types";

type RevisionResult = { revision: PartRevision; part: Part; dimensions: Dimension[] };

interface DimensionFormState {
  name: string;
  balloonNumber: string;
  unit: string;
  nominal: string;
  usl: string;
  lsl: string;
  /** UI stores warning as 0–100 percent; converted to 0–1 fraction on submit */
  warningPercent: string;
  gageMethod: string;
  frequencyType: FrequencyType;
  frequencyN: string;
}

const emptyForm: DimensionFormState = {
  name: "",
  balloonNumber: "",
  unit: "in",
  nominal: "",
  usl: "",
  lsl: "",
  warningPercent: "75",
  gageMethod: "",
  frequencyType: "every_n_parts",
  frequencyN: "1",
};

export default function RevisionEditorPage() {
  const params = useParams<{ id: string; revId: string }>();
  const router = useRouter();
  const { me } = useSession();
  const canEdit = me?.role === "engineer" || me?.role === "admin";
  const utils = trpc.useUtils();

  const { data, isLoading, isError } = trpc.parts.getRevision.useQuery({
    revisionId: params.revId,
  });
  const result = data as RevisionResult | undefined;

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  const invalidate = () => utils.parts.getRevision.invalidate({ revisionId: params.revId });

  const addDimension = trpc.parts.addDimension.useMutation({
    onSuccess: () => {
      invalidate();
      setAdding(false);
      setFormError(null);
    },
    onError: (err) => setFormError(formatApiError(err, "Unable to add dimension.")),
  });

  const updateDimension = trpc.parts.updateDimension.useMutation({
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setFormError(null);
    },
    onError: (err) => setFormError(formatApiError(err, "Unable to update dimension.")),
  });

  const deleteDimension = trpc.parts.deleteDimension.useMutation({
    onSuccess: () => invalidate(),
  });

  const release = trpc.parts.releaseRevision.useMutation({
    onSuccess: () => {
      invalidate();
      if (result) router.push(`/parts/${result.part.id}`);
    },
    onError: (err) => setReleaseError(formatApiError(err, "Unable to release revision.")),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (isError || !result) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-zinc-500">
          Couldn&apos;t load this revision.
        </CardContent>
      </Card>
    );
  }

  const { part, revision, dimensions } = result;
  const isDraft = revision.status === "draft";

  function submitForm(values: DimensionFormState, dimensionId?: string) {
    setFormError(null);
    const usl = values.usl.trim() === "" ? null : Number(values.usl);
    const lsl = values.lsl.trim() === "" ? null : Number(values.lsl);
    if (usl == null && lsl == null) {
      setFormError("At least one of USL or LSL is required.");
      return;
    }
    if (Number.isNaN(Number(values.nominal))) {
      setFormError("Nominal must be a number.");
      return;
    }
    const warnPct = Number(values.warningPercent);
    if (Number.isNaN(warnPct) || warnPct < 0 || warnPct > 100) {
      setFormError("Warning band must be between 0% and 100% (e.g. 75).");
      return;
    }
    const freqN = Number(values.frequencyN);
    if (!Number.isInteger(freqN) || freqN < 1) {
      setFormError("Frequency must be a whole number of at least 1.");
      return;
    }

    const payload = {
      name: values.name.trim(),
      balloonNumber: values.balloonNumber || undefined,
      unit: values.unit || "in",
      nominal: Number(values.nominal),
      usl,
      lsl,
      warningFraction: warnPct / 100,
      gageMethod: values.gageMethod || undefined,
      frequencyType: values.frequencyType,
      frequencyN: freqN,
    };

    if (dimensionId) {
      updateDimension.mutate({ id: dimensionId, ...payload });
    } else {
      addDimension.mutate({
        partRevisionId: revision.id,
        ...payload,
        displayOrder: dimensions.length,
      });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Link href={`/parts/${part.id}`} className="flex items-center gap-1 hover:text-zinc-900">
          <ArrowLeft className="h-3.5 w-3.5" /> {part.partNumber}
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
              Revision {revision.rev}
            </h1>
            <RevisionStatusPill status={revision.status} />
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {isDraft
              ? "Draft — dimensions can be added, edited, or removed."
              : "This revision is locked. Branch a new revision to make changes."}
          </p>
        </div>
        {canEdit && isDraft ? (
          <Button
            className="gap-2"
            isLoading={release.isPending}
            disabled={dimensions.length === 0}
            onClick={() => {
              setReleaseError(null);
              release.mutate({ revisionId: revision.id });
            }}
          >
            <Rocket className="h-4 w-4" /> Release revision
          </Button>
        ) : null}
      </div>

      {releaseError ? (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          {releaseError}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Dimensions</CardTitle>
            <CardDescription>Tolerances, sampling frequency, and gage method.</CardDescription>
          </div>
          {canEdit && isDraft && !adding ? (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" /> Add dimension
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {formError ? (
            <p className="border-b border-zinc-100 bg-rose-50 px-5 py-2 text-sm text-rose-700">
              {formError}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3">Dimension</th>
                  <th className="px-4 py-3">Balloon</th>
                  <th className="px-4 py-3">LSL</th>
                  <th className="px-4 py-3">Nominal</th>
                  <th className="px-4 py-3">USL</th>
                  <th className="px-4 py-3">Warn %</th>
                  <th className="px-4 py-3">Frequency</th>
                  {canEdit && isDraft ? <th className="px-4 py-3" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {dimensions.map((dim) =>
                  editingId === dim.id ? (
                    <DimensionFormRow
                      key={dim.id}
                      initial={dim}
                      onCancel={() => setEditingId(null)}
                      onSubmit={(values) => submitForm(values, dim.id)}
                      isSaving={updateDimension.isPending}
                    />
                  ) : (
                    <DimensionRow
                      key={dim.id}
                      dimension={dim}
                      canEdit={canEdit && isDraft}
                      onEdit={() => setEditingId(dim.id)}
                      onDelete={() => deleteDimension.mutate({ id: dim.id })}
                      isDeleting={deleteDimension.isPending && deleteDimension.variables?.id === dim.id}
                    />
                  ),
                )}
                {adding ? (
                  <DimensionFormRow
                    initial={null}
                    onCancel={() => setAdding(false)}
                    onSubmit={(values) => submitForm(values)}
                    isSaving={addDimension.isPending}
                  />
                ) : null}
                {dimensions.length === 0 && !adding ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-zinc-500">
                      No dimensions yet.
                      {canEdit && isDraft ? " Add one to get started." : ""}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DimensionRow({
  dimension,
  canEdit,
  onEdit,
  onDelete,
  isDeleting,
}: {
  dimension: Dimension;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  return (
    <tr className="hover:bg-zinc-50">
      <td className="px-4 py-3 font-medium text-zinc-900">{dimension.name}</td>
      <td className="px-4 py-3 text-zinc-600">{dimension.balloonNumber ?? "—"}</td>
      <td className="px-4 py-3 tabular text-zinc-600">
        {dimension.lsl ?? "—"} {dimension.lsl != null ? dimension.unit : ""}
      </td>
      <td className="px-4 py-3 tabular font-medium text-zinc-900">
        {dimension.nominal} {dimension.unit}
      </td>
      <td className="px-4 py-3 tabular text-zinc-600">
        {dimension.usl ?? "—"} {dimension.usl != null ? dimension.unit : ""}
      </td>
      <td className="px-4 py-3 tabular text-zinc-600">
        {Math.round(dimension.warningFraction * 100)}%
      </td>
      <td className="px-4 py-3 text-zinc-600">
        {dimension.frequencyType === "every_n_parts"
          ? `Every ${dimension.frequencyN}`
          : `${dimension.frequencyN} per lot`}
      </td>
      {canEdit ? (
        <td className="px-4 py-3 text-right">
          <div className="flex justify-end gap-1">
            <button
              onClick={onEdit}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="Edit dimension"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="rounded-md p-1.5 text-zinc-500 hover:bg-rose-50 hover:text-rose-600"
              aria-label="Delete dimension"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

function DimensionFormRow({
  initial,
  onCancel,
  onSubmit,
  isSaving,
}: {
  initial: Dimension | null;
  onCancel: () => void;
  onSubmit: (values: DimensionFormState) => void;
  isSaving: boolean;
}) {
  const [values, setValues] = useState<DimensionFormState>(
    initial
      ? {
          name: initial.name,
          balloonNumber: initial.balloonNumber ?? "",
          unit: initial.unit,
          nominal: String(initial.nominal),
          usl: initial.usl != null ? String(initial.usl) : "",
          lsl: initial.lsl != null ? String(initial.lsl) : "",
          warningPercent: String(Math.round(initial.warningFraction * 100)),
          gageMethod: initial.gageMethod ?? "",
          frequencyType: initial.frequencyType,
          frequencyN: String(initial.frequencyN),
        }
      : emptyForm,
  );

  function update<K extends keyof DimensionFormState>(key: K, value: DimensionFormState[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  return (
    <tr className="bg-zinc-50/60">
      <td className="px-4 py-2">
        <Input
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="Bore diameter"
          className="h-8 text-sm"
        />
      </td>
      <td className="px-4 py-2">
        <Input
          value={values.balloonNumber}
          onChange={(e) => update("balloonNumber", e.target.value)}
          placeholder="4"
          className="h-8 w-16 text-sm"
        />
      </td>
      <td className="px-4 py-2">
        <Input
          type="number"
          step="any"
          value={values.lsl}
          onChange={(e) => update("lsl", e.target.value)}
          placeholder="—"
          className="h-8 w-24 text-sm"
        />
      </td>
      <td className="px-4 py-2">
        <Input
          type="number"
          step="any"
          required
          value={values.nominal}
          onChange={(e) => update("nominal", e.target.value)}
          className="h-8 w-24 text-sm"
        />
      </td>
      <td className="px-4 py-2">
        <Input
          type="number"
          step="any"
          value={values.usl}
          onChange={(e) => update("usl", e.target.value)}
          placeholder="—"
          className="h-8 w-24 text-sm"
        />
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={values.warningPercent}
            onChange={(e) => {
              const next = e.target.value.replace(/[^\d]/g, "");
              update("warningPercent", next);
            }}
            onFocus={(e) => e.target.select()}
            className="h-8 w-14 text-sm tabular"
            title="Yellow warning starts this % of the way from nominal toward the limit"
            aria-label="Warning band percent"
          />
          <span className="text-xs font-medium text-zinc-500">%</span>
        </div>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1.5">
          <Select
            value={values.frequencyType}
            onChange={(e) => update("frequencyType", e.target.value as FrequencyType)}
            className="h-8 w-32 text-sm"
          >
            <option value="every_n_parts">Every N parts</option>
            <option value="sample_size_per_lot">Sample size / lot</option>
          </Select>
          <Input
            type="number"
            min="1"
            value={values.frequencyN}
            onChange={(e) => update("frequencyN", e.target.value)}
            className="h-8 w-16 text-sm"
          />
        </div>
      </td>
      <td className="px-4 py-2">
        <div className="flex justify-end gap-1">
          <Button size="sm" isLoading={isSaving} onClick={() => onSubmit(values)}>
            Save
          </Button>
          <Button size="icon" variant="ghost" onClick={onCancel} aria-label="Cancel">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
