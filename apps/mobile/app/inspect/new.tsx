import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CreateDataSheetSchema } from "@datasheets/core";
import type { Part, PartRevision, Dimension } from "@datasheets/db";
import { PrimaryButton } from "../../components/PrimaryButton";
import { colors } from "../../lib/colors";
import { trpc, trpcErrorMessage } from "../../lib/trpc";

export default function NewInspectionScreen() {
  const router = useRouter();

  const [partNumber, setPartNumber] = useState("");
  const [results, setResults] = useState<Part[]>([]);
  const [searching, setSearching] = useState(false);

  const [preview, setPreview] = useState<{
    part: Part;
    revision: PartRevision;
    dimensions: Dimension[];
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [lotNumber, setLotNumber] = useState("");
  const [lotSize, setLotSize] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    const q = partNumber.trim();
    if (q.length < 1) {
      setResults([]);
      return;
    }
    setSearching(true);
    searchDebounce.current = setTimeout(async () => {
      try {
        const found = await trpc.parts.search.query({ q });
        setResults(found);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [partNumber]);

  const selectPart = async (p: Part) => {
    setPartNumber(p.partNumber);
    setResults([]);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const found = await trpc.parts.getReleasedByPartNumber.query({ partNumber: p.partNumber });
      setPreview(found);
    } catch (err) {
      setPreview(null);
      setPreviewError(trpcErrorMessage(err, "No released revision for this part"));
    } finally {
      setPreviewLoading(false);
    }
  };

  const onCreate = async () => {
    setFormError(null);
    const parsed = CreateDataSheetSchema.safeParse({
      partNumber: partNumber.trim(),
      lotNumber: lotNumber.trim(),
      lotSize: Number(lotSize),
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Check the form and try again");
      return;
    }
    if (!preview) {
      setFormError("Look up a part with a released revision first");
      return;
    }
    setCreating(true);
    try {
      const result = await trpc.sheets.create.mutate(parsed.data);
      router.replace({ pathname: "/inspect/[id]", params: { id: result.sheet.id } });
    } catch (err) {
      setFormError(trpcErrorMessage(err, "Couldn't create the inspection sheet"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["bottom", "left", "right"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Part number</Text>
            <TextInput
              style={styles.input}
              value={partNumber}
              onChangeText={setPartNumber}
              placeholder="e.g. 4471-B"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {searching ? <ActivityIndicator style={styles.searchSpinner} color={colors.accent} /> : null}
          </View>

          {results.length > 0 && (
            <View style={styles.resultsBox}>
              {results.slice(0, 6).map((p) => (
                <Pressable key={p.id} style={styles.resultRow} onPress={() => selectPart(p)}>
                  <Text style={styles.resultPn}>{p.partNumber}</Text>
                  {p.description ? (
                    <Text style={styles.resultDesc} numberOfLines={1}>
                      {p.description}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}

          {previewLoading ? (
            <View style={styles.previewCard}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : preview ? (
            <View style={styles.previewCard}>
              <Text style={styles.previewTitle}>
                {preview.part.partNumber} · Rev {preview.revision.rev}
              </Text>
              <Text style={styles.previewMeta}>
                {preview.dimensions.length} dimension{preview.dimensions.length === 1 ? "" : "s"} on released
                drawing
              </Text>
            </View>
          ) : previewError ? (
            <Text style={styles.previewError}>{previewError}</Text>
          ) : null}

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Lot number</Text>
            <TextInput
              style={styles.input}
              value={lotNumber}
              onChangeText={setLotNumber}
              placeholder="e.g. L-20260713-01"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Lot size (pieces)</Text>
            <TextInput
              style={styles.input}
              value={lotSize}
              onChangeText={(v) => setLotSize(v.replace(/[^0-9]/g, ""))}
              placeholder="e.g. 50"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
            />
          </View>

          {formError ? <Text style={styles.error}>{formError}</Text> : null}

          <PrimaryButton
            label="Create & Start"
            onPress={onCreate}
            loading={creating}
            disabled={!preview}
            style={styles.submit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: 20, gap: 16 },
  field: { gap: 8 },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontSize: 18,
    paddingHorizontal: 16,
  },
  searchSpinner: { position: "absolute", right: 16, top: 40 },
  resultsBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  resultRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultPn: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  resultDesc: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  previewCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
    padding: 16,
    gap: 4,
  },
  previewTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },
  previewMeta: { fontSize: 14, color: colors.textSecondary },
  previewError: { color: colors.danger, fontSize: 14, fontWeight: "600" },
  error: { color: colors.danger, fontSize: 15, fontWeight: "600" },
  submit: { marginTop: 8 },
});
