import { useState } from "react";

export type PieSlice = {
  id: string;
  label: string;
  /** Any non-negative magnitude; slices are normalised to their sum. */
  value: number;
  color: string;
  /** Pre-formatted amount shown in the legend / tooltip. */
  amount?: string;
  /** Pre-formatted share (e.g. "94.00%"). */
  share?: string;
};

type Props = {
  slices: PieSlice[];
  size?: number;
  /** 0 → solid pie; 0.55 → donut. */
  innerRatio?: number;
  centerLabel?: string;
  centerSub?: string;
};

const TAU = Math.PI * 2;

/** Arc path for `[a0, a1)` radians (clockwise from 12 o'clock) between radii `r0` (inner) and `r1`. */
function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const full = a1 - a0 >= TAU - 1e-6;
  if (full) a1 = a0 + TAU - 1e-4;
  const p = (r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)] as const;
  const [x0, y0] = p(r1, a0);
  const [x1, y1] = p(r1, a1);
  const [x2, y2] = p(r0, a1);
  const [x3, y3] = p(r0, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M ${x0.toFixed(3)} ${y0.toFixed(3)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`,
    `L ${x2.toFixed(3)} ${y2.toFixed(3)}`,
    `A ${r0} ${r0} 0 ${large} 0 ${x3.toFixed(3)} ${y3.toFixed(3)}`,
    "Z",
  ].join(" ");
}

/**
 * Dependency-free SVG pie/donut in the module's terminal palette. Zero-value slices are kept in
 * the legend (e.g. "Dev / team 0%") but draw nothing.
 */
export function PieChart({ slices, size = 200, innerRatio = 0.55, centerLabel, centerSub }: Props) {
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const cx = size / 2;
  const cy = size / 2;
  const r1 = size / 2 - 2;
  const r0 = r1 * innerRatio;
  let angle = 0;
  const paths = slices.map((s) => {
    const frac = total > 0 ? Math.max(0, s.value) / total : 0;
    const a0 = angle;
    const a1 = angle + frac * TAU;
    angle = a1;
    return { s, frac, d: frac > 0 ? arcPath(cx, cy, r0, r1, a0, a1) : null };
  });
  const focus = active ? slices.find((s) => s.id === active) : null;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={slices.map((s) => `${s.label} ${s.share ?? ""}`).join(", ")}
        className="shrink-0"
      >
        {total === 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={(r0 + r1) / 2}
            fill="none"
            stroke="#14532d"
            strokeWidth={r1 - r0}
          />
        )}
        {paths.map(({ s, d }) =>
          d ? (
            <path
              key={s.id}
              d={d}
              fill={s.color}
              fillOpacity={active && active !== s.id ? 0.35 : 0.9}
              stroke="#000"
              strokeWidth={1}
              onMouseEnter={() => setActive(s.id)}
              onMouseLeave={() => setActive(null)}
            >
              <title>{`${s.label}: ${s.amount ?? s.value} (${s.share ?? ""})`}</title>
            </path>
          ) : null,
        )}
        {innerRatio > 0 && (
          <g
            className="pointer-events-none"
            fill="#86efac"
            textAnchor="middle"
            fontFamily="inherit"
          >
            <text x={cx} y={cy - 2} fontSize={size * 0.085}>
              {focus ? (focus.share ?? "") : (centerLabel ?? "")}
            </text>
            <text x={cx} y={cy + size * 0.07} fontSize={size * 0.05} fill="#4ade80">
              {focus ? focus.label : (centerSub ?? "")}
            </text>
          </g>
        )}
      </svg>
      <ul className="min-w-[220px] flex-1 space-y-1 text-xs">
        {paths.map(({ s, frac }) => (
          <li
            key={s.id}
            onMouseEnter={() => setActive(s.id)}
            onMouseLeave={() => setActive(null)}
            className={`flex items-center justify-between gap-3 border-b border-green-500/10 py-1 last:border-0 ${
              active === s.id ? "text-green-100" : "text-green-300"
            }`}
          >
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 border border-black"
                style={{ background: s.color }}
              />
              {s.label}
            </span>
            <span className="text-right">
              <span className="text-green-200">{s.share ?? `${(frac * 100).toFixed(2)}%`}</span>
              {s.amount && <span className="ml-2 text-green-600">{s.amount}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
