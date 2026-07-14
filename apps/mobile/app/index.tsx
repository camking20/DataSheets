import { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { PrimaryButton } from "../components/PrimaryButton";
import { Chip } from "../components/Chip";
import { useAuth } from "../lib/auth";
import { colors } from "../lib/colors";
import { trpc, trpcErrorMessage } from "../lib/trpc";
import type { DataSheet, Part, PartRevision } from "@datasheets/db";

interface SheetRow {
  sheet: DataSheet;
  revision: PartRevision;
  part: Part;
}

export default function HomeScreen() {
  const { user, company, signOut } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const result = await trpc.sheets.list.query({ status: "in_progress" });
      setRows(result);
    } catch (err) {
      setError(trpcErrorMessage(err, "Couldn't load in-progress sheets"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load({ silent: true });
    }, [load]),
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.wordmark}>DataSheets</Text>
          <Text style={styles.subtitle}>
            {company?.name ?? "—"} · {user?.name ?? ""}
          </Text>
        </View>
        <Pressable onPress={signOut} style={styles.logout}>
          <Text style={styles.logoutLabel}>Log out</Text>
        </Pressable>
      </View>

      <View style={styles.ctaWrap}>
        <PrimaryButton
          label="Start Inspection"
          onPress={() => router.push("/inspect/new")}
          style={styles.cta}
        />
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>In-progress sheets</Text>
        {rows.length > 0 ? <Chip label={`${rows.length}`} /> : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={rows}
        keyExtractor={(row) => row.sheet.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No open sheets</Text>
              <Text style={styles.emptyBody}>
                Tap “Start Inspection” to pull a part, log a lot, and start measuring.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => router.push({ pathname: "/inspect/[id]", params: { id: item.sheet.id } })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowPart}>{item.part.partNumber}</Text>
              <Text style={styles.rowMeta}>
                Rev {item.revision.rev} · Lot {item.sheet.lotNumber} · {item.sheet.lotSize} pcs
              </Text>
            </View>
            <Text style={styles.rowChevron}>›</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 12,
  },
  wordmark: { fontSize: 26, fontWeight: "800", color: colors.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  logout: { paddingVertical: 10, paddingHorizontal: 4 },
  logoutLabel: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  ctaWrap: { paddingHorizontal: 20, paddingVertical: 12 },
  cta: { width: "100%" },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  listTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  listContent: { paddingHorizontal: 20, paddingBottom: 32, gap: 10, flexGrow: 1 },
  error: { color: colors.danger, paddingHorizontal: 20, marginBottom: 8, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    paddingHorizontal: 16,
    minHeight: 64,
  },
  rowPressed: { backgroundColor: colors.surfaceRaised },
  rowPart: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  rowMeta: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
  rowChevron: { fontSize: 28, color: colors.textMuted, marginLeft: 8 },
  empty: { alignItems: "center", paddingTop: 48, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  emptyBody: { fontSize: 15, color: colors.textSecondary, textAlign: "center", lineHeight: 22 },
});
