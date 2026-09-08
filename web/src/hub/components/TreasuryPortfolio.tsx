import { Link } from "react-router-dom";
import { TIER_NAMES, TIER_WEIGHTS_BP, type ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { useTreasuryPortfolio, type TreasuryDesk } from "../hooks/useTreasuryPortfolio";
import { fmtHub, fmtNum, fmtSol, fmtTokens, fmtWeight, shortKey } from "../lib/format";
import { magicEdenItemUrl } from "../lib/marketplace";
import { AddressLink } from "./ui/AddressLink";
import { Panel, Stat } from "./ui/Panel";

function DeskRow({ desk }: { desk: TreasuryDesk }) {
  const t = desk.tier;
  const label = t
    ? t.voided
      ? "VOIDED"
      : `${TIER_NAMES[t.tier - 1] ?? `T${t.tier}`} · ${fmtWeight(TIER_WEIGHTS_BP[t.tier - 1] ?? 0)}`
    : "RAW";
  const tone = !t ? "text-green-700" : t.voided ? "text-red-400" : "text-cyan-300";
  return (
    <div className="flex items-center gap-2 border-b border-green-500/10 px-2 py-1 text-xs last:border-0">
      <AddressLink address={desk.asset} />
      <span className={`flex-1 ${tone}`}>{label}</span>
      <span className="w-24 text-right text-green-400">{fmtSol(desk.pendingLamports, 4)}</span>
      <a
        href={magicEdenItemUrl(desk.asset)}
        target="_blank"
        rel="noreferrer"
        className="text-[10px] text-green-600 hover:text-green-300"
        title="view on Magic Eden"
      >
        [ME ↗]
      </a>
      <Link
        to={`../desk/${desk.asset}`}
        className="text-[10px] text-green-600 hover:text-green-300"
      >
        [DETAIL →]
      </Link>
    </div>
  );
}

/** §C6 showcase: desks the treasury bought on secondary, its balances, and what they earn. */
export function TreasuryPortfolio({ state }: { state: ProtocolState }) {
  const { marketplaceCollectionUrl } = useHub();
  const q = useTreasuryPortfolio(state);
  const d = q.data;
  const dec = state.supply.decimals;
  const activated = d?.desks.filter((x) => x.tier && !x.tier.voided).length ?? 0;

  return (
    <Panel
      title="TREASURY_PORTFOLIO :: DESK HOLDINGS"
      right={
        <a
          href={marketplaceCollectionUrl}
          target="_blank"
          rel="noreferrer"
          className="text-cyan-400 hover:text-cyan-200"
        >
          [MAGIC EDEN COLLECTION ↗]
        </a>
      }
    >
      {q.isPending && (
        <div className="text-xs text-green-500/50">
          <span className="animate-pulse">▋</span> LOADING_TREASURY...
        </div>
      )}
      {q.isError && <div className="text-xs text-amber-400">ERR: {(q.error as Error).message}</div>}
      {d && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="SOL" value={fmtSol(d.solLamports)} sub="multisig wallet" />
            <Stat
              label="$HUB"
              value={fmtHub(d.hubUnits, dec)}
              sub={`${fmtTokens(d.hubUnits, dec)} · locked, not circulating`}
            />
            <Stat
              label="OTC"
              value={d.otcUnits === null ? "—" : fmtTokens(d.otcUnits, d.otcDecimals ?? 0)}
              sub={d.otcUnits === null ? "no token account" : "OTC (spl)"}
            />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Stat
              label="lifetime earnings"
              value={<span className="text-emerald-300">{fmtSol(d.lifetimeEarningsLamports)}</span>}
              sub="Σ claimed + Σ pending"
            />
            <Stat
              label="earnings / day"
              value={
                d.earningsPerDayLamports === null ? "—" : `~${fmtSol(d.earningsPerDayLamports)}`
              }
              sub={
                d.roundsPerDay === null
                  ? "no closed round yet"
                  : `est. · ${d.roundsPerDay.toFixed(2)} rounds/day`
              }
            />
            <Stat
              label="earn to claim"
              value={<span className="text-amber-300">{fmtSol(d.earnToClaimLamports)}</span>}
              sub="claim_yield pays this now"
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-green-500/50">
            <span>
              {fmtNum(d.desks.length)} desk(s) · {fmtNum(activated)} activated ·{" "}
              {shortKey(state.config.deskCollection)} collection
            </span>
            <span>
              multisig <AddressLink address={d.treasury} /> · vault{" "}
              <AddressLink address={d.vault} />
            </span>
          </div>
          {d.desks.length === 0 ? (
            <div className="mt-1 text-xs text-green-700">
              treasury holds no desks yet — sweeps buy the floor when the ops slice allows.
            </div>
          ) : (
            <div className="mt-1 max-h-64 overflow-y-auto border border-green-500/20">
              {d.desks.map((x) => (
                <DeskRow key={x.asset} desk={x} />
              ))}
            </div>
          )}
          <div className="mt-2 text-[10px] text-green-700">
            Desks bought on Magic Eden by the multisig. Per-day is an estimate from the last
            closed round's cadence.
          </div>
        </>
      )}
    </Panel>
  );
}
