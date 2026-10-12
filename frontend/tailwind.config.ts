import type { Config } from "tailwindcss";

/**
 * Palette
 *   #463F3A  dark brand / sidebar / primary text
 *   #F4F3EE  workspace background
 *   #E0AFA0  accent (used sparingly)
 *   #8A817C  secondary text / icons
 *   #BCB8B1  borders / muted UI
 * Tints below are mixes of those five. Semantic ok/warn/bad stay green/amber/red because status meaning needs them.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#463F3A",
          hover: "#38322E",
          50: "#EEEDE8",
          100: "#E5E3DC",
          200: "#BCB8B1",
          300: "#8A817C",
        },
        sidebar: {
          DEFAULT: "#463F3A",
          hover: "#524A44",
          active: "#615852",
          line: "#5C534D",
          text: "#BCB8B1",
        },
        accent: { DEFAULT: "#E0AFA0", 50: "#F9F0EC", 100: "#F3E0D9", 700: "#7D5547" },
        canvas: "#F4F3EE",
        surface: "#FFFFFF",
        ink: "#463F3A",
        muted: "#8A817C",
        line: "#BCB8B1",
        ok: { bg: "#E6F2EA", fg: "#1D6842" },
        warn: { bg: "#FAF0DA", fg: "#86550F" },
        bad: { bg: "#FAE8E5", fg: "#A23B2F" },
        idle: { bg: "#E9E7E1", fg: "#5E5650" },
      },
      fontFamily: {
        sans: [
          "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Inter", "Roboto", "Helvetica Neue", "Arial",
          "sans-serif",
        ],
      },
      fontSize: { "2xs": ["0.6875rem", { lineHeight: "1rem" }] },
      boxShadow: {
        card: "0 1px 2px rgb(70 63 58 / 0.06)",
        pop: "0 8px 28px rgb(70 63 58 / 0.18), 0 2px 6px rgb(70 63 58 / 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
