import { useState } from "react";
import { getStoredTheme, toggleTheme, type Theme } from "../lib/theme";

// Header theme switch: dark terminal by default, light "phosphor paper" mode. Ported from
// otchub/src/components/otc/ThemeToggle.jsx — shows the mode it will switch TO, matching the
// header's [LABEL ↗] button style (text-only glyphs here to avoid a new icon dependency).
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme());
  return (
    <button
      type="button"
      onClick={() => setTheme(toggleTheme())}
      className="inline-flex items-center gap-1 whitespace-nowrap border border-green-500/50 px-2 py-1 text-[10px] tracking-widest text-green-400 hover:bg-green-500/10 sm:px-2.5"
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      {theme === "light" ? "☾" : "☀"}
      <span>[{theme === "light" ? "DARK" : "LIGHT"}]</span>
    </button>
  );
}
