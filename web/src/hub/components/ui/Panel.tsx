import { useState, type ReactNode } from "react";

type PanelProps = {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Adds a `[+]`/`[-]` toggle to the header and lets the body collapse/expand. */
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

/** Square-bordered DOS window with a `[ TITLE ]` header bar — 1px border, zero radius, no
 *  drop shadow by default (system-terminal grid, not a UI card). Pass `collapsible` to let the
 *  header toggle the body open/closed (smooth height + opacity transition, CSS-only — see the
 *  grid-template-rows trick below), optionally showing `collapsedSummary` in its place. */
export function Panel({
  title,
  right,
  children,
  className = "",
  collapsible = false,
  defaultCollapsed = false,
  collapsed: collapsedProp,
  onCollapsedChange,
  collapsedSummary,
}: PanelProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const isCollapsed = collapsible && (collapsedProp ?? internalCollapsed);

  const toggle = () => {
    const next = !isCollapsed;
    if (collapsedProp === undefined) setInternalCollapsed(next);
    onCollapsedChange?.(next);
  };

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

/** Thin `Panel` wrapper for call sites written against the old `defaultOpen` API — same
 *  `[+]`/`[-]` header toggle and collapse transition, now backed by `Panel`'s own `collapsible`
 *  machinery instead of a bespoke implementation. */
export function CollapsibleCard({
  defaultOpen = false,
  title,
  right,
  children,
  className,
}: CollapsibleProps) {
  return (
    <Panel
      title={title}
      right={right}
      className={className}
      collapsible
      defaultCollapsed={!defaultOpen}
    >
      {children}
    </Panel>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-none border border-green-500/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-green-600">{label}</div>
      <div className="mt-0.5 text-base text-green-300">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-green-700">{sub}</div>}
    </div>
  );
}

export function Row({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-green-500/10 py-1 text-xs last:border-0">
      <span className="text-green-600">{k}</span>
      <span className="text-right text-green-300">{v}</span>
    </div>
  );
}

export function Flag({ on, label }: { on: boolean; label: string }) {
  const tone = on ? "border-green-500 text-green-300" : "border-green-500/20 text-green-800";
  return (
    <span className={`rounded-none border px-2 py-0.5 text-[10px] tracking-widest ${tone}`}>
      {label}: {on ? "ON" : "OFF"}
    </span>
  );
}
