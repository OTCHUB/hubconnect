import { useEffect, useState, type CSSProperties } from "react";

type Props = {
  /** Runs the sequence from t=0 on mount. HubBondingDashboard only ever mounts this component
   *  the instant it detects a graduation, so it defaults to true there; GraduationFxTestPage
   *  instead remounts it (via a `key` bump) per trigger and uses `active={false}` for the
   *  pre-trigger idle preview. */
  active?: boolean;
  /** Ms after mount the "GRADUATED" headline fades in; the chart blur + neon trail start at 0. */
  imminentMs?: number;
  /** Total ms before `onComplete` fires — the caller decides what happens after (HubBondingDashboard
   *  unmounts the overlay in favor of the plain GraduatedPanel; the FX has settled by then). */
  durationMs?: number;
  /** Peak background blur, in px, applied to the mini curve chart/grid behind the headline. */
  blurPx?: number;
  symbol?: string;
  onComplete?: () => void;
};

// A stylised x*y=k bonding-curve descent, drawn once and reused for both the static backdrop
// stroke and the neon trail traced on top of it (see index.css's .grad-fx-trail).
const CURVE_PATH_D = "M 8 148 C 60 148, 90 40, 150 22 S 300 8, 392 6";
const GRID_X = [0.2, 0.4, 0.6, 0.8];
const GRID_Y = [0.25, 0.5, 0.75];

/**
 * One-shot cyberpunk "curve -> live AMM pool" transition, dependency-free (CSS keyframes only —
 * see index.css's `grad-fx-*` classes, same pattern as FlywheelDiagram's `.dash-flow`). Renders a
 * blurred mini bonding-curve chart + grid with a traveling neon trail *behind* a sharp, glowing
 * "GRADUATED" headline that never itself blurs — the headline lives in a sibling layer, so the
 * background's `filter: blur()` never touches it. Every animated property is transform/opacity/
 * filter, so it's compositor-friendly and never touches chart data or layout.
 *
 * Manually triggerable at /test/graduation-fx (GraduationFxTestPage.tsx) to tune blur intensity
 * and phase timing; wired for real into HubBondingDashboard.tsx, which mounts this once per
 * session the instant it observes the curve flip from not-graduated to graduated.
 */
export function GraduationSequence({
  active = true,
  imminentMs = 1100,
  durationMs = 3400,
  blurPx = 8,
  symbol = "$HUB",
  onComplete,
}: Props) {
  const [graduatedPhase, setGraduatedPhase] = useState(false);

  useEffect(() => {
    setGraduatedPhase(false);
    if (!active) return;
    const t1 = setTimeout(() => setGraduatedPhase(true), imminentMs);
    const t2 = setTimeout(() => onComplete?.(), durationMs);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, imminentMs, durationMs]);

  const style = { "--grad-blur": `${blurPx}px` } as CSSProperties;

  return (
    <div className="relative overflow-hidden border border-emerald-400/40 bg-black" style={style}>
      {/* backdrop: mini bonding-curve chart + grid lines — the only layer that ever blurs */}
      <div className={`absolute inset-0 ${active ? "grad-fx-blur" : ""}`}>
        <svg viewBox="0 0 400 160" preserveAspectRatio="none" className="h-full w-full">
          {GRID_Y.map((f) => (
            <line
              key={`y${f}`}
              x1={0}
              x2={400}
              y1={f * 160}
              y2={f * 160}
              stroke="#0a3a1a"
              strokeDasharray="2 4"
            />
          ))}
          {GRID_X.map((f) => (
            <line
              key={`x${f}`}
              x1={f * 400}
              x2={f * 400}
              y1={0}
              y2={160}
              stroke="#0a3a1a"
              strokeDasharray="2 4"
            />
          ))}
          <path
            d={CURVE_PATH_D}
            fill="none"
            stroke="#16a34a"
            strokeOpacity={0.55}
            strokeWidth={2}
          />
          {active && (
            <path
              d={CURVE_PATH_D}
              fill="none"
              stroke="#4ade80"
              strokeWidth={3}
              strokeLinecap="round"
              className="grad-fx-trail"
            />
          )}
        </svg>
      </div>

      {/* neon scanline sweep, screen-blended over the blurred backdrop */}
      {active && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="grad-fx-scanline absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent mix-blend-screen" />
        </div>
      )}

      {/* sharp foreground — sibling of the blurred layer, so it's never affected by that filter */}
      <div className="relative z-10 flex flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
        <div
          className={`text-[11px] font-bold tracking-[0.3em] text-cyan-300 transition-opacity duration-300 ${
            active && !graduatedPhase ? "grad-fx-glitch opacity-100" : "opacity-0"
          }`}
        >
          HUB_PROTOCOL IS IMMINENT
        </div>
        <div
          className={`text-3xl font-black tracking-[0.15em] text-emerald-300 sm:text-4xl ${
            graduatedPhase ? "grad-fx-in grad-fx-headline" : "opacity-0"
          }`}
        >
          GRADUATED
        </div>
        <div
          className={`text-[10px] text-green-500 transition-opacity duration-500 ${
            graduatedPhase ? "opacity-100" : "opacity-0"
          }`}
        >
          {symbol} curve → live AMM pool
        </div>
      </div>
    </div>
  );
}
