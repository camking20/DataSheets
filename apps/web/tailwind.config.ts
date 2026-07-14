import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        disposition: {
          green: {
            DEFAULT: "#059669",
            bg: "#ecfdf5",
            border: "#a7f3d0",
            text: "#065f46",
          },
          yellow: {
            DEFAULT: "#d97706",
            bg: "#fffbeb",
            border: "#fde68a",
            text: "#92400e",
          },
          red: {
            DEFAULT: "#e11d48",
            bg: "#fff1f2",
            border: "#fecdd3",
            text: "#9f1239",
          },
        },
      },
      boxShadow: {
        panel: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 1px rgb(0 0 0 / 0.03)",
      },
      keyframes: {
        flash: {
          "0%": { transform: "scale(1)" },
          "35%": { transform: "scale(1.03)" },
          "100%": { transform: "scale(1)" },
        },
      },
      animation: {
        flash: "flash 260ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
