import { Pressable, StyleSheet, Text } from "react-native";
import { colors, paletteFor } from "../lib/colors";
import type { Disposition } from "@datasheets/core";

interface ChipProps {
  label: string;
  active?: boolean;
  disposition?: Disposition | null;
  onPress?: () => void;
  disabled?: boolean;
}

/** Small pill used for dimension tabs and sample navigation. */
export function Chip({ label, active, disposition, onPress, disabled }: ChipProps) {
  const palette = disposition !== undefined ? paletteFor(disposition) : null;
  const backgroundColor = palette ? (active ? palette.fill : palette.soft) : active ? colors.accent : colors.surfaceRaised;
  const textColor = palette ? (active ? palette.onFill : palette.onSoft) : active ? colors.accentText : colors.textSecondary;
  const borderColor = palette ? palette.border : active ? colors.accent : colors.border;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      style={[styles.chip, { backgroundColor, borderColor, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={[styles.label, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 44,
    minWidth: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
  },
});
