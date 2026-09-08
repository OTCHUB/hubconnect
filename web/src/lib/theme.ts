// App-wide terminal theme: dark (green-on-black) by default, light (dark-green-on-paper)
// opt-in. Ported 1:1 from otchub/src/lib/theme.js so both shells share one identity. The class
// lives on <html>; Tailwind color utilities are CSS-variable driven (see index.css /
// tailwind.config.ts), so toggling the class swaps the whole palette with no component changes.
const KEY = "otc_theme";

export type Theme = "light" | "dark";

export function getStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("light", theme === "light");
}

// Run once at startup (main.tsx) so the class exists before first paint.
export function initTheme() {
  applyTheme(getStoredTheme());
}

export function toggleTheme(): Theme {
  const next: Theme = getStoredTheme() === "light" ? "dark" : "light";
  applyTheme(next);
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    /* storage unavailable — theme lasts for this session only */
  }
  return next;
}
