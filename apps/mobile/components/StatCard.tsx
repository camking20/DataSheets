import { StyleSheet, Text, View } from "react-native";
import { colors } from "../lib/colors";

interface StatCardProps {
  label: string;
  value: string;
  emphasis?: boolean;
  tone?: "neutral" | "good" | "bad";
}

const toneColor: Record<NonNullable<StatCardProps["tone"]>, string> = {
  neutral: colors.textPrimary,
  good: "#4ADE80",
  bad: "#F87171",
};

export function StatCard({ label, value, emphasis, tone = "neutral" }: StatCardProps) {
  return (
    <View style={[styles.card, emphasis && styles.cardEmphasis]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: toneColor[tone] }, emphasis && styles.valueEmphasis]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
    gap: 4,
  },
  cardEmphasis: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderStrong,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 20,
    fontWeight: "800",
  },
  valueEmphasis: {
    fontSize: 28,
  },
});
