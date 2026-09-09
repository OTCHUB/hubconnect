import { useUITheme } from "../../ThemeProvider";
import { MonitorIcon, SparkleIcon } from "./Icons";

/**
 * Header control for the global Retro/Modern `Panel` theme (see `ThemeProvider`) — one click
 * flips every panel in the dashboard between the square DOS-terminal chrome and the frosted-glass
 * "new age of internet finance" chrome. Mirrors the header's dark/light `ThemeToggle` convention
 * (shows the mode it will switch TO) and, unlike that always-DOS toggle, reskins its own chrome to
 * match whichever theme is currently active so it never looks out of place in either header style.
 */
export function ThemeSwitch() {
  const { theme, toggleTheme } = useUITheme();
  const isModern = theme === "modern";
  const target = isModern ? "retro" : "modern";
  const cls = isModern
    ? "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-emerald-400/25 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-emerald-100 backdrop-blur-xl transition hover:bg-white/10 sm:px-3"
    : "inline-flex items-center gap-1 whitespace-nowrap border border-green-500/50 px-2 py-1 text-[10px] tracking-widest text-green-400 hover:bg-green-500/10 sm:px-2.5";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      role="switch"
      aria-checked={isModern}
      aria-label={`Switch to ${target} UI`}
      title={`Switch to ${target} UI`}
      className={cls}
    >
      {target === "modern" ? (
        <SparkleIcon className="h-3 w-3" />
      ) : (
        <MonitorIcon className="h-3 w-3" />
      )}
      <span className="hidden sm:inline">[{target.toUpperCase()}]</span>
    </button>
  );
}
