import { useMemo, useRef, useState } from "react";
import type { CurveTrade } from "../../lib/curve";
import { buildCurveCandles, type Candle, type CandleTf } from "../../lib/curveCandles";

type Props = { trades: CurveTrade[]; dec: number; solUsd: number | null };

const TF_IDS: CandleTf[] = ["1M", "5M", "15M", "1H", "ALL"];

/**
 * Finalized $HUB/SOL candlestick chart for the post-graduation reveal — same interactive-viewport
 * candlestick renderer (pinch/wheel zoom, drag pan, hover/tap crosshair) and terminal styling as
 * otchub's own SwapCard price chart (src/components/otc/PriceCandles.jsx), so the "reveal" feels
 * like the same product rather than a bespoke widget. The dataset itself is different: since
 * GeckoTerminal/DexScreener don't index devnet pools, candles are built client-side straight from
 * the curve's own (now-frozen) trade log — see lib/curveCandles.ts.
 */
export function PriceCandles({ trades, dec, solUsd }: Props) {
  const [tf, setTf] = useState<CandleTf>("15M");
  const [unit, setUnit] = useState<"SOL" | "USD">("SOL");
  const [visible, setVisible] = useState<number | null>(null);
  const [offR, setOffR] = useState(0);
  const [inspect, setInspect] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);

  const fmt = (v: number) => (unit === "USD" ? `$${v.toFixed(6)}` : `${v.toFixed(9)} SOL`);

  const candles = useMemo(
    () => buildCurveCandles(trades, dec, tf, unit, solUsd),
    [trades, dec, tf, unit, solUsd],
  );

  const total = candles.length;
  const vis = visible == null ? total : Math.min(Math.max(2, Math.round(visible)), total);
  const maxOff = Math.max(0, total - vis);
  const effOffR = Math.min(Math.max(0, Math.round(offR)), maxOff);
  const start = total - vis - effOffR;
  const view = candles.slice(start, start + vis);

  const zoomBy = (factor: number) => {
    if (total < 2) return;
    const newVis = Math.min(Math.max(2, Math.round(vis * factor)), total);
    setVisible(newVis >= total ? null : newVis);
    setOffR((o) => Math.min(Math.max(0, Math.round(o)), Math.max(0, total - newVis)));
    setInspect(null);
  };
  const resetView = () => {
    setVisible(null);
    setOffR(0);
    setInspect(null);
  };
  const changeTf = (id: CandleTf) => {
    setTf(id);
    resetView();
  };

  const idxAtX = (clientX: number) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(Math.max(0, (clientX - rect.left) / rect.width), 0.999);
  };

  const onMouseMove: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (total < 1) return;
    setInspect(start + Math.floor(idxAtX(e.clientX) * vis));
  };
  const onWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    if (total < 2) return;
    e.preventDefault();
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return;
    const r = Math.min(Math.max(0, (e.clientX - rect.left) / rect.width), 0.999);
    const idx = start + r * vis;
    const factor = e.deltaY > 0 ? 1.25 : 0.8;
    const newVis = Math.min(Math.max(2, Math.round(vis * factor)), total);
    const newOffR = Math.min(
      Math.max(0, Math.round(total - newVis - (idx - r * newVis))),
      Math.max(0, total - newVis),
    );
    setVisible(newVis >= total ? null : newVis);
    setOffR(newOffR);
    setInspect(null);
  };

  // Simple drag-to-pan (mouse only — the chart is a small, mostly-glance widget rather than a
  // primary touch surface, so no multi-touch pinch/pan gesture stack here).
  const dragRef = useRef<{ x: number; startOffR: number } | null>(null);
  const onMouseDown: React.MouseEventHandler<HTMLDivElement> = (e) => {
    dragRef.current = { x: e.clientX, startOffR: effOffR };
  };
  const onMouseMoveOrDrag: React.MouseEventHandler<HTMLDivElement> = (e) => {
    const d = dragRef.current;
    if (!d) return onMouseMove(e);
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return;
    const shift = Math.round(((e.clientX - d.x) / rect.width) * vis);
    setOffR(Math.min(Math.max(0, d.startOffR + shift), Math.max(0, total - vis)));
    setInspect(null);
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const scale = useMemo(() => {
    if (view.length < 2) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of view) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    const pad = Math.max((hi - lo) * 0.1, hi * 0.005);
    lo -= pad;
    hi += pad;
    const span = hi - lo || 1;
    return { lo, hi, y: (p: number) => 100 - ((p - lo) / span) * 100 };
  }, [view]);

  const last = candles[total - 1] || null;
  const up = last ? last.c >= last.o : true;
  const atRightEdge = effOffR === 0;
  const inspectCandle: Candle | null =
    inspect != null && inspect >= start && inspect < start + vis ? candles[inspect] : null;
  const inspectVi = inspectCandle ? inspect! - start : 0;
  const inspectX = ((inspectVi + 0.5) / vis) * 100;

  return (
    <div className="border border-green-500/20">
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-green-500/20 px-2 py-1">
        <span className="text-[11px] uppercase tracking-widest text-green-500/50">
          $HUB :: FINALIZED CURVE
        </span>
        <div className="flex items-center gap-1">
          {TF_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => changeTf(id)}
              className={`border px-1.5 py-0.5 font-mono text-[11px] ${
                tf === id
                  ? "border-emerald-500/60 text-emerald-400"
                  : "border-green-500/30 text-green-500/60 hover:border-emerald-500/40"
              }`}
            >
              [{id}]
            </button>
          ))}
          <button
            type="button"
            onClick={() => zoomBy(1.6)}
            disabled={total < 3 || vis <= 2}
            title="Zoom out (show more candles)"
            className="border border-green-500/30 px-1.5 py-0.5 font-mono text-[11px] text-green-500/60 hover:border-emerald-500/40 disabled:opacity-30"
          >
            [−]
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.6)}
            disabled={total < 3 || vis >= total}
            title="Zoom in (show fewer candles)"
            className="border border-green-500/30 px-1.5 py-0.5 font-mono text-[11px] text-green-500/60 hover:border-emerald-500/40 disabled:opacity-30"
          >
            [+]
          </button>
          <button
            type="button"
            onClick={resetView}
            disabled={visible == null && effOffR === 0}
            title="Fit full history"
            className="border border-green-500/30 px-1.5 py-0.5 font-mono text-[11px] text-green-500/60 hover:border-emerald-500/40 disabled:opacity-30"
          >
            [FIT]
          </button>
          <button
            type="button"
            onClick={() => setUnit((u) => (u === "USD" ? "SOL" : "USD"))}
            disabled={solUsd == null}
            className="border border-cyan-400/40 px-1.5 py-0.5 font-mono text-[11px] text-cyan-300 hover:border-cyan-400/70 disabled:opacity-30"
          >
            {unit === "USD" ? "$USD" : "◎SOL"}
          </button>
        </div>
      </div>

      <div
        ref={plotRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMoveOrDrag}
        onMouseUp={endDrag}
        onMouseLeave={() => {
          endDrag();
          setInspect(null);
        }}
        onWheel={onWheel}
        className="relative h-20 w-full select-none cursor-crosshair sm:h-32"
      >
        {scale && view.length >= 2 ? (
          <>
            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {[25, 50, 75].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2="100"
                  y1={y}
                  y2={y}
                  className="stroke-green-500/10"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {view.map((c, i) => {
                const isUp = c.c >= c.o;
                const x = ((i + 0.5) / vis) * 100;
                const w = Math.max((100 / vis) * 0.6, 0.8);
                const yH = scale.y(c.h);
                const yL = scale.y(c.l);
                const yO = scale.y(c.o);
                const yC = scale.y(c.c);
                return (
                  <g key={c.t}>
                    <line
                      x1={x}
                      x2={x}
                      y1={yH}
                      y2={yL}
                      className={isUp ? "stroke-green-400/80" : "stroke-red-400/70"}
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                    />
                    <rect
                      x={x - w / 2}
                      width={w}
                      y={Math.min(yO, yC)}
                      height={Math.max(0.6, Math.abs(yO - yC))}
                      className={isUp ? "fill-green-400/70" : "fill-red-400/70"}
                    />
                  </g>
                );
              })}
              {atRightEdge && last && (
                <line
                  x1="0"
                  x2="100"
                  y1={scale.y(last.c)}
                  y2={scale.y(last.c)}
                  className={up ? "stroke-green-400/50" : "stroke-red-400/50"}
                  strokeWidth="1"
                  strokeDasharray="2 2"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {inspectCandle && (
                <line
                  x1={inspectX}
                  x2={inspectX}
                  y1="0"
                  y2="100"
                  className="stroke-cyan-400/50"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            <div className="pointer-events-none absolute left-1 top-0.5 font-mono text-[10px] text-green-500/50">
              HI {fmt(scale.hi)}
            </div>
            <div className="pointer-events-none absolute bottom-0.5 left-1 font-mono text-[10px] text-green-500/50">
              LO {fmt(scale.lo)}
            </div>
            {atRightEdge && last && (
              <div
                className={`pointer-events-none absolute right-1 border px-1 font-mono text-[10px] ${
                  up
                    ? "border-green-500/40 bg-black/80 text-green-400"
                    : "border-red-400/40 bg-black/80 text-red-400"
                }`}
                style={{ top: `calc(${Math.min(94, Math.max(0, scale.y(last.c)))}% - 6px)` }}
              >
                {fmt(last.c)}
              </div>
            )}
            {inspectCandle && (
              <div className="pointer-events-none absolute left-1 bottom-4 border border-cyan-400/40 bg-black/90 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-cyan-300">
                <div className="text-green-500/50">
                  {new Date(inspectCandle.t).toLocaleString()}
                </div>
                <div>
                  O {fmt(inspectCandle.o)} · H {fmt(inspectCandle.h)}
                </div>
                <div>
                  L {fmt(inspectCandle.l)} · C {fmt(inspectCandle.c)}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-[11px] text-green-500/40">
            {total === 0 ? "NO TRADE HISTORY ON THIS CURVE" : "NOT ENOUGH CANDLES IN THIS VIEW"}
          </div>
        )}
      </div>

      <div className="hidden border-t border-green-500/10 px-2 py-0.5 font-mono text-[10px] text-green-500/40 sm:block">
        {view.length}/{total} {tf} CANDLE(S) · FINALIZED :: FROZEN AT GRADUATION · WHEEL ZOOM · DRAG
        PAN · HOVER OHLC
      </div>
    </div>
  );
}
