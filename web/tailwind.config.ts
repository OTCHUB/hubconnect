import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

// Mirrors otchub's DOS-terminal theme (app.otcdesk.dev) so the hub module renders identically
// when mounted there. Palette is CSS-variable driven: `:root` replicates Tailwind's defaults
// (dark), `html.light` swaps the variables to "phosphor paper" — see index.css.
const SHADES = [200, 300, 400, 500, 600, 700, 800, 900] as const;
const scale = (name: string) =>
  Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--c-${name}-${s}) / <alpha-value>)`]));

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { mono: ["var(--font-mono)"] },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        black: "rgb(var(--c-black) / <alpha-value>)",
        green: scale("green"),
        emerald: scale("emerald"),
        cyan: scale("cyan"),
        amber: scale("amber"),
        red: scale("red"),
        fuchsia: scale("fuchsia"),
        slate: scale("slate"),
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
      },
      keyframes: {
        blink: { "0%, 49%": { opacity: "1" }, "50%, 100%": { opacity: "0" } },
      },
      animation: { blink: "blink 1s step-end infinite" },
    },
  },
  plugins: [animate],
} satisfies Config;
