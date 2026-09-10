import { useState } from "react";
import { getStoredTheme, toggleTheme, type Theme } from "../lib/theme";
import { MoonIcon, SunIcon } from "../hub/components/ui/Icons";

// Header theme switch: dark terminal by default, light "phosphor paper" mode. Ported from
// otchub/src/components/otc/ThemeToggle.jsx. Icon-only (no text label) — shows the glyph for the
// mode it will switch TO.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme());
  return (
    <button
      type="button"
      onClick={() => setTheme(toggleTheme())}
      className="inline-flex h-7 w-7 items-center justify-center rounded-none border border-green-500/50 text-green-400 hover:bg-green-500/10"
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
    >
      {theme === "light" ? (
        <MoonIcon className="h-3.5 w-3.5" />
      ) : (
        <SunIcon className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
