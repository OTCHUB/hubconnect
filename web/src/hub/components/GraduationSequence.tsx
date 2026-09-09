import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

type Props = {
  /** The real dashboard content to blur behind the headline — HubBondingDashboard passes a
   *  frozen `CurveHeroPanel` snapshot of the curve at the moment it graduated, and
   *  GraduationFxTestPage passes the live one, so the FX is always an extension of the actual
   *  bonding-curve UI rather than a standalone illustration. */
  children: ReactNode;
  /** Runs the sequence from t=0 on mount. HubBondingDashboard only ever mounts this component
   *  the instant it detects a graduation, so it defaults to true there; GraduationFxTestPage
   *  instead remounts it (via a `key` bump) per trigger and uses `active={false}` for the
   *  pre-trigger idle preview (children render plain, unblurred). */
  active?: boolean;
  /** Ms after mount the "GRADUATED" headline fades in; the backdrop blur starts at 0. */
  imminentMs?: number;
  /** Total ms before `onComplete` fires — the caller decides what happens after (HubBondingDashboard
   *  unmounts the overlay in favor of the plain GraduatedPanel; the FX has settled by then). */
  durationMs?: number;
  /** Peak background blur, in px, applied to the children behind the headline. */
  blurPx?: number;
  symbol?: string;
  onComplete?: () => void;
};

/**
 * One-shot cyberpunk "curve -> live AMM pool" transition, dependency-free (CSS keyframes only —
 * see index.css's `grad-fx-*` classes, same pattern as FlywheelDiagram's `.dash-flow`). Blurs the
 * real `children` (the dashboard's own `CurveHeroPanel`) *behind* a sharp, glowing "GRADUATED"
 * headline that never itself blurs — the headline lives in a sibling layer, so the backdrop's
 * `filter: blur()` never touches it. Every animated property is transform/opacity/filter, so it's
 * compositor-friendly and never touches the underlying panel's data or layout.
 *
 * Manually triggerable at /test/graduation-fx (GraduationFxTestPage.tsx) to tune blur intensity
 * and phase timing against the live curve; wired for real into HubBondingDashboard.tsx, which
 * mounts this once per session the instant it observes the curve flip from not-graduated to
 * graduated.
 */
export function GraduationSequence({
  children,
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
    <div className="relative overflow-hidden" style={style}>
      {/* backdrop: the real curve UI (CurveHeroPanel) passed in as children — the only layer
          that ever blurs; sized by its own natural content height, not forced full-bleed. */}
      <div className={active ? "grad-fx-blur" : ""}>{children}</div>

      {active && (
        <>
          {/* neon scanline sweep, screen-blended over the blurred backdrop */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="grad-fx-scanline absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent mix-blend-screen" />
          </div>

          {/* sharp foreground overlay — sibling of the blurred layer, so it's never affected by
              that filter — centered over whatever height the backdrop panel occupies. */}
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-black/40 px-4 text-center">
            <div
              className={`text-[11px] font-bold tracking-[0.3em] text-cyan-300 transition-opacity duration-300 ${
                !graduatedPhase ? "grad-fx-glitch opacity-100" : "opacity-0"
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
        </>
      )}
    </div>
  );
}
