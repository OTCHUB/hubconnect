import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BPS, TIER_NAMES, pendingYieldLamports, splitFee, type ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { useOtcPay } from "../hooks/useOtcPay";
import { usePayerBalances } from "../hooks/usePayerBalances";
import type { OwnedDesk } from "../hooks/useWalletPortfolio";
import {
  MAX_TIER,
  executeTierChange,
  quoteTierChange,
  type PayMethod,
  type TierChangePhase,
  type TierQuote,
} from "../lib/activate";
import { fmtSol, fmtUnits, shortKey } from "../lib/format";
import type { TxLog } from "../lib/swap";
import { Panel } from "./ui/Panel";
import { TxLogView } from "./ui/TxLogView";

type Props = { address: string; state: ProtocolState; desks: OwnedDesk[]; onChanged?: () => void };

const btn = "border px-2.5 py-1 text-[12px] disabled:opacity-30";
const TIERS = [1, 2, 3, 4] as const;
/** $OTC mint decimals; the payer ATA's reported decimals take precedence once loaded. */
const OTC_DECIMALS = 6;

const currentTier = (d: OwnedDesk) => (d.tier && !d.tier.voided ? d.tier.tier : 0);

/** ACTIVATE_DESK — `activate_tier` / `upgrade_tier` paid in SOL, or the $OTC path at the premium. */
export function ActivatePanel({ address, state, desks, onChanged }: Props) {
  const { connection, program, resolveSigner } = useHub();
  const qc = useQueryClient();
  const otcPayQ = useOtcPay();
  const balances = usePayerBalances(address, state.config.otcMint);
  const [asset, setAsset] = useState<string | null>(null);
  const [toTier, setToTier] = useState(1);
  const [method, setMethod] = useState<PayMethod>("sol");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<TierChangePhase | null>(null);
  const [logs, setLogs] = useState<TxLog[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const otcPay = otcPayQ.data ?? null;
  const rows = desks.filter((d) => currentTier(d) < MAX_TIER);
  const desk = rows.find((d) => d.asset === asset) ?? rows[0] ?? null;
  const fromTier = desk ? currentTier(desk) : 0;
  const pending =
    desk?.tier && !desk.tier.voided ? pendingYieldLamports(desk.tier, state.config) : 0;
  const signer = resolveSigner(address);
  const otcDecimals = balances.data?.otcDecimals ?? OTC_DECIMALS;

  useEffect(() => {
    if (toTier <= fromTier) setToTier(Math.min(fromTier + 1, MAX_TIER));
  }, [fromTier, toTier]);

  const quote: TierQuote | null =
    desk && toTier > fromTier && toTier <= MAX_TIER
      ? quoteTierChange({ config: state.config, otcPay, fromTier, toTier })
      : null;
  const hasQuote = quote !== null;
  const otcAvailable = quote?.otcAvailable ?? false;

  // $OTC can flip to unavailable mid-session (rate goes stale / path disabled): fall back to SOL.
  useEffect(() => {
    if (method === "otc" && hasQuote && !otcAvailable) setMethod("sol");
  }, [method, hasQuote, otcAvailable]);

  const split = quote ? splitFee(quote.solLamports) : null;
  const otcBal = balances.data?.otcUnits ?? null;
  const otcShort =
    method === "otc" && quote?.otcUnits != null && otcBal !== null && otcBal < quote.otcUnits;
  const solShort =
    method === "sol" && quote && balances.data
      ? balances.data.solLamports < BigInt(quote.solLamports)
      : false;

  const run = async () => {
    setErr(null);
    if (!signer) return setErr("read-only address — connect the wallet itself to sign");
    if (!desk || !quote) return setErr("pick a desk and a target tier above its current tier");
    if (method === "otc" && !quote.otcAvailable)
      return setErr(`$OTC payment unavailable: ${quote.otcUnavailableReason}`);
    setBusy(true);
    setLogs([]);
    const res = await executeTierChange({
      connection,
      program,
      signer,
      deskAsset: desk.asset,
      fromTier,
      toTier,
      method,
      config: state.config,
      otcPay,
      pendingLamports: pending,
      onLog: (l) => setLogs((p) => [...p, l]),
      onPhase: setPhase,
    });
    setBusy(false);
    setPhase(null);
    if (res.ok) {
      // Tier + stamps moved on-chain: refresh protocol + wallet reads.
      await qc.invalidateQueries({ queryKey: ["hub"] });
      onChanged?.();
    }
  };

  const premium = quote ? (quote.premiumBp / BPS).toFixed(2) : null;
  const otcTone = otcAvailable ? "text-green-300" : "text-green-800";
  const verb = fromTier ? "UPGRADE" : "ACTIVATE";
  const ticker = method === "sol" ? "SOL" : "$OTC";
  const runLabel = busy
    ? `${(phase ?? "prep").toUpperCase()}…`
    : `[${verb} → T${toTier} ${ticker}]`;
  const collected = otcPay ? fmtUnits(otcPay.totalOtcCollectedUnits, otcDecimals) : null;

  return (
    <Panel
      title="ACTIVATE_DESK :: SOL | $OTC"
      right={collected === null ? "SOL ONLY" : `$OTC collected for POL: ${collected} OTC`}
    >
      {rows.length === 0 ? (
        <div className="text-xs text-green-700">
          {desks.length
            ? "every desk in this wallet is already T4 MARKET MAKER."
            : "no desks in this wallet — buy a desk to activate it."}
        </div>
      ) : (
        <>
          <div className="text-[10px] uppercase tracking-widest text-green-600">desk</div>
          <div className="mt-1 max-h-32 overflow-y-auto border border-green-500/20">
            {rows.map((d) => {
              const t = currentTier(d);
              const on = d.asset === desk?.asset;
              return (
                <button
                  key={d.asset}
                  type="button"
                  disabled={busy}
                  onClick={() => setAsset(d.asset)}
                  className={`flex w-full items-center justify-between border-b border-green-500/10 px-2 py-1.5 text-left text-xs last:border-0 ${
                    on ? "bg-emerald-500/10" : "hover:bg-green-500/5"
                  }`}
                >
                  <span className="text-green-300">{shortKey(d.asset, 6)}</span>
                  <span className={t ? "text-cyan-300" : "text-green-700"}>
                    {t ? `T${t} ${TIER_NAMES[t - 1]}` : "NOT ACTIVATED"}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {desk && (
        <>
          <div className="mt-2 text-[10px] uppercase tracking-widest text-green-600">
            target tier {fromTier ? `(current T${fromTier})` : "(fresh activation)"}
          </div>
          <div className="mt-1 grid grid-cols-4 gap-1">
            {TIERS.map((t) => (
              <button
                key={t}
                type="button"
                disabled={busy || t <= fromTier}
                onClick={() => setToTier(t)}
                className={`border py-1 text-[11px] disabled:opacity-30 ${
                  toTier === t
                    ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                    : "border-green-500/30 text-green-500/60"
                }`}
              >
                T{t} {TIER_NAMES[t - 1]}
              </button>
            ))}
          </div>

          <div className="mt-2 text-[10px] uppercase tracking-widest text-green-600">pay with</div>
          <div className="mt-1 flex gap-1">
            {(["sol", "otc"] as PayMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                disabled={busy || (m === "otc" && !otcAvailable)}
                onClick={() => setMethod(m)}
                className={`flex-1 border py-1 text-[12px] font-bold disabled:opacity-30 ${
                  method === m
                    ? m === "sol"
                      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                      : "border-amber-400/60 bg-amber-500/10 text-amber-300"
                    : "border-green-500/30 text-green-500/60"
                }`}
              >
                [{m === "sol" ? "SOL" : "$OTC"}]
              </button>
            ))}
          </div>

          {quote && split && (
            <div className="mt-2 border border-green-500/20 p-2 text-[11px]">
              <div className="flex justify-between gap-2">
                <span className={method === "sol" ? "text-emerald-300" : "text-green-300"}>
                  SOL: {fmtSol(quote.solLamports, 2)}
                </span>
                <span className="text-green-600">
                  {fmtSol(split.toPot, 2)} → pot, {fmtSol(split.toOps, 2)} → ops
                </span>
              </div>
              <div className="mt-1 flex justify-between gap-2">
                <span className={method === "otc" ? "text-amber-300" : otcTone}>
                  $OTC:{" "}
                  {quote.otcUnits != null
                    ? `${fmtUnits(quote.otcUnits, otcDecimals)} OTC`
                    : `unavailable — ${quote.otcUnavailableReason}`}
                </span>
                <span className={otcAvailable ? "text-green-600" : "text-green-800"}>
                  {premium}× premium → POL reserve
                </span>
              </div>
              <div className="mt-1 text-[10px] text-green-700">
                {`${quote.steps} step(s) · ${pending > 0 ? "claim_yield first · " : ""}1 tx · 1 prompt`}
              </div>
            </div>
          )}

          <div className="mt-2 grid grid-cols-2 gap-1 text-[11px]">
            <div className="flex justify-between border border-green-500/20 px-2 py-1">
              <span className="text-green-600">SOL_BAL</span>
              <span className={solShort ? "text-amber-400" : "text-emerald-300"}>
                {balances.data ? fmtSol(Number(balances.data.solLamports), 3) : "…"}
              </span>
            </div>
            <div className="flex justify-between border border-green-500/20 px-2 py-1">
              <span className="text-green-600">$OTC_BAL</span>
              <span className={otcShort ? "text-amber-400" : "text-emerald-300"}>
                {!balances.data
                  ? "…"
                  : otcBal === null
                    ? "no token account"
                    : `${fmtUnits(otcBal, otcDecimals)} OTC`}
              </span>
            </div>
          </div>
          {(otcShort || solShort) && (
            <div className="mt-1 text-[11px] text-amber-400">
              insufficient {ticker} for this {verb.toLowerCase()}.
            </div>
          )}

          {hasQuote && !busy && (
            <div className="mt-2 text-[10px] uppercase tracking-widest text-emerald-400/70">
              activation ready — press the big green button.
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy || !hasQuote || (method === "otc" && !otcAvailable)}
              className={`${btn} border-emerald-500/60 font-bold text-emerald-300 hover:bg-emerald-500/10`}
            >
              {runLabel}
            </button>
            <span className="text-[11px] text-green-600">
              {shortKey(desk.asset, 6)} · T{fromTier} → T{toTier}
            </span>
          </div>
        </>
      )}
      {!signer && (
        <div className="mt-1 text-[10px] text-amber-400/80">
          read-only address — connect the wallet itself (WALLET_CONNECT) to sign.
        </div>
      )}
      {err && <div className="mt-2 text-[11px] text-amber-400">ERR: {err}</div>}
      <TxLogView logs={logs} />
      <div className="mt-2 text-[10px] text-green-700">
        {`SOL fee = step_fee × steps (90% pot, 10% ops). $OTC fee = SOL value × otc_per_sol × ${premium ?? "2.00"} → program-custodied POL reserve. The tx is simulated unsigned first; a failing sim is dropped with no fee spent.`}
      </div>
    </Panel>
  );
}
