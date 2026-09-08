import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { TIER_WEIGHTS_BP, type ProtocolState } from "@hub-sdk";
import { usePayerBalances } from "../hooks/usePayerBalances";
import { useWalletPortfolio, type OwnedDesk } from "../hooks/useWalletPortfolio";
import { MAX_TIER } from "../lib/activate";
import { fmtNum, fmtSol, fmtUnits, fmtWeight, shortKey } from "../lib/format";
import { magicEdenItemUrl } from "../lib/marketplace";
import { baseInputs, distributableLamports, roundsPerDay } from "../lib/yield";
import { AddressLink } from "./ui/AddressLink";
import { TierBadge, TierLadder } from "./ui/TierProgress";

type Props = {
  address: string;
  state: ProtocolState;
  onClear?: () => void;
  /** Jump straight to ACTIVATE_DESK with this desk preselected — wired by WalletPanel. */
  onActivate?: (asset: string) => void;
};

/** $OTC mint decimals; the payer ATA's reported decimals take precedence once loaded. */
const OTC_DECIMALS = 6;

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

function DeskRow({ desk, onActivate }: { desk: OwnedDesk; onActivate?: (asset: string) => void }) {
  const t = desk.tier;
  const voided = !!t?.voided;
  const tier = t && !voided ? t.tier : 0;
  const canAdvance = !voided && tier < MAX_TIER;
  return (
    <div className="border border-green-500/15 p-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {desk.art?.image ? (
          <img
            src={desk.art.image}
            alt={desk.art.name ?? "desk NFT"}
            className="h-7 w-7 shrink-0 border border-green-500/30 bg-black object-cover"
            loading="lazy"
          />
        ) : (
          <span className="inline-block h-7 w-7 shrink-0 border border-green-500/15 bg-black" />
        )}
        <AddressLink address={desk.asset} />
        <TierBadge tier={tier} voided={voided} />
        {tier > 0 && !voided && (
          <span
            className="text-[10px] font-bold text-cyan-400"
            title="yield boost vs T1 TRADER (1.00x)"
          >
            {desk.yieldBoostPct > 0 ? `+${desk.yieldBoostPct}% YIELD BOOST` : "base yield"}
          </span>
        )}
        <span
          className="ml-auto w-20 text-right text-green-400"
          title="claimable rewards — pays out in one claim_yield"
        >
          {fmtSol(desk.pendingLamports, 4)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-0 sm:pl-9">
        <TierLadder tier={tier} voided={voided} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canAdvance && onActivate && (
            <button
              type="button"
              onClick={() => onActivate(desk.asset)}
              className="min-h-[28px] border border-emerald-500/50 px-2 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/10"
            >
              [{tier ? "UPGRADE_TIER" : "HUB_ACTIVATE"} →]
            </button>
          )}
          <a
            href={magicEdenItemUrl(desk.asset)}
            target="_blank"
            rel="noreferrer"
            className="min-h-[28px] px-1 py-1 text-[10px] text-green-600 hover:text-green-300"
            title="view this desk on Magic Eden"
          >
            [ME ↗]
          </a>
          <Link
            to={`desk/${desk.asset}`}
            className="min-h-[28px] px-1 py-1 text-[10px] text-green-600 hover:text-green-300"
          >
            [DETAIL →]
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Read-only wallet view: SOL, $HUB balance, and desks in the configured collection with tier. */
export function WalletPortfolio({ address, state, onClear, onActivate }: Props) {
  const q = useWalletPortfolio(address, state);
  const balances = usePayerBalances(address, state.config.otcMint, state.config.hubMint);
  const data = q.data;
  const activeWeightBp =
    data?.desks.reduce(
      (s, d) => s + (d.tier && !d.tier.voided ? (TIER_WEIGHTS_BP[d.tier.tier - 1] ?? 0) : 0),
      0,
    ) ?? 0;
  const lifetimeEarningsLamports =
    data?.desks.reduce((s, d) => s + (d.tier?.totalClaimedLamports ?? 0), 0) ?? 0;

  // EST_DAILY_YIELD: this wallet's share of Σw against the same round-size + cadence basis as the
  // EARNING PREVIEW calculator (../lib/yield.ts) — an estimate, not a promise.
  const roundInputs = baseInputs(state.currentEpoch, state.config);
  const distributable = distributableLamports(
    roundInputs.roundInflowLamports,
    roundInputs.burnPctBp,
  );
  const perDay = roundsPerDay(state.previousEpoch);
  const estDailyYieldLamports =
    perDay !== null && activeWeightBp > 0 && roundInputs.totalWeightBp > 0
      ? Math.floor((distributable * activeWeightBp) / roundInputs.totalWeightBp) * perDay
      : null;

  const otcDecimals = balances.data?.otcDecimals ?? OTC_DECIMALS;

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
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
            <Metric label="SOL_BALANCE" value={fmtSol(data.solLamports)} accent="text-green-300" />
            <Metric
              label="HUB_BALANCE"
              value={data.hubBalance === null ? "—" : fmtNum(data.hubBalance)}
              sub={data.hubBalance === null ? "no token account" : "$HUB (spl)"}
              accent="text-emerald-400"
            />
            <Metric
              label="OTC_BALANCE"
              value={
                !balances.data
                  ? "…"
                  : balances.data.otcUnits === null
                    ? "—"
                    : fmtUnits(balances.data.otcUnits, otcDecimals)
              }
              sub={
                !balances.data
                  ? "loading…"
                  : balances.data.otcUnits === null
                    ? "no token account"
                    : "$OTC (spl)"
              }
              accent="text-amber-300"
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
            <Metric
              label="LIFETIME_EARNINGS"
              value={fmtSol(lifetimeEarningsLamports, 4)}
              sub="total paid by claim_yield"
              accent="text-green-300"
            />
            <Metric
              label="EST_DAILY_YIELD"
              value={estDailyYieldLamports === null ? "—" : fmtSol(estDailyYieldLamports, 4)}
              sub={
                activeWeightBp === 0
                  ? "no active tiers"
                  : perDay === null
                    ? "no closed round yet"
                    : "estimate — scales with Σw"
              }
              accent="text-cyan-400"
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
                  <DeskRow key={d.asset} desk={d} onActivate={onActivate} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
