import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import {
  evaluateDisposition,
  computeCapability,
  roundCapability,
  generateSampleIndices,
  buildPiecePlan,
  flattenPiecePlan,
  type Disposition,
} from "@datasheets/core";
import type { DataSheet, Dimension, Measurement, Part, PartRevision } from "@datasheets/db";
import { Chip } from "../../components/Chip";
import { PrimaryButton } from "../../components/PrimaryButton";
import { StatCard } from "../../components/StatCard";
import { colors, paletteFor } from "../../lib/colors";
import {
  clearDraft,
  getUnsyncedEntries,
  loadDraft,
  markSynced,
  saveDraftValue,
  type SheetDraft,
} from "../../lib/drafts";
import { trpc, trpcErrorMessage } from "../../lib/trpc";

interface SheetDetail {
  sheet: DataSheet;
  part: Part | null;
  revision: PartRevision;
  dimensions: Dimension[];
  measurements: Measurement[];
}

interface CellValue {
  value: number;
  synced: boolean;
}

export default function InspectSheetScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [detail, setDetail] = useState<SheetDetail | null>(null);
  const [draft, setDraft] = useState<SheetDraft>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** Index into flattenPiecePlan(walkOrder) — piece-major entry order */
  const [cellIdx, setCellIdx] = useState(0);
  const [inputText, setInputText] = useState("");
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navBusyRef = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [sheetDetail, localDraft] = await Promise.all([
        trpc.sheets.getById.query({ id }),
        loadDraft(id),
      ]);
      setDetail(sheetDetail);
      setDraft(localDraft);

      const unsynced = getUnsyncedEntries(localDraft);
      for (const entry of unsynced) {
        try {
          const recorded = await trpc.sheets.recordMeasurement.mutate({
            dataSheetId: id,
            dimensionId: entry.dimensionId,
            sampleIndex: entry.sampleIndex,
            value: entry.value,
          });
          const next = await markSynced(id, entry.dimensionId, entry.sampleIndex);
          setDraft(next);
          setDetail((prev) => {
            if (!prev) return prev;
            const withoutThis = prev.measurements.filter(
              (m) =>
                !(m.dimensionId === entry.dimensionId && m.sampleIndex === entry.sampleIndex),
            );
            return { ...prev, measurements: [...withoutThis, recorded] };
          });
        } catch {
          // Leave queued for retry
        }
      }
    } catch (err) {
      setLoadError(trpcErrorMessage(err, "Couldn't load this sheet"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const hasFocusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      if (!hasFocusedOnce.current) {
        hasFocusedOnce.current = true;
        return;
      }
      trpc.sheets.getById
        .query({ id })
        .then((fresh) => setDetail(fresh))
        .catch(() => {});
    }, [id]),
  );

  const dimensions = detail?.dimensions ?? [];

  const piecePlan = useMemo(() => {
    if (!detail) return [];
    return buildPiecePlan(
      detail.sheet.lotSize,
      dimensions.map((d) => ({
        id: d.id,
        frequencyType: d.frequencyType,
        frequencyN: d.frequencyN,
      })),
    );
  }, [detail, dimensions]);

  const walkOrder = useMemo(() => flattenPiecePlan(piecePlan), [piecePlan]);

  const safeCellIdx = Math.min(cellIdx, Math.max(0, walkOrder.length - 1));
  const current = walkOrder[safeCellIdx];
  const dimension = current
    ? dimensions.find((d) => d.id === current.dimensionId)
    : undefined;
  const currentSample = current?.pieceIndex ?? 0;

  const dimsForCurrentPiece = useMemo(() => {
    if (!current) return [];
    const entry = piecePlan.find((p) => p.pieceIndex === current.pieceIndex);
    if (!entry) return [];
    return entry.dimensionIds
      .map((dimId) => dimensions.find((d) => d.id === dimId))
      .filter((d): d is Dimension => !!d);
  }, [current, piecePlan, dimensions]);

  const dimPosInPiece = dimsForCurrentPiece.findIndex((d) => d.id === dimension?.id);

  const dimensionConfig = dimension
    ? {
        nominal: dimension.nominal,
        usl: dimension.usl,
        lsl: dimension.lsl,
        warningFraction: dimension.warningFraction,
      }
    : null;

  const cellsForDimension = useMemo(() => {
    const cells = new Map<number, CellValue>();
    if (!dimension || !detail) return cells;
    for (const m of detail.measurements) {
      if (m.dimensionId === dimension.id) {
        cells.set(m.sampleIndex, { value: m.value, synced: true });
      }
    }
    const dimDraft = draft[dimension.id] ?? {};
    for (const [sampleIndexKey, entry] of Object.entries(dimDraft)) {
      cells.set(Number(sampleIndexKey), { value: entry.value, synced: entry.synced });
    }
    return cells;
  }, [dimension, detail, draft]);

  const dispositionFor = useCallback(
    (value: number): Disposition | null =>
      dimensionConfig ? evaluateDisposition(value, dimensionConfig) : null,
    [dimensionConfig],
  );

  const capability = useMemo(() => {
    if (!dimensionConfig) return null;
    const values = [...cellsForDimension.values()].map((c) => c.value);
    const dispositions = values.map((v) => evaluateDisposition(v, dimensionConfig));
    return roundCapability(computeCapability(values, dimensionConfig, dispositions));
  }, [cellsForDimension, dimensionConfig]);

  useEffect(() => {
    const cell = cellsForDimension.get(currentSample);
    setInputText(cell ? String(cell.value) : "");
  }, [dimension?.id, currentSample]); // eslint-disable-line react-hooks/exhaustive-deps

  // Jump to first empty cell once detail loads
  const didSeek = useRef(false);
  useEffect(() => {
    if (didSeek.current || !detail || walkOrder.length === 0) return;
    didSeek.current = true;
    const firstEmpty = walkOrder.findIndex((c) => {
      const measured = detail.measurements.some(
        (m) => m.dimensionId === c.dimensionId && m.sampleIndex === c.pieceIndex,
      );
      const drafted = draft[c.dimensionId]?.[c.pieceIndex] != null;
      return !measured && !drafted;
    });
    if (firstEmpty >= 0) setCellIdx(firstEmpty);
  }, [detail, walkOrder, draft]);

  const parsedValue = useMemo(() => {
    const n = Number(inputText);
    return inputText.trim().length > 0 && Number.isFinite(n) ? n : null;
  }, [inputText]);

  const liveDisposition = parsedValue != null ? dispositionFor(parsedValue) : null;
  const knownCell = cellsForDimension.get(currentSample);
  const displayDisposition =
    liveDisposition ?? (knownCell ? dispositionFor(knownCell.value) : null);
  const palette = paletteFor(displayDisposition);

  const onChangeValue = (text: string) => {
    setInputText(text);
    if (!dimension || !id) return;
    const n = Number(text);
    if (text.trim().length === 0 || !Number.isFinite(n)) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const next = await saveDraftValue(id, dimension.id, currentSample, n, false);
      setDraft(next);
    }, 200);
  };

  const flushValue = useCallback(
    async (value: number) => {
      if (!dimension || !id) return;
      setSaving(true);
      try {
        const recorded = await trpc.sheets.recordMeasurement.mutate({
          dataSheetId: id,
          dimensionId: dimension.id,
          sampleIndex: currentSample,
          value,
        });
        const next = await markSynced(id, dimension.id, currentSample);
        setDraft(next);
        setDetail((prev) => {
          if (!prev) return prev;
          const withoutThis = prev.measurements.filter(
            (m) => !(m.dimensionId === dimension.id && m.sampleIndex === currentSample),
          );
          return { ...prev, measurements: [...withoutThis, recorded] };
        });
      } catch (err) {
        setBanner(trpcErrorMessage(err, "Couldn't sync — saved locally, will retry"));
      } finally {
        setSaving(false);
      }
    },
    [dimension, id, currentSample],
  );

  const commitCurrentValue = useCallback(async () => {
    if (parsedValue == null || !dimension || !id) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const next = await saveDraftValue(id, dimension.id, currentSample, parsedValue, false);
    setDraft(next);
    await flushValue(parsedValue);
  }, [parsedValue, dimension, id, currentSample, flushValue]);

  const goToCell = async (idx: number) => {
    if (navBusyRef.current || saving || completing) return;
    navBusyRef.current = true;
    try {
      await commitCurrentValue();
      setCellIdx(Math.max(0, Math.min(idx, walkOrder.length - 1)));
    } finally {
      navBusyRef.current = false;
    }
  };

  const goNext = async () => {
    if (safeCellIdx < walkOrder.length - 1) await goToCell(safeCellIdx + 1);
  };

  const goPrev = async () => {
    if (safeCellIdx > 0) await goToCell(safeCellIdx - 1);
  };

  const goToPiece = async (pieceIndex: number) => {
    const idx = walkOrder.findIndex((c) => c.pieceIndex === pieceIndex);
    if (idx >= 0) await goToCell(idx);
  };

  const goToDimensionOnPiece = async (dimensionId: string) => {
    if (!current) return;
    const idx = walkOrder.findIndex(
      (c) => c.pieceIndex === current.pieceIndex && c.dimensionId === dimensionId,
    );
    if (idx >= 0) await goToCell(idx);
  };

  const allComplete = useMemo(() => {
    if (!detail) return false;
    return dimensions.every((dim) => {
      const required = generateSampleIndices(detail.sheet.lotSize, {
        type: dim.frequencyType,
        n: dim.frequencyN,
      });
      const draftForDim = draft[dim.id] ?? {};
      const measuredForDim = new Set(
        detail.measurements.filter((m) => m.dimensionId === dim.id).map((m) => m.sampleIndex),
      );
      return required.every((s) => measuredForDim.has(s) || draftForDim[s] != null);
    });
  }, [detail, dimensions, draft]);

  const remainingCount = useMemo(() => {
    if (!detail) return 0;
    let left = 0;
    for (const c of walkOrder) {
      const measured = detail.measurements.some(
        (m) => m.dimensionId === c.dimensionId && m.sampleIndex === c.pieceIndex,
      );
      const drafted = draft[c.dimensionId]?.[c.pieceIndex] != null;
      if (!measured && !drafted) left += 1;
    }
    return left;
  }, [detail, walkOrder, draft]);

  const onComplete = async () => {
    if (!id || !detail) return;
    setCompleting(true);
    setBanner(null);
    try {
      await commitCurrentValue();
      const latestDraft = await loadDraft(id);
      const unsynced = getUnsyncedEntries(latestDraft);
      for (const entry of unsynced) {
        const recorded = await trpc.sheets.recordMeasurement.mutate({
          dataSheetId: id,
          dimensionId: entry.dimensionId,
          sampleIndex: entry.sampleIndex,
          value: entry.value,
        });
        await markSynced(id, entry.dimensionId, entry.sampleIndex);
        setDetail((prev) => {
          if (!prev) return prev;
          const withoutThis = prev.measurements.filter(
            (m) =>
              !(m.dimensionId === entry.dimensionId && m.sampleIndex === entry.sampleIndex),
          );
          return { ...prev, measurements: [...withoutThis, recorded] };
        });
      }
      await trpc.sheets.complete.mutate({ dataSheetId: id });
      await clearDraft(id);
      router.replace("/");
    } catch (err) {
      const message = trpcErrorMessage(err, "Couldn't complete this sheet");
      Alert.alert("Missing measurements", message, [
        { text: "Keep measuring", style: "cancel" },
        {
          text: "Complete anyway",
          style: "destructive",
          onPress: async () => {
            try {
              await trpc.sheets.complete.mutate({ dataSheetId: id, force: true });
              await clearDraft(id);
              router.replace("/");
            } catch (forceErr) {
              setBanner(trpcErrorMessage(forceErr, "Couldn't complete this sheet"));
            }
          },
        },
      ]);
    } finally {
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || !detail || !dimension || !dimensionConfig || !current) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
        <View style={styles.centerFill}>
          <Text style={styles.error}>{loadError ?? "This sheet has no dimensions to measure"}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const pieceOrdinal = piecePlan.findIndex((p) => p.pieceIndex === current.pieceIndex) + 1;

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <View style={styles.headerBar}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {detail.part?.partNumber ?? "Part"} · Lot {detail.sheet.lotNumber}
        </Text>
        <Text style={styles.headerMeta}>{detail.sheet.lotSize} pcs</Text>
      </View>

      <Text style={styles.progressLabel}>
        Piece {pieceOrdinal} of {piecePlan.length}
        {" · "}
        Dimension {dimPosInPiece + 1} of {dimsForCurrentPiece.length}
      </Text>

      {/* Piece chips — primary navigation */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {piecePlan.map((entry) => {
          const filled = entry.dimensionIds.filter((dimId) => {
            const measured = detail.measurements.some(
              (m) => m.dimensionId === dimId && m.sampleIndex === entry.pieceIndex,
            );
            const drafted = draft[dimId]?.[entry.pieceIndex] != null;
            return measured || drafted;
          }).length;
          const done = filled === entry.dimensionIds.length;
          return (
            <Chip
              key={entry.pieceIndex}
              label={`Pc ${entry.pieceIndex + 1}`}
              active={entry.pieceIndex === current.pieceIndex}
              disposition={
                entry.pieceIndex === current.pieceIndex ? undefined : done ? "green" : null
              }
              disabled={saving || completing}
              onPress={() => {
                void goToPiece(entry.pieceIndex);
              }}
            />
          );
        })}
      </ScrollView>

      {/* Dimensions due on this piece */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {dimsForCurrentPiece.map((dim) => {
          const measured =
            detail.measurements.some(
              (m) => m.dimensionId === dim.id && m.sampleIndex === current.pieceIndex,
            ) || draft[dim.id]?.[current.pieceIndex] != null;
          return (
            <Chip
              key={dim.id}
              label={dim.balloonNumber ? `#${dim.balloonNumber} ${dim.name}` : dim.name}
              active={dim.id === dimension.id}
              disposition={dim.id === dimension.id ? undefined : measured ? "green" : null}
              disabled={saving || completing}
              onPress={() => {
                void goToDimensionOnPiece(dim.id);
              }}
            />
          );
        })}
      </ScrollView>

      <View style={[styles.entryCard, { backgroundColor: palette.fill, borderColor: palette.border }]}>
        <Text style={[styles.entryPiece, { color: palette.onFill }]}>
          Piece {current.pieceIndex + 1}
        </Text>
        <Text style={[styles.entryDimName, { color: palette.onFill }]}>{dimension.name}</Text>
        <Text style={[styles.entryTolerance, { color: palette.onFill }]}>
          {dimension.nominal}
          {dimension.usl != null ? ` / USL ${dimension.usl}` : ""}
          {dimension.lsl != null ? ` / LSL ${dimension.lsl}` : ""} {dimension.unit}
        </Text>

        <TextInput
          style={[styles.bigInput, { color: palette.onFill }]}
          value={inputText}
          onChangeText={onChangeValue}
          onBlur={() => {
            void commitCurrentValue();
          }}
          onSubmitEditing={() => {
            void goNext();
          }}
          keyboardType="decimal-pad"
          placeholder="0.000"
          placeholderTextColor={palette.onFill + "88"}
          returnKeyType="next"
          autoFocus
        />

        <Text style={[styles.entryStatus, { color: palette.onFill }]}>
          {saving
            ? "Syncing…"
            : displayDisposition
              ? paletteFor(displayDisposition).label
              : "Enter a value"}
        </Text>
      </View>

      <View style={styles.sampleNavRow}>
        <PrimaryButton
          label="‹ Prev"
          onPress={() => {
            void goPrev();
          }}
          variant="secondary"
          style={styles.navBtn}
          disabled={saving || completing || safeCellIdx <= 0}
        />
        <Text style={styles.navCenter}>
          {safeCellIdx + 1} / {walkOrder.length}
        </Text>
        <PrimaryButton
          label="Next ›"
          onPress={() => {
            void goNext();
          }}
          variant="secondary"
          style={styles.navBtn}
          disabled={saving || completing || safeCellIdx >= walkOrder.length - 1}
        />
      </View>

      <View style={styles.statsRow}>
        <StatCard label="n" value={String(capability?.n ?? 0)} />
        <StatCard label="Mean" value={capability?.mean != null ? capability.mean.toFixed(4) : "—"} />
        <StatCard
          label="Cpk"
          value={capability?.cpk != null ? capability.cpk.toFixed(2) : "—"}
          emphasis
          tone={
            capability?.cpk == null
              ? "neutral"
              : capability.cpk >= 1.33
                ? "good"
                : capability.cpk >= 1
                  ? "neutral"
                  : "bad"
          }
        />
        <StatCard label="Pp" value={capability?.cp != null ? capability.cp.toFixed(2) : "—"} />
      </View>

      {banner ? <Text style={styles.banner}>{banner}</Text> : null}

      <View style={styles.footer}>
        <PrimaryButton
          label={
            allComplete
              ? "Complete Sheet"
              : `Complete Sheet (${remainingCount} left)`
          }
          onPress={onComplete}
          loading={completing}
          variant={allComplete ? "primary" : "secondary"}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  error: { color: colors.danger, fontSize: 16, fontWeight: "600", textAlign: "center" },
  headerBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "800", color: colors.textPrimary },
  headerMeta: { fontSize: 14, color: colors.textSecondary, marginLeft: 8 },
  progressLabel: {
    paddingHorizontal: 20,
    paddingBottom: 4,
    fontSize: 13,
    fontWeight: "600",
    color: colors.textSecondary,
  },
  chipRow: { paddingHorizontal: 16, paddingVertical: 6, flexGrow: 0 },
  entryCard: {
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 20,
    borderWidth: 2,
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 6,
  },
  entryPiece: { fontSize: 13, fontWeight: "700", opacity: 0.75, textTransform: "uppercase" },
  entryDimName: { fontSize: 16, fontWeight: "700" },
  entryTolerance: { fontSize: 13, fontWeight: "600", opacity: 0.85 },
  bigInput: {
    fontSize: 64,
    fontWeight: "800",
    textAlign: "center",
    minWidth: "80%",
    paddingVertical: 8,
  },
  entryStatus: { fontSize: 16, fontWeight: "700" },
  sampleNavRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 8,
  },
  navBtn: { minWidth: 84, paddingHorizontal: 12 },
  navCenter: {
    flex: 1,
    textAlign: "center",
    fontSize: 14,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  statsRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 14 },
  banner: {
    color: colors.danger,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  footer: { padding: 16, paddingBottom: 20 },
});
