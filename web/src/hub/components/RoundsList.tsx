import { useState } from "react";
import { ACC_SCALE, TIER_NAMES, TIER_WEIGHTS_BP, type ConfigView, type EpochView } from "@hub-sdk";
import { fmtDuration, fmtNum, fmtSol, fmtUtc } from "../lib/format";
import { ROUNDS_PAGE_SIZE, useRoundsHistory } from "../hooks/useRoundsHistory";
import { CollapsibleCard, Panel, Row } from "./ui/Panel";

/** One closed round — collapsed to a summary line, expands in place to the full breakdown. */
function RoundRow({ e, defaultOpen }: { e: EpochView; defaultOpen: boolean }) {
  const took = e.finalizedTs > e.startTs ? fmtDuration(e.finalizedTs - e.startTs) : "—";
  const perTier = TIER_WEIGHTS_BP.map(
    (w, i) => `${TIER_NAMES[i]} ${fmtSol(Number((e.perWeightScaled * BigInt(w)) / ACC_SCALE), 4)}`,
  ).join(" · ");

  return (
    <CollapsibleCard
      defaultOpen={defaultOpen}
      title={`ROUND #${fmtNum(e.index)}`}
      right={`${fmtSol(e.distributedLamports)} · took ${took}`}
    >
      <Row k="closed" v={fmtUtc(e.finalizedTs)} />
      <Row k="opened" v={fmtUtc(e.startTs)} />
      <Row k="inflow" v={fmtSol(e.inflowLamports)} />
      <Row k="credited to stakers" v={fmtSol(e.distributedLamports)} />
      <Row k="burn pending" v={fmtSol(e.burnPendingLamports)} />
      <Row k="floor remainder" v={`${fmtNum(e.rolledForwardLamports)} lamports → next round`} />
      <Row k="Σw at close" v={`${fmtNum(e.totalWeightBp)} bp`} />
      <div className="mt-2 text-[10px] text-green-700">paid per desk: {perTier}</div>
    </CollapsibleCard>
  );
}

/**
 * §C3 supporting view — every closed round as an expandable list (newest first), paged back
 * `ROUNDS_PAGE_SIZE` at a time so a mature protocol with hundreds of rounds stays cheap to load.
 */
export function RoundsList({ config }: { config: ConfigView }) {
  const [count, setCount] = useState(ROUNDS_PAGE_SIZE);
  const q = useRoundsHistory(config.currentEpoch, count);
  const rounds = q.data ?? [];
  const canLoadMore = config.currentEpoch - count > 0;

  if (config.currentEpoch === 0) {
    return (
      <Panel title="ROUND HISTORY">
        <div className="text-xs text-green-700">none yet — genesis round is still open.</div>
      </Panel>
    );
  }

  return (
    <Panel
      title="ROUND HISTORY"
      right={q.isFetching ? "loading…" : `${fmtNum(rounds.length)} shown`}
    >
      {rounds.length === 0 && !q.isPending ? (
        <div className="text-xs text-green-700">none yet — genesis round is still open.</div>
      ) : (
        <div className="space-y-1.5">
          {rounds.map((e, i) => (
            <RoundRow key={e.index} e={e} defaultOpen={i === 0} />
          ))}
        </div>
      )}
      {canLoadMore && (
        <button
          type="button"
          onClick={() => setCount((c) => c + ROUNDS_PAGE_SIZE)}
          disabled={q.isFetching}
          className="mt-2 w-full border border-green-500/30 py-1 text-[10px] tracking-widest text-green-500 hover:bg-green-500/10 disabled:opacity-40"
        >
          {q.isFetching ? "LOADING…" : "LOAD OLDER ROUNDS ▾"}
        </button>
      )}
    </Panel>
  );
}
