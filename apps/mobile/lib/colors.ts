import type { Disposition } from "@datasheets/core";

/**
 * Shop-floor palette: dark background so it doesn't wash out under harsh
 * fluorescent lighting, with big, saturated status colors that read clearly
 * from arm's length away from the part.
 */
export const colors = {
  background: "#0A0E13",
  surface: "#141B23",
  surfaceRaised: "#1C2530",
  border: "#2A3441",
  borderStrong: "#3D4A59",
  textPrimary: "#F4F7FA",
  textSecondary: "#9FAEBF",
  textMuted: "#657486",
  accent: "#3B9EFF",
  accentText: "#0A0E13",
  danger: "#FF5449",
  overlay: "rgba(5, 8, 12, 0.72)",
} as const;

export interface StatusPalette {
  /** Full-bleed background fill, used for the live measurement card. */
  fill: string;
  /** Muted background, used for list rows / chips. */
  soft: string;
  /** Border / accent color. */
  border: string;
  /** Text color with sufficient contrast against `fill`. */
  onFill: string;
  /** Text color with sufficient contrast against `soft`. */
  onSoft: string;
  label: string;
}

export const statusPalette: Record<Disposition, StatusPalette> = {
  green: {
    fill: "#16A34A",
    soft: "#132B1D",
    border: "#22C55E",
    onFill: "#04140A",
    onSoft: "#4ADE80",
    label: "In spec",
  },
  yellow: {
    fill: "#D97706",
    soft: "#2E2109",
    border: "#F59E0B",
    onFill: "#1A0F00",
    onSoft: "#FBBF24",
    label: "Trending",
  },
  red: {
    fill: "#DC2626",
    soft: "#310C0C",
    border: "#EF4444",
    onFill: "#1A0000",
    onSoft: "#F87171",
    label: "Out of spec",
  },
};

/** Neutral palette for a sample that hasn't been measured yet. */
export const unmeasuredPalette: StatusPalette = {
  fill: colors.surfaceRaised,
  soft: colors.surface,
  border: colors.border,
  onFill: colors.textSecondary,
  onSoft: colors.textMuted,
  label: "Not measured",
};

export function paletteFor(disposition: Disposition | null | undefined): StatusPalette {
  if (!disposition) return unmeasuredPalette;
  return statusPalette[disposition];
}
