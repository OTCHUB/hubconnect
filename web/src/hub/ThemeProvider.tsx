import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "hub:uiTheme";

/** "retro" = the original square DOS-terminal `Panel` chrome; "modern" = the frosted-glass
 *  "new age of internet finance" chrome that used to live only on Wallet Connect / M.I.M ETF. */
export type UITheme = "retro" | "modern";

export type ThemeContextValue = {
  theme: UITheme;
  setTheme: (theme: UITheme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const readStored = (): UITheme => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "modern" ? "modern" : "retro";
  } catch {
    return "retro";
  }
};

const writeStored = (theme: UITheme) => {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode */
  }
};

// Stable fallback so `useUITheme()` degrades gracefully (always "retro", the pre-existing DOS
// look) for any host that renders `Panel`/`WalletPanel`/etc. without wrapping
// `<UIThemeProvider>`, instead of throwing like `useHub`/`useWallet` do.
const FALLBACK: ThemeContextValue = {
  theme: "retro",
  setTheme: () => {},
  toggleTheme: () => {},
};

/**
 * Global Retro/Modern UI theme, persisted to `localStorage`. Every `Panel`/`Stat`/`Row`/`Flag`
 * (see `ui/Panel.tsx`) reads this to decide whether to render the square DOS-terminal chrome or
 * the frosted-glass "new age of internet finance" chrome — flip it once here and the whole
 * dashboard (Portfolio, Swap, Claim, Activate, M.I.M ETF, Treasury, ...) restyles together,
 * instead of some panels being permanently stuck on one look (the inconsistency this fixes).
 */
export function UIThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<UITheme>(() => readStored());

  const setTheme = useCallback((next: UITheme) => {
    setThemeState(next);
    writeStored(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: UITheme = prev === "retro" ? "modern" : "retro";
      writeStored(next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useUITheme(): ThemeContextValue {
  return useContext(ThemeContext) ?? FALLBACK;
}
