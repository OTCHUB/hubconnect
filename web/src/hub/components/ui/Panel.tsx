import { useState, type ReactNode } from "react";
import { useUITheme } from "../../ThemeProvider";

type PanelProps = {
  title: ReactNode;
  /** Modern-only accent shown before the title (retro has no room for one — ignored there). */
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Adds a collapse toggle to the header and lets the body collapse/expand. */
  collapsible?: boolean;
  /** Uncontrolled initial state when `collapsible` is set — ignored once `collapsed` is passed. */
  defaultCollapsed?: boolean;
  /** Controlled collapsed state; pairs with `onCollapsedChange`. Omit for uncontrolled (internal
   *  state, seeded by `defaultCollapsed`). */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Shown in place of `children` while collapsed (e.g. a one-line status summary) — WalletPanel's
   *  "Connected · 0x123…abcd" row. Left undefined, the body simply hides with nothing in its
   *  place. Only ever rendered when `collapsible` is true. */
  collapsedSummary?: ReactNode;
};

/**
 * Theme-aware container — the app's one `Panel` primitive, reskinned by the global Retro/Modern
 * toggle (see `ThemeProvider`) instead of being split across two parallel components: "retro"
 * renders the square DOS-terminal window (`[ TITLE ]` header, 1px border, monospace, zero
 * radius); "modern" renders the frosted-glass "new age of internet finance" card (rounded-2xl,
 * backdrop-blur, sans-serif) that used to live only in `GlassPanel.tsx` (Wallet Connect / M.I.M
 * ETF). Both variants share the same collapsible mechanics (CSS-only grid-template-rows + opacity
 * transition), so flipping the theme never changes behavior — only the chrome.
 */
export function Panel({
  title,
  icon,
  right,
  children,
  className = "",
  collapsible = false,
  defaultCollapsed = false,
  collapsed: collapsedProp,
  onCollapsedChange,
  collapsedSummary,
}: PanelProps) {
  const { theme } = useUITheme();
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const isCollapsed = collapsible && (collapsedProp ?? internalCollapsed);

  const toggle = () => {
    const next = !isCollapsed;
    if (collapsedProp === undefined) setInternalCollapsed(next);
    onCollapsedChange?.(next);
  };

  if (theme === "modern") {
    return (
      <section
        className={`rounded-2xl border border-emerald-400/15 bg-white/[0.03] font-sans text-white shadow-[0_0_40px_-24px_rgba(16,185,129,0.5)] backdrop-blur-xl ${className}`}
      >
        <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            {icon && (
              <span className="text-base leading-none" aria-hidden>
                {icon}
              </span>
            )}
            {title}
          </span>
          <span className="flex items-center gap-2 text-xs text-emerald-200/60">
            {right}
            {collapsible && (
              <button
                type="button"
                onClick={toggle}
                aria-expanded={!isCollapsed}
                title={isCollapsed ? "expand" : "collapse"}
                className="grid h-5 w-5 place-items-center rounded-full border border-white/10 text-emerald-200/70 transition hover:border-emerald-400/40 hover:text-emerald-100"
              >
                {isCollapsed ? "+" : "–"}
              </button>
            )}
          </span>
        </header>
        {isCollapsed && collapsedSummary !== undefined && (
          <div className="px-4 pb-4 text-sm sm:px-5">{collapsedSummary}</div>
        )}
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
            isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div
              className={`px-4 pb-4 pt-0 transition-opacity duration-200 sm:px-5 ${
                isCollapsed ? "opacity-0" : "opacity-100"
              }`}
            >
              {children}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`rounded-none border border-green-500/30 bg-black font-mono text-green-400 ${className}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-green-500/30 px-3 py-1.5 text-xs">
        <span className="tracking-widest text-green-300">[ {title} ]</span>
        <span className="flex items-center gap-2">
          {right && <span className="text-green-600">{right}</span>}
          {collapsible && (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={!isCollapsed}
              title={isCollapsed ? "expand" : "collapse"}
              className="text-green-500 hover:text-green-300"
            >
              [{isCollapsed ? "+" : "-"}]
            </button>
          )}
        </span>
      </header>
      {isCollapsed && collapsedSummary !== undefined && (
        <div className="border-b border-green-500/10 px-3 py-2 text-xs">{collapsedSummary}</div>
      )}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div
            className={`p-3 transition-opacity duration-200 ${isCollapsed ? "opacity-0" : "opacity-100"}`}
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

type CollapsibleProps = PanelProps & { defaultOpen?: boolean };

/** Thin `Panel` wrapper for call sites written against the old `defaultOpen` API — same header
 *  toggle and collapse transition, now backed by `Panel`'s own `collapsible` machinery (and thus
 *  themed the same way `Panel` is). */
export function CollapsibleCard({
  defaultOpen = false,
  title,
  icon,
  right,
  children,
  className,
}: CollapsibleProps) {
  return (
    <Panel
      title={title}
      icon={icon}
      right={right}
      className={className}
      collapsible
      defaultCollapsed={!defaultOpen}
    >
      {children}
    </Panel>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
}) {
  const { theme } = useUITheme();
  if (theme === "modern") {
    return (
      <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200/40">
          {label}
        </div>
        <div className="mt-1 text-base font-semibold text-white">{value}</div>
        {sub && <div className="mt-0.5 text-[10px] text-emerald-200/40">{sub}</div>}
      </div>
    );
  }
  return (
    <div className="rounded-none border border-green-500/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-green-600">{label}</div>
      <div className="mt-0.5 text-base text-green-300">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-green-700">{sub}</div>}
    </div>
  );
}

export function Row({ k, v }: { k: ReactNode; v: ReactNode }) {
  const { theme } = useUITheme();
  if (theme === "modern") {
    return (
      <div className="flex justify-between gap-4 border-b border-white/5 py-1.5 text-xs last:border-0">
        <span className="text-emerald-200/50">{k}</span>
        <span className="text-right font-medium text-white/90">{v}</span>
      </div>
    );
  }
  return (
    <div className="flex justify-between gap-4 border-b border-green-500/10 py-1 text-xs last:border-0">
      <span className="text-green-600">{k}</span>
      <span className="text-right text-green-300">{v}</span>
    </div>
  );
}

export function Flag({ on, label }: { on: boolean; label: string }) {
  const { theme } = useUITheme();
  if (theme === "modern") {
    const tone = on
      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
      : "border-white/10 bg-white/[0.02] text-white/30";
    return (
      <span
        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${tone}`}
      >
        {label}: {on ? "ON" : "OFF"}
      </span>
    );
  }
  const tone = on ? "border-green-500 text-green-300" : "border-green-500/20 text-green-800";
  return (
    <span className={`rounded-none border px-2 py-0.5 text-[10px] tracking-widest ${tone}`}>
      {label}: {on ? "ON" : "OFF"}
    </span>
  );
}
