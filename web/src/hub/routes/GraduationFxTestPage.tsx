import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { HUB_BASE } from "../../config";
import { CurveHeroPanel } from "../components/HubBondingDashboard";
import { GraduationSequence } from "../components/GraduationSequence";
import { ProtocolGate } from "../components/ProtocolGate";
import { fetchCurveState, fetchSolUsdPrice } from "../lib/curve";
import { Panel } from "../components/ui/Panel";

const numInput =
  "w-20 border border-green-500/30 bg-black px-1.5 py-0.5 text-right text-green-200 outline-none focus:border-emerald-400/60";
const btn =
  "border border-emerald-500/60 px-3 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-30";

/**
 * Manual trigger harness for GraduationSequence.tsx — reachable only by direct link
 * (/test/graduation-fx, mounted in App.tsx), not linked from any nav. Rather than a standalone
 * mock graph, this replays the FX directly on top of the *real* `CurveHeroPanel` (the same hero
 * panel HubBondingDashboard renders), fed by the live curve state — so what a dev tunes here is
 * exactly what fires for real off HubBondingDashboard's graduation-detection effect.
 */
export function GraduationFxTestPage() {
  const [playKey, setPlayKey] = useState(0);
  const [blurPx, setBlurPx] = useState(8);
  const [imminentMs, setImminentMs] = useState(1100);
  const [durationMs, setDurationMs] = useState(3400);
  const [done, setDone] = useState(false);

  const curveQuery = useQuery({
    queryKey: ["hub", "curve", "state"],
    queryFn: fetchCurveState,
    refetchInterval: 5_000,
  });
  const solUsdQuery = useQuery({
    queryKey: ["hub", "curve", "sol-usd"],
    queryFn: fetchSolUsdPrice,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const replay = () => {
    setDone(false);
    setPlayKey((k) => k + 1);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-2 font-mono">
      <div className="flex items-center justify-between">
        <Link to={HUB_BASE} className="text-[10px] text-green-600 hover:text-green-300">
          ← dashboard
        </Link>
        <span className="text-[10px] uppercase tracking-widest text-green-600">
          fx harness — /test/graduation-fx
        </span>
      </div>

      <Panel title="GRADUATION FX :: MANUAL TRIGGER">
        <p className="text-xs text-green-400/90">
          Replays the graduation transition HubBondingDashboard fires the instant a curve crosses
          its SOL target — tune blur intensity and phase timing against the live curve below.
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-4 text-[11px]">
          <label className="flex flex-col gap-0.5 text-green-600">
            blur (px)
            <input
              type="number"
              min={0}
              max={24}
              value={blurPx}
              onChange={(e) => setBlurPx(Number(e.target.value))}
              className={numInput}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-green-600">
            imminent phase (ms)
            <input
              type="number"
              min={200}
              step={100}
              value={imminentMs}
              onChange={(e) => setImminentMs(Number(e.target.value))}
              className={numInput}
            />
          </label>
          <label className="flex flex-col gap-0.5 text-green-600">
            total duration (ms)
            <input
              type="number"
              min={500}
              step={100}
              value={durationMs}
              onChange={(e) => setDurationMs(Number(e.target.value))}
              className={numInput}
            />
          </label>
          <button type="button" onClick={replay} className={btn}>
            [▶ TRIGGER]
          </button>
        </div>
        {playKey > 0 && (
          <div className="mt-2 text-[10px] text-green-600">
            run #{playKey} {done ? "— sequence complete" : "— playing…"}
          </div>
        )}
      </Panel>

      <ProtocolGate>
        {(state) => {
          if (curveQuery.isLoading) {
            return <Panel title="OTC LAUNCHER :: BONDING CURVE">loading curve state…</Panel>;
          }
          if (curveQuery.isError || !curveQuery.data) {
            return (
              <Panel title="OTC LAUNCHER :: BONDING CURVE">
                <div className="text-[11px] text-amber-400">
                  ERR: could not reach the curve API —{" "}
                  {curveQuery.error instanceof Error ? curveQuery.error.message : "unknown error"}
                </div>
              </Panel>
            );
          }
          return (
            <GraduationSequence
              key={playKey}
              active={playKey > 0}
              blurPx={blurPx}
              imminentMs={imminentMs}
              durationMs={durationMs}
              onComplete={() => setDone(true)}
            >
              <CurveHeroPanel
                curve={curveQuery.data}
                mint={state.config.hubMint}
                dec={state.supply.decimals}
                solUsd={solUsdQuery.data ?? null}
              />
            </GraduationSequence>
          );
        }}
      </ProtocolGate>
      {playKey === 0 && (
        <div className="text-[10px] text-green-700">idle — click [▶ TRIGGER] above</div>
      )}
    </div>
  );
}
