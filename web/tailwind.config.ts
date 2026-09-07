import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

// Mirrors otchub's DOS-terminal theme so the hub module renders identically when mounted there.
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"] },
      colors: {
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
