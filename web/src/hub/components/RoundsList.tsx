import { useState } from "react";
import { ACC_SCALE, TIER_NAMES, TIER_WEIGHTS_BP, type ConfigView, type EpochView } from "@hub-sdk";
import { fmtDuration, fmtNum, fmtSol, fmtUtc } from "../lib/format";
import { ROUNDS_PAGE_SIZE, useRoundsHistory } from "../hooks/useRoundsHistory";
import { Panel, Row } from "./ui/Panel";

/** One closed round — a thin divider row inside the shared list container (see `RoundsList`),
 *  not its own bordered `Panel`. N rounds cost one outer border + N slim rows instead of N full
 *  boxes, and only one row is expanded at a time (accordion) to keep the list compact. */
function RoundRow({ e, open, onToggle }: { e: EpochView; open: boolean; onToggle: () => void }) {
  const took = e.finalizedTs > e.startTs ? fmtDuration(e.finalizedTs - e.startTs) : "—";
  const perTier = TIER_WEIGHTS_BP.map(
    (w, i) => `${TIER_NAMES[i]} ${fmtSol(Number((e.perWeightScaled * BigInt(w)) / ACC_SCALE), 4)}`,
  ).join(" · ");

  return (
    <div className="px-3 py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left text-xs"
      >
        <span className="tracking-widest text-green-300">ROUND #{fmtNum(e.index)}</span>
        <span className="flex items-center gap-2 text-green-600">
          <span>
            {fmtSol(e.distributedLamports)} · took {took}
          </span>
          <span className="text-green-500/60">{open ? "[-]" : "[+]"}</span>
        </span>
      </button>
      {open && (
        <div className="mt-2">
          <Row k="closed" v={fmtUtc(e.finalizedTs)} />
          <Row k="opened" v={fmtUtc(e.startTs)} />
          <Row k="inflow" v={fmtSol(e.inflowLamports)} />
          <Row k="credited to stakers" v={fmtSol(e.distributedLamports)} />
          <Row k="burn pending" v={fmtSol(e.burnPendingLamports)} />
          <Row k="floor remainder" v={`${fmtNum(e.rolledForwardLamports)} lamports → next round`} />
          <Row k="Σw at close" v={`${fmtNum(e.totalWeightBp)} bp`} />
          <div className="mt-2 text-[10px] text-green-700">paid per desk: {perTier}</div>
        </div>
      )}
    </div>
  );
}

/**
 * §C3 supporting view — every closed round as an expandable list (newest first), paged back
 * `ROUNDS_PAGE_SIZE` at a time so a mature protocol with hundreds of rounds stays cheap to load.
 * Collapsed by default (and only fetched once expanded) so it doesn't flood the dashboard with a
 * wall of round cards on either mobile or desktop — the open-round panel next to it already shows
 * what most visitors need. Rows live in one height-capped, scrollable container so paging further
 * back ("load older") never makes the page itself grow unbounded.
 */
export function RoundsList({ config }: { config: ConfigView }) {
  const [expanded, setExpanded] = useState(false);
  const [count, setCount] = useState(ROUNDS_PAGE_SIZE);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const q = useRoundsHistory(config.currentEpoch, count, expanded);
  const rounds = q.data ?? [];
  const canLoadMore = config.currentEpoch - count > 0;
  const latestClosed = config.currentEpoch - 1;

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
      collapsible
      collapsed={!expanded}
      onCollapsedChange={(c) => setExpanded(!c)}
      collapsedSummary={
        <span className="text-green-700">
          {fmtNum(latestClosed + 1)} closed · latest #{fmtNum(latestClosed)} — tap [+] to browse
        </span>
      }
      right={expanded ? (q.isFetching ? "loading…" : `${fmtNum(rounds.length)} shown`) : undefined}
    >
      {rounds.length === 0 && !q.isPending ? (
        <div className="text-xs text-green-700">none yet — genesis round is still open.</div>
      ) : (
        <div className="max-h-[26rem] divide-y divide-green-500/10 overflow-y-auto rounded-none border border-green-500/20">
          {rounds.map((e, i) => {
            const isOpen = openIndex === null ? i === 0 : openIndex === e.index;
            return (
              <RoundRow
                key={e.index}
                e={e}
                open={isOpen}
                onToggle={() => setOpenIndex(isOpen ? -1 : e.index)}
              />
            );
          })}
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
