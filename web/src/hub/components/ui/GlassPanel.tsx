import { useState, type ReactNode } from "react";

type GlassPanelProps = {
  title: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Adds a `+`/`–` toggle to the header and lets the body collapse/expand. */
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Shown in place of `children` while collapsed. Only rendered when `collapsible` is true. */
  collapsedSummary?: ReactNode;
};

/** Frosted-glass counterpart to `ui/Panel.tsx` — reserved for the two surfaces explicitly designed
 *  around a "new age of internet finance" feel (Wallet Connect, the M.I.M ETF basket) rather than
 *  the square DOS-terminal look used everywhere else in the app: soft rounded corners, a
 *  translucent blurred surface, sans-serif type, high-contrast white/emerald-on-black. Reuses the
 *  same collapsible mechanics as `Panel` (grid-template-rows + opacity transition) so behavior
 *  stays identical across both looks — only the chrome changed. */
export function GlassPanel({
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
}: GlassPanelProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const isCollapsed = collapsible && (collapsedProp ?? internalCollapsed);

  const toggle = () => {
    const next = !isCollapsed;
    if (collapsedProp === undefined) setInternalCollapsed(next);
    onCollapsedChange?.(next);
  };

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

export function GlassStat({
  label,
  value,
  sub,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
}) {
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

export function GlassRow({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/5 py-1.5 text-xs last:border-0">
      <span className="text-emerald-200/50">{k}</span>
      <span className="text-right font-medium text-white/90">{v}</span>
    </div>
  );
}
