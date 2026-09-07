import { useState, type ReactNode } from "react";

type PanelProps = {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Square-bordered DOS window with a `[ TITLE ]` header bar. */
export function Panel({ title, right, children, className = "" }: PanelProps) {
  return (
    <section
      className={`border border-green-500/30 bg-black font-mono text-green-400 ${className}`}
    >
      <header className="flex items-center justify-between border-b border-green-500/30 px-3 py-1.5 text-xs">
        <span className="tracking-widest text-green-300">[ {title} ]</span>
        {right && <span className="text-green-600">{right}</span>}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

type CollapsibleProps = PanelProps & { defaultOpen?: boolean };

export function CollapsibleCard({
  defaultOpen = false,
  title,
  right,
  children,
  className,
}: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Panel
      title={title}
      className={className}
      right={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-green-500 hover:text-green-300"
          aria-expanded={open}
        >
          {right} [{open ? "-" : "+"}]
        </button>
      }
    >
      {open ? (
        children
      ) : (
        <div className="text-xs text-green-700">collapsed — click [+] to expand</div>
      )}
    </Panel>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="border border-green-500/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-green-600">{label}</div>
      <div className="mt-0.5 text-base text-green-300">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-green-700">{sub}</div>}
    </div>
  );
}

export function Row({ k, v }: { k: string; v: ReactNode }) {
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
    <span className={`border px-2 py-0.5 text-[10px] tracking-widest ${tone}`}>
      {label}: {on ? "ON" : "OFF"}
    </span>
  );
}
