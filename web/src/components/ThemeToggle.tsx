import { useState } from "react";
import { getStoredTheme, toggleTheme, type Theme } from "../lib/theme";
import { useUITheme } from "../hub";
import { MoonIcon, SunIcon } from "../hub/components/ui/Icons";

// Header theme switch: dark terminal by default, light "phosphor paper" mode. Ported from
// otchub/src/components/otc/ThemeToggle.jsx. Icon-only (no text label) — shows the glyph for the
// mode it will switch TO — and reads the retro/modern UI theme so its chrome (square outline vs.
// translucent circular pill) matches every other header control (see `Header.tsx`'s
// `pillLinkCls`/`navLinkCls`) instead of staying permanently DOS-styled.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme());
  const { theme: uiTheme } = useUITheme();
  const isModern = uiTheme === "modern";
  const cls = isModern
    ? "inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
    : "inline-flex h-7 w-7 items-center justify-center rounded-none border border-green-500/50 text-green-400 hover:bg-green-500/10";
  return (
    <button
      type="button"
      onClick={() => setTheme(toggleTheme())}
      className={cls}
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
