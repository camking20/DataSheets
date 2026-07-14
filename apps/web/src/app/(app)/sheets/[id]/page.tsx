"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react";
import {
  evaluateDisposition,
  computeCapability,
  generateSampleIndices,
  buildPiecePlan,
  flattenPiecePlan,
  roundCapability,
} from "@datasheets/core";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SheetStatusPill } from "@/components/ui/status-pill";
import { DispositionBadge, DispositionDot } from "@/components/DispositionBadge";
import { cn, downloadBase64, formatDate, formatNumber } from "@/lib/utils";
import { formatApiError } from "@/lib/errors";
import type {
  Dimension,
  Disposition,
  ExportFileResult,
  Measurement,
  SheetDetail,
} from "@/lib/api-types";

type SheetDetailResult = SheetDetail & {
  samplePlan?: Array<{ dimensionId: string; sampleIndices: number[] }>;
};

const PAGE_SIZE = 20;

const flashClass: Record<Disposition, string> = {
  green: "flash-green",
  yellow: "flash-yellow",
  red: "flash-red",
};

const cellTone: Record<Disposition, string> = {
  green: "border-emerald-300 bg-emerald-50 text-emerald-900 focus:ring-emerald-200",
  yellow: "border-amber-300 bg-amber-50 text-amber-900 focus:ring-amber-200",
  red: "border-rose-300 bg-rose-50 text-rose-900 focus:ring-rose-200",
};

export default function SheetDetailPage() {
  const params = useParams<{ id: string }>();
  const utils = trpc.useUtils();

  const { data, isLoading, isError } = trpc.sheets.getById.useQuery({ id: params.id });
  const result = data as SheetDetailResult | undefined;

  const [localMeasurements, setLocalMeasurements] = useState<Map<string, Measurement>>(new Map());
  const [completeError, setCompleteError] = useState<string | null>(null);

  const complete = trpc.sheets.complete.useMutation({
    onSuccess: () => utils.sheets.getById.invalidate({ id: params.id }),
    onError: (err: { message?: string }) =>
      setCompleteError(formatApiError(err, "Unable to complete this sheet.")),
  });

  function mergeMeasurement(m: Measurement) {
    setLocalMeasurements((prev) => {
      const next = new Map(prev);
      next.set(`${m.dimensionId}:${m.sampleIndex}`, m);
      return next;
    });
  }

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
          Couldn&apos;t load this data sheet. It may not exist yet, or the sheets service
          isn&apos;t available.
        </CardContent>
      </Card>
    );
  }

  const { sheet, part, revision, dimensions, measurements } = result;

  const measurementMap = new Map<string, Measurement>();
  for (const m of measurements) measurementMap.set(`${m.dimensionId}:${m.sampleIndex}`, m);
  for (const [key, m] of localMeasurements) measurementMap.set(key, m);

  const isCompleted = sheet.status === "completed";

  let totalRequired = 0;
  let totalMeasured = 0;
  for (const dim of dimensions) {
    const indices = generateSampleIndices(sheet.lotSize, {
      type: dim.frequencyType,
      n: dim.frequencyN,
    });
    totalRequired += indices.length;
    for (const idx of indices) {
      if (measurementMap.has(`${dim.id}:${idx}`)) totalMeasured += 1;
    }
  }
  const canComplete = !isCompleted && totalRequired > 0 && totalMeasured === totalRequired;

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Link href="/sheets" className="flex items-center gap-1 hover:text-zinc-900">
          <ArrowLeft className="h-3.5 w-3.5" /> Sheets
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
              {part?.partNumber ?? "Unknown part"} rev {revision.rev}
            </h1>
            <SheetStatusPill status={sheet.status} />
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            Lot {sheet.lotNumber} · {sheet.lotSize} pieces · Started {formatDate(sheet.createdAt)}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            Enter down each piece column — all dimensions for piece 1, then piece 2.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isCompleted ? (
            <div className="text-right">
              <p className="text-xs text-zinc-500">
                {totalMeasured} / {totalRequired} samples
              </p>
              <Button
                className="mt-1 gap-2"
                disabled={!canComplete}
                isLoading={complete.isPending}
                onClick={() => {
                  setCompleteError(null);
                  complete.mutate({ dataSheetId: sheet.id });
                }}
              >
                <CheckCircle2 className="h-4 w-4" /> Complete sheet
              </Button>
            </div>
          ) : (
            <ExportButtons sheetId={sheet.id} />
          )}
        </div>
      </div>

      {completeError ? (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          {completeError}
        </p>
      ) : null}

      {dimensions.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-zinc-500">
            This revision has no dimensions configured.
          </CardContent>
        </Card>
      ) : (
        <MeasurementMatrix
          sheetId={sheet.id}
          lotSize={sheet.lotSize}
          dimensions={dimensions}
          measurementMap={measurementMap}
          readOnly={isCompleted}
          onSaved={mergeMeasurement}
        />
      )}
    </div>
  );
}

function MeasurementMatrix({
  sheetId,
  lotSize,
  dimensions,
  measurementMap,
  readOnly,
  onSaved,
}: {
  sheetId: string;
  lotSize: number;
  dimensions: Dimension[];
  measurementMap: Map<string, Measurement>;
  readOnly: boolean;
  onSaved: (m: Measurement) => void;
}) {
  const [page, setPage] = useState(0);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const didAutoFocus = useRef(false);

  const piecePlan = useMemo(
    () =>
      buildPiecePlan(
        lotSize,
        dimensions.map((d) => ({
          id: d.id,
          frequencyType: d.frequencyType,
          frequencyN: d.frequencyN,
        })),
      ),
    [lotSize, dimensions],
  );

  const pieceIndices = useMemo(
    () => piecePlan.map((p) => p.pieceIndex),
    [piecePlan],
  );

  const dueSet = useMemo(() => {
    const set = new Set<string>();
    for (const entry of piecePlan) {
      for (const dimId of entry.dimensionIds) {
        set.add(`${dimId}:${entry.pieceIndex}`);
      }
    }
    return set;
  }, [piecePlan]);

  const walkOrder = useMemo(() => flattenPiecePlan(piecePlan), [piecePlan]);

  const pageCount = Math.max(1, Math.ceil(pieceIndices.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagePieces = pieceIndices.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  const focusCell = useCallback((dimensionId: string, pieceIndex: number) => {
    const el = inputRefs.current.get(`${dimensionId}:${pieceIndex}`);
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const focusNext = useCallback(
    (dimensionId: string, pieceIndex: number) => {
      const idx = walkOrder.findIndex(
        (c) => c.dimensionId === dimensionId && c.pieceIndex === pieceIndex,
      );
      if (idx < 0) return;
      const next = walkOrder[idx + 1];
      if (!next) return;

      const nextPage = Math.floor(
        pieceIndices.indexOf(next.pieceIndex) / PAGE_SIZE,
      );
      if (nextPage !== safePage && nextPage >= 0) {
        setPage(nextPage);
        // Focus after page re-render
        window.setTimeout(() => focusCell(next.dimensionId, next.pieceIndex), 50);
      } else {
        focusCell(next.dimensionId, next.pieceIndex);
      }
    },
    [walkOrder, pieceIndices, safePage, focusCell],
  );

  // Auto-focus first empty required cell on load
  useEffect(() => {
    if (didAutoFocus.current || readOnly || walkOrder.length === 0) return;
    didAutoFocus.current = true;
    const firstEmpty = walkOrder.find(
      (c) => !measurementMap.has(`${c.dimensionId}:${c.pieceIndex}`),
    );
    const target = firstEmpty ?? walkOrder[0];
    if (!target) return;
    const targetPage = Math.floor(
      pieceIndices.indexOf(target.pieceIndex) / PAGE_SIZE,
    );
    if (targetPage > 0) setPage(targetPage);
    window.setTimeout(() => focusCell(target.dimensionId, target.pieceIndex), 80);
  }, [walkOrder, measurementMap, pieceIndices, readOnly, focusCell]);

  function pieceProgress(pieceIndex: number) {
    const entry = piecePlan.find((p) => p.pieceIndex === pieceIndex);
    if (!entry) return { filled: 0, required: 0 };
    const required = entry.dimensionIds.length;
    const filled = entry.dimensionIds.filter((id) =>
      measurementMap.has(`${id}:${pieceIndex}`),
    ).length;
    return { filled, required };
  }

  function registerRef(key: string, el: HTMLInputElement | null) {
    if (el) inputRefs.current.set(key, el);
    else inputRefs.current.delete(key);
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-zinc-900">Inspection matrix</p>
          <p className="text-xs text-zinc-500">
            Rows = dimensions · Columns = pieces · Gray cells = not due this piece
          </p>
        </div>
        {pageCount > 1 ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="gap-1"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </Button>
            <span className="text-xs tabular text-zinc-500">
              Pieces {safePage * PAGE_SIZE + 1}–
              {Math.min((safePage + 1) * PAGE_SIZE, pieceIndices.length)} of{" "}
              {pieceIndices.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="gap-1"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <span className="text-xs text-zinc-500">
            {pieceIndices.length} piece{pieceIndices.length === 1 ? "" : "s"} to inspect
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 min-w-[200px] border-b border-r border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Dimension
              </th>
              {pagePieces.map((pieceIndex) => {
                const { filled, required } = pieceProgress(pieceIndex);
                const done = required > 0 && filled === required;
                return (
                  <th
                    key={pieceIndex}
                    className={cn(
                      "sticky top-0 z-10 min-w-[88px] border-b border-zinc-200 bg-zinc-50 px-1.5 py-2 text-center",
                      done && "bg-emerald-50",
                    )}
                  >
                    <div className="text-xs font-semibold text-zinc-800">
                      Pc {pieceIndex + 1}
                    </div>
                    <div
                      className={cn(
                        "mt-0.5 text-[10px] tabular",
                        done ? "font-medium text-emerald-700" : "text-zinc-400",
                      )}
                    >
                      {filled}/{required}
                    </div>
                  </th>
                );
              })}
              <th className="sticky right-0 z-20 min-w-[160px] border-b border-l border-zinc-200 bg-zinc-50 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Capability
              </th>
            </tr>
          </thead>
          <tbody>
            {dimensions.map((dim) => {
              const indices = generateSampleIndices(lotSize, {
                type: dim.frequencyType,
                n: dim.frequencyN,
              });
              const entered = indices
                .map((idx) => measurementMap.get(`${dim.id}:${idx}`))
                .filter((m): m is Measurement => !!m);
              const capability = roundCapability(
                computeCapability(
                  entered.map((m) => m.value),
                  dim,
                  entered.map((m) => m.disposition),
                ),
                2,
              );
              const worst: Disposition | null = entered.some((m) => m.disposition === "red")
                ? "red"
                : entered.some((m) => m.disposition === "yellow")
                  ? "yellow"
                  : entered.length > 0
                    ? "green"
                    : null;

              return (
                <tr key={dim.id} className="group">
                  <td className="sticky left-0 z-10 border-b border-r border-zinc-100 bg-white px-3 py-2 group-hover:bg-zinc-50">
                    <div className="flex items-center gap-1.5">
                      {dim.balloonNumber ? (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-semibold text-white">
                          {dim.balloonNumber}
                        </span>
                      ) : null}
                      <span className="font-medium text-zinc-900">{dim.name}</span>
                      {worst ? <DispositionBadge disposition={worst} compact /> : null}
                    </div>
                    <p className="mt-0.5 text-[11px] text-zinc-400">
                      {dim.lsl != null ? `LSL ${dim.lsl} ` : ""}
                      NOM {dim.nominal}
                      {dim.usl != null ? ` USL ${dim.usl}` : ""} {dim.unit}
                      {" · "}
                      {dim.frequencyType === "every_n_parts"
                        ? `every ${dim.frequencyN}`
                        : `${dim.frequencyN}/lot`}
                    </p>
                  </td>
                  {pagePieces.map((pieceIndex) => {
                    const due = dueSet.has(`${dim.id}:${pieceIndex}`);
                    if (!due) {
                      return (
                        <td
                          key={pieceIndex}
                          className="border-b border-zinc-100 bg-zinc-50/80 px-1.5 py-1.5 text-center"
                        >
                          <span className="text-zinc-300">—</span>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={pieceIndex}
                        className="border-b border-zinc-100 px-1 py-1.5 align-middle"
                      >
                        <MatrixCell
                          sheetId={sheetId}
                          dimension={dim}
                          sampleIndex={pieceIndex}
                          existing={measurementMap.get(`${dim.id}:${pieceIndex}`)}
                          readOnly={readOnly}
                          onSaved={onSaved}
                          inputRef={(el) => registerRef(`${dim.id}:${pieceIndex}`, el)}
                          onAdvance={() => focusNext(dim.id, pieceIndex)}
                        />
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 border-b border-l border-zinc-100 bg-white px-3 py-2 group-hover:bg-zinc-50">
                    <div className="flex items-center justify-center gap-3 text-[11px]">
                      <MiniStat label="n" value={String(capability.n)} />
                      <MiniStat label="μ" value={formatNumber(capability.mean, 3)} />
                      <MiniStat
                        label="Pp"
                        value={formatNumber(capability.cp, 2)}
                        title="Pp — overall capability using sample standard deviation (overall / long-term sigma)"
                      />
                      <MiniStat
                        label="Ppk"
                        value={formatNumber(capability.cpk, 2)}
                        emphasize
                        title="Ppk — overall capability index using sample standard deviation (overall / long-term sigma)"
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  emphasize,
  title,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  title?: string;
}) {
  return (
    <div className="text-center" title={title}>
      <p className="text-zinc-400">{label}</p>
      <p className={cn("tabular font-semibold text-zinc-900", emphasize && "text-emerald-700")}>
        {value}
      </p>
    </div>
  );
}

function MatrixCell({
  sheetId,
  dimension,
  sampleIndex,
  existing,
  readOnly,
  onSaved,
  inputRef,
  onAdvance,
}: {
  sheetId: string;
  dimension: Dimension;
  sampleIndex: number;
  existing: Measurement | undefined;
  readOnly: boolean;
  onSaved: (m: Measurement) => void;
  inputRef: (el: HTMLInputElement | null) => void;
  onAdvance: () => void;
}) {
  const [value, setValue] = useState(existing?.value != null ? String(existing.value) : "");
  const [disposition, setDisposition] = useState<Disposition | null>(existing?.disposition ?? null);
  const [flashing, setFlashing] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(existing?.value ?? null);
  const [committedDisposition, setCommittedDisposition] = useState<Disposition | null>(
    existing?.disposition ?? null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync from server when a measurement lands from elsewhere
  useEffect(() => {
    if (existing?.value != null && existing.value !== lastSaved) {
      setValue(String(existing.value));
      setDisposition(existing.disposition);
      setCommittedDisposition(existing.disposition);
      setLastSaved(existing.value);
      setSaveError(null);
    }
  }, [existing?.value, existing?.disposition, lastSaved]);

  const record = trpc.sheets.recordMeasurement.useMutation();

  function commit(): boolean {
    const num = Number(value);
    if (value.trim() === "" || Number.isNaN(num)) return false;
    if (num === lastSaved) return true;

    const rollbackValue = lastSaved != null ? String(lastSaved) : "";
    const rollbackDisposition = committedDisposition;
    const nextDisposition = evaluateDisposition(num, dimension);

    // Optimistic flash — lastSaved/disposition are not committed until onSuccess
    setDisposition(nextDisposition);
    setFlashing(true);
    setSaveError(null);
    window.setTimeout(() => setFlashing(false), 280);

    record.mutate(
      {
        dataSheetId: sheetId,
        dimensionId: dimension.id,
        sampleIndex,
        value: num,
      },
      {
        onSuccess: (m: Measurement) => {
          setLastSaved(m.value);
          setCommittedDisposition(m.disposition);
          setDisposition(m.disposition);
          setValue(String(m.value));
          setSaveError(null);
          onSaved(m);
        },
        onError: (err: unknown) => {
          setValue(rollbackValue);
          setDisposition(rollbackDisposition);
          setSaveError(formatApiError(err, "Unable to save measurement."));
        },
      },
    );
    return true;
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const ok = commit();
      if (ok || value.trim() === "") onAdvance();
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="number"
        step="any"
        inputMode="decimal"
        tabIndex={-1}
        disabled={readOnly}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          commit();
        }}
        onKeyDown={handleKeyDown}
        placeholder="—"
        aria-label={`${dimension.name} piece ${sampleIndex + 1}`}
        aria-invalid={saveError ? true : undefined}
        title={saveError ?? undefined}
        className={cn(
          "h-11 w-full rounded-md border text-center text-base font-semibold tabular outline-none transition-colors",
          "focus:ring-2 disabled:cursor-not-allowed disabled:opacity-70",
          disposition ? cellTone[disposition] : "border-zinc-300 bg-white text-zinc-900",
          flashing && disposition ? flashClass[disposition] : "",
          saveError && "ring-2 ring-rose-300",
        )}
      />
      {disposition ? (
        <div className="pointer-events-none absolute -bottom-0.5 left-1/2 -translate-x-1/2">
          <DispositionDot disposition={disposition} className="h-1.5 w-1.5" />
        </div>
      ) : null}
      {saveError ? (
        <p
          className="mt-0.5 max-w-[88px] text-center text-[9px] leading-tight text-rose-600 line-clamp-2"
          title={saveError}
        >
          {saveError}
        </p>
      ) : null}
    </div>
  );
}

function ExportButtons({ sheetId }: { sheetId: string }) {
  const utils = trpc.useUtils();
  const [loadingFormat, setLoadingFormat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExport(format: "csv" | "excel" | "pdf") {
    setError(null);
    setLoadingFormat(format);
    try {
      const result = (await utils.client.exports.generate.mutate({
        dataSheetId: sheetId,
        format,
      })) as ExportFileResult;
      downloadBase64(result.fileName, result.mimeType, result.base64);
    } catch (err) {
      setError(formatApiError(err, "Export isn't available yet — check the API."));
    } finally {
      setLoadingFormat(null);
    }
  }

  return (
    <div className="text-right">
      <div className="flex items-center gap-2">
        <ExportButton
          label="CSV"
          icon={FileText}
          loading={loadingFormat === "csv"}
          onClick={() => handleExport("csv")}
        />
        <ExportButton
          label="Excel"
          icon={FileSpreadsheet}
          loading={loadingFormat === "excel"}
          onClick={() => handleExport("excel")}
        />
        <ExportButton
          label="PDF"
          icon={Download}
          loading={loadingFormat === "pdf"}
          onClick={() => handleExport("pdf")}
        />
      </div>
      {error ? <p className="mt-2 max-w-xs text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

function ExportButton({
  label,
  icon: Icon,
  loading,
  onClick,
}: {
  label: string;
  icon: typeof FileText;
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" size="sm" className="gap-1.5" isLoading={loading} onClick={onClick}>
      {!loading ? <Icon className="h-3.5 w-3.5" /> : null}
      {label}
    </Button>
  );
}
