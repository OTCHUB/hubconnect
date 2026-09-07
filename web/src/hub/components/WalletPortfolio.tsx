import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { TIER_NAMES, TIER_WEIGHTS_BP, type ProtocolState } from "@hub-sdk";
import { useWalletPortfolio, type OwnedDesk } from "../hooks/useWalletPortfolio";
import { fmtNum, fmtSol, fmtWeight, shortKey } from "../lib/format";
import { AddressLink } from "./ui/AddressLink";

type Props = { address: string; state: ProtocolState; onClear?: () => void };

/** otchub's portfolio metric tile: label / bold value / sub-line, accent per metric. */
function Metric({
  label,
  value,
  sub,
  accent = "text-green-300",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="border border-green-500/20 p-2">
      <div className="text-[10px] uppercase tracking-widest text-green-500/50">{label}</div>
      <div className={`mt-1 text-sm font-bold ${accent}`}>{value}</div>
      {sub && <div className="text-[10px] text-green-500/50">{sub}</div>}
    </div>
  );
}

function DeskRow({ desk }: { desk: OwnedDesk }) {
  const t = desk.tier;
  const tierLabel = t
    ? t.voided
      ? "VOIDED"
      : `${TIER_NAMES[t.tier - 1] ?? `T${t.tier}`} · ${fmtWeight(TIER_WEIGHTS_BP[t.tier - 1] ?? 0)}`
    : "RAW · not activated";
  const tone = !t ? "text-green-700" : t.voided ? "text-red-400" : "text-cyan-300";
  return (
    <div className="flex items-center justify-between gap-2 border border-green-500/15 px-2 py-1 text-xs">
      <AddressLink address={desk.asset} />
      <span className={tone}>{tierLabel}</span>
      <Link to={`desk/${desk.asset}`} className="text-[10px] text-green-600 hover:text-green-300">
        [DETAIL →]
      </Link>
    </div>
  );
}

/** Read-only wallet view: SOL, $HUB balance, and desks in the configured collection with tier. */
export function WalletPortfolio({ address, state, onClear }: Props) {
  const q = useWalletPortfolio(address, state);
  const data = q.data;
  const activeWeightBp =
    data?.desks.reduce(
      (s, d) => s + (d.tier && !d.tier.voided ? (TIER_WEIGHTS_BP[d.tier.tier - 1] ?? 0) : 0),
      0,
    ) ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-widest text-green-500/70">
          WALLET :: <AddressLink address={address} label={shortKey(address, 6)} />
        </span>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="border border-green-500/30 px-2 py-0.5 text-[10px] text-green-500/60 hover:text-green-400"
          >
            [DISCONNECT]
          </button>
        )}
      </div>

      {q.isPending && (
        <div className="text-xs text-green-500/50">
          <span className="animate-pulse">▋</span> LOADING_PORTFOLIO...
        </div>
      )}
      {q.isError && <div className="text-xs text-amber-400">ERR: {(q.error as Error).message}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="SOL_BALANCE" value={fmtSol(data.solLamports)} accent="text-green-300" />
            <Metric
              label="HUB_BALANCE"
              value={data.hubBalance === null ? "—" : fmtNum(data.hubBalance)}
              sub={data.hubBalance === null ? "no token account" : "$HUB (spl)"}
              accent="text-emerald-400"
            />
            <Metric
              label="DESKS_OWNED"
              value={fmtNum(data.desks.length)}
              sub={`${data.desks.filter((d) => d.tier && !d.tier.voided).length} activated`}
              accent="text-cyan-400"
            />
            <Metric
              label="Σ_WEIGHT"
              value={`${fmtWeight(activeWeightBp)}`}
              sub={
                state.config.totalWeightBp > 0
                  ? `${((activeWeightBp / state.config.totalWeightBp) * 100).toFixed(2)}% of cohort`
                  : "cohort empty"
              }
              accent="text-amber-400"
            />
          </div>

          <div className="border border-green-500/20 p-2">
            <div className="text-[10px] uppercase tracking-widest text-green-500/50">
              DESKS :: {shortKey(state.config.deskCollection)} collection
            </div>
            {data.desks.length === 0 ? (
              <div className="mt-1 text-xs text-green-700">
                no desks from this collection in the wallet.
              </div>
            ) : (
              <div className="mt-1 space-y-1">
                {data.desks.map((d) => (
                  <DeskRow key={d.asset} desk={d} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
