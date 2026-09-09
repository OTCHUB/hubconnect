import { useUITheme } from "../../ThemeProvider";

/**
 * Header control for the global Retro/Modern `Panel` theme (see `ThemeProvider`) — one click
 * flips every panel in the dashboard between the square DOS-terminal chrome and the frosted-glass
 * "new age of internet finance" chrome. Styled to match the header's existing dark/light
 * `ThemeToggle` button (shows the mode it will switch TO) so both toggles read consistently,
 * regardless of which body theme happens to be active right now.
 */
export function ThemeSwitch() {
  const { theme, toggleTheme } = useUITheme();
  const target = theme === "retro" ? "modern" : "retro";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      role="switch"
      aria-checked={theme === "modern"}
      title={`Switch to ${target} UI`}
      className="inline-flex items-center gap-1 whitespace-nowrap border border-green-500/50 px-2 py-1 text-[10px] tracking-widest text-green-400 hover:bg-green-500/10 sm:px-2.5"
    >
      {target === "modern" ? "✨" : "🖥"}
      <span>[{target.toUpperCase()}]</span>
    </button>
  );
}
