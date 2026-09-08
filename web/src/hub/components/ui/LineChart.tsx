import { useMemo, useState } from "react";

export type LineSeries = {
  id: string;
  label: string;
  color: string;
  /** Aligned 1:1 with the chart's `labels`; `null` renders a gap (dashed segments never guess). */
  points: (number | null)[];
  /** Two independent y-scales, like otchub's supply/desks dual-axis charts. */
  axis?: "left" | "right";
  format?: (v: number) => string;
};

type Props = {
  labels: string[];
  series: LineSeries[];
  height?: number;
  className?: string;
};

const fmtDefault = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

function domainFor(points: (number | null)[]) {
  const vals = points.filter((v): v is number => v != null);
  if (!vals.length) return { min: 0, max: 1 };
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) {
    min -= Math.abs(min) * 0.1 || 1;
    max += Math.abs(max) * 0.1 || 1;
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

/** Dependency-free SVG multi-series line chart, styled to match the module's terminal palette
 *  (see `PieChart.tsx`) — no recharts, no runtime deps. */
export function LineChart({ labels, series, height = 180, className = "" }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 600;
  const padL = 8;
  const padR = 8;
  const padT = 8;
  const padB = 18;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const n = labels.length;

  const domains = useMemo(() => {
    const left = domainFor(
      series.filter((s) => (s.axis ?? "left") === "left").flatMap((s) => s.points),
    );
    const right = domainFor(series.filter((s) => s.axis === "right").flatMap((s) => s.points));
    return { left, right };
  }, [series]);

  const x = (i: number) => (n <= 1 ? padL : padL + (i / (n - 1)) * plotW);
  const y = (v: number, axis: "left" | "right") => {
    const { min, max } = domains[axis];
    const t = max === min ? 0.5 : (v - min) / (max - min);
    return padT + (1 - t) * plotH;
  };

  const paths = series.map((s) => {
    const axis = s.axis ?? "left";
    const segments: string[] = [];
    let open = false;
    s.points.forEach((v, i) => {
      if (v == null) {
        open = false;
        return;
      }
      const cmd = `${open ? "L" : "M"} ${x(i).toFixed(2)} ${y(v, axis).toFixed(2)}`;
      segments.push(cmd);
      open = true;
    });
    return { s, d: segments.join(" ") };
  });

  if (n === 0 || !series.some((s) => s.points.some((v) => v != null))) {
    return (
      <div
        className={`flex items-center justify-center text-xs text-green-700 ${className}`}
        style={{ height }}
      >
        no history yet
      </div>
    );
  }

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - rect.left) / rect.width) * width;
          const idx = Math.round(((rel - padL) / plotW) * (n - 1));
          setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
        }}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={padL}
            x2={width - padR}
            y1={padT + f * plotH}
            y2={padT + f * plotH}
            stroke="#0a3a1a"
            strokeDasharray="2 4"
          />
        ))}
        {paths.map(({ s, d }) =>
          d ? <path key={s.id} d={d} fill="none" stroke={s.color} strokeWidth={1.5} /> : null,
        )}
        {hoverIdx != null && (
          <line
            x1={x(hoverIdx)}
            x2={x(hoverIdx)}
            y1={padT}
            y2={padT + plotH}
            stroke="#4ade80"
            strokeOpacity={0.35}
          />
        )}
      </svg>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px]">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {series.map((s) => (
            <span key={s.id} className="flex items-center gap-1" style={{ color: s.color }}>
              <span className="inline-block h-2 w-2" style={{ background: s.color }} />
              {s.label}
              {hoverIdx != null && s.points[hoverIdx] != null
                ? ` · ${(s.format ?? fmtDefault)(s.points[hoverIdx]!)}`
                : ""}
            </span>
          ))}
        </div>
        <span className="text-green-700">
          {hoverIdx != null ? labels[hoverIdx] : `${labels[0]} → ${labels[n - 1]}`}
        </span>
      </div>
    </div>
  );
}
