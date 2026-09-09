import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey, type Connection } from "@solana/web3.js";
import { LAMPORTS_PER_SOL, type ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { useWalletBalances } from "../hooks/useWalletBalances";
import {
  executeCurveBuy,
  executeCurveSell,
  fetchCurveState,
  fetchCurveTrades,
  fetchSolUsdPrice,
  quoteCurve,
  type CurvePhase,
  type CurveQuote,
  type CurveState,
  type CurveTrade,
} from "../lib/curve";
import { fmtCompact, shortKey } from "../lib/format";
import { dexscreenerTokenUrl } from "../lib/marketplace";
import {
  SOL_FEE_RESERVE_LAMPORTS,
  formatRawAmount,
  parseAmountToRaw,
  parseSlippageBps,
  type TxLog,
} from "../lib/swap";
import type { WalletSigner } from "../lib/wallets";
import { GraduationSequence } from "./GraduationSequence";
import { SwapPanel } from "./SwapPanel";
import { AddressLink } from "./ui/AddressLink";
import { CopyButton } from "./ui/CopyButton";
import { Panel, Stat } from "./ui/Panel";
import { TxLogView } from "./ui/TxLogView";

type Props = { state: ProtocolState; address: string | null };
type Mode = "BUY" | "SELL";
const SOL_DECIMALS = 9;
const btn = "rounded-none border px-2 py-1 text-[11px] disabled:opacity-30";
const QUICK = [
  { label: "25%", frac: 0.25 },
  { label: "50%", frac: 0.5 },
  { label: "MAX", frac: 1 },
] as const;
const SLIPPAGE = [
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "3%", bps: 300 },
] as const;

const ASCII_CELLS = 40;
// red (0%) -> yellow (~50%) -> neon green (100%), interpolated per filled cell so the bar itself
// reads as a heat gradient climbing toward graduation.
function cellColor(frac: number): string {
  if (frac < 0.5) {
    const t = frac / 0.5;
    return t < 0.5 ? "text-red-500" : "text-orange-400";
  }
  return frac < 0.8 ? "text-yellow-500" : "text-green-400";
}

/** ASCII block loader — reads left→right as a heat gradient (red → yellow → neon green) climbing
 *  toward the graduation target; the whole bar pulses once progress clears 80% to signal the
 *  high-stakes final stretch. */
function ProgressBar({ bp }: { bp: number }) {
  const pct = Math.min(100, bp / 100);
  const filled = Math.round((pct / 100) * ASCII_CELLS);
  const imminent = pct >= 80;
  return (
    <div className="mt-1 font-mono">
      <div
        className={`flex flex-wrap text-sm leading-none tracking-tighter ${imminent ? "animate-pulse" : ""}`}
      >
        <span className="text-green-700">[</span>
        {Array.from({ length: ASCII_CELLS }, (_, i) => (
          <span key={i} className={i < filled ? cellColor(i / ASCII_CELLS) : "text-green-900"}>
            {i < filled ? "█" : "░"}
          </span>
        ))}
        <span className="text-green-700">]</span>
      </div>
      <div
        className={`mt-0.5 text-right text-[10px] ${imminent ? "font-bold text-green-400" : "text-green-600"}`}
      >
        {pct.toFixed(2)}% to graduation{imminent ? " — IMMINENT" : ""}
      </div>
    </div>
  );
}

function TradeRow({ t, dec }: { t: CurveTrade; dec: number }) {
  const isBuy = t.side === "buy";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-green-500/10 px-2 py-1 text-[11px] last:border-0">
      <span className={isBuy ? "font-bold text-emerald-400" : "font-bold text-red-400"}>
        {isBuy ? "BUY" : "SELL"}
      </span>
      <AddressLink address={t.wallet} label={shortKey(t.wallet)} />
      <span className="text-green-300">
        {formatRawAmount(BigInt(t.solLamports), SOL_DECIMALS)} SOL
      </span>
      <span className="text-green-600">↔</span>
      <span className="text-green-300">{formatRawAmount(BigInt(t.hubUnits), dec)} $HUB</span>
      <AddressLink address={t.payoutSignature} kind="tx" label="[tx]" />
    </div>
  );
}

/**
 * The curve's hero readout — CA, ASCII progress bar, raised/price/sold/wallet stats. Used both
 * as `BondingCurvePanel`'s top panel and as the real backdrop `GraduationSequence` blurs behind
 * its "GRADUATED" headline (in HubBondingDashboard and GraduationFxTestPage), so the FX is always
 * an extension of this exact live UI rather than a standalone illustration.
 */
export function CurveHeroPanel({
  curve,
  mint,
  dec,
  solUsd,
  collapsible = true,
}: {
  curve: CurveState;
  mint: string;
  dec: number;
  solUsd: number | null;
  /** Disabled by the graduation FX backdrop (HubBondingDashboard/GraduationFxTestPage) — a
   *  collapse toggle sitting behind the blurred "GRADUATED" overlay would be confusing/clickable
   *  through the blur, so that one render stays fixed open. */
  collapsible?: boolean;
}) {
  const spotPriceSol = Number(curve.spotPriceLamportsPerHub) / LAMPORTS_PER_SOL;
  const spotPriceUsd = solUsd != null ? spotPriceSol * solUsd : null;
  const raisedSol = Number(curve.realSolRaisedLamports) / LAMPORTS_PER_SOL;
  const targetSol = Number(curve.graduationTargetLamports) / LAMPORTS_PER_SOL;
  return (
    <Panel
      title="OTC LAUNCHER :: BONDING CURVE"
      right={<span className="text-emerald-400">{(curve.progressBp / 100).toFixed(2)}%</span>}
      collapsible={collapsible}
    >
      {mint && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
          <span className="text-sm font-bold text-green-300">$HUB</span>
          <span className="text-green-500/60">CA</span>
          <AddressLink address={mint} label={shortKey(mint, 6)} />
          <CopyButton text={mint} label="copy CA" />
        </div>
      )}
      <ProgressBar bp={curve.progressBp} />
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="raised" value={`${raisedSol.toFixed(3)} / ${targetSol.toFixed(0)} SOL`} />
        <Stat
          label="spot price"
          value={`${spotPriceSol.toFixed(9)} SOL`}
          sub={spotPriceUsd != null ? `≈ $${spotPriceUsd.toFixed(6)}` : undefined}
        />
        <Stat
          label="$HUB sold"
          value={fmtCompact(Number(formatRawAmount(BigInt(curve.realHubSoldUnits), dec)))}
        />
        <Stat
          label="curve wallet"
          value={<AddressLink address={curve.curveWallet} label={shortKey(curve.curveWallet)} />}
        />
      </div>
    </Panel>
  );
}

function GraduatedPanel({
  curve,
  mint,
  state,
  address,
}: {
  curve: CurveState;
  mint: string;
  state: ProtocolState;
  address: string | null;
}) {
  const raised = formatRawAmount(BigInt(curve.graduationTargetLamports), SOL_DECIMALS);
  return (
    <div className="space-y-2">
      <Panel
        title="🎓 CURVE GRADUATED :: LIVE ON AMM"
        right={curve.graduatedAt ? new Date(curve.graduatedAt).toLocaleString() : undefined}
        collapsible
      >
        <p className="text-xs text-green-400/90">
          The bonding curve raised {raised} SOL and migrated its liquidity into a Raydium CP-Swap
          pool.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-green-600">POOL</span>
          {curve.poolAddress ? (
            <>
              <AddressLink address={curve.poolAddress} label={shortKey(curve.poolAddress, 6)} />
              <CopyButton text={curve.poolAddress} label="copy pool" />
            </>
          ) : (
            <span className="text-amber-400">pool migration in progress…</span>
          )}
          <a
            href={dexscreenerTokenUrl(mint)}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-400 hover:text-cyan-200"
          >
            [DEXSCREENER ↗]
          </a>
        </div>
      </Panel>
      <SwapPanel state={state} address={address} />
    </div>
  );
}

function BondingCurvePanel({
  curve,
  trades,
  solUsd,
  state,
  address,
  connection,
  resolveSigner,
  onTraded,
}: {
  curve: CurveState;
  trades: CurveTrade[];
  solUsd: number | null;
  state: ProtocolState;
  address: string | null;
  connection: Connection;
  resolveSigner: (a: string) => WalletSigner | null;
  onTraded: () => void;
}) {
  const mint = state.config.hubMint;
  const dec = state.supply.decimals;
  const [mode, setMode] = useState<Mode>("BUY");
  const [amount, setAmount] = useState("0.1");
  const [slipBps, setSlipBps] = useState(100);
  const [customSlip, setCustomSlip] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quote, setQuote] = useState<CurveQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<CurvePhase | null>(null);
  const [logs, setLogs] = useState<TxLog[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const gen = useRef(0);
  const balances = useWalletBalances(address, mint);
  const signer = address ? resolveSigner(address) : null;

  const isBuy = mode === "BUY";
  const inDec = isBuy ? SOL_DECIMALS : dec;
  const outDec = isBuy ? dec : SOL_DECIMALS;

  let slippageBps = slipBps;
  let slipError: string | null = null;
  try {
    if (customSlip !== "") slippageBps = parseSlippageBps(customSlip);
  } catch (e) {
    slipError = (e as Error).message;
  }

  let raw: bigint | null = null;
  let inputError: string | null = null;
  try {
    raw = parseAmountToRaw(amount, inDec);
    if (raw === 0n) throw new Error("Enter an amount greater than zero");
  } catch (e) {
    inputError = (e as Error).message;
  }
  const inBal = balances.data ? (isBuy ? balances.data.solLamports : balances.data.hubUnits) : null;
  const outBal = balances.data
    ? isBuy
      ? balances.data.hubUnits
      : balances.data.solLamports
    : null;

  useEffect(() => {
    const g = ++gen.current;
    setQuote(null);
    if (!raw || busy) return;
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const q = await quoteCurve(isBuy ? "buy" : "sell", raw!);
        if (gen.current === g) setQuote(q);
      } catch (e) {
        if (gen.current === g) setErr((e as Error).message);
      } finally {
        if (gen.current === g) setQuoting(false);
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, raw?.toString(), busy]);

  const reset = (m: Mode) => {
    setMode(m);
    setErr(null);
    setAmount(
      m === "BUY" ? "0.1" : balances.data ? formatRawAmount(balances.data.hubUnits, dec) : "",
    );
  };
  const flip = () => reset(isBuy ? "SELL" : "BUY");
  const quickAmount = (frac: number) => {
    if (!balances.data || busy) return;
    const avail = isBuy
      ? balances.data.solLamports - SOL_FEE_RESERVE_LAMPORTS
      : balances.data.hubUnits;
    if (avail <= 0n) return;
    const v = frac >= 1 ? avail : (avail * BigInt(Math.round(frac * 100))) / 100n;
    if (v > 0n) setAmount(formatRawAmount(v, inDec));
  };

  const doTrade = async () => {
    if (!raw || busy) return;
    setErr(null);
    if (!signer) return setErr("Connect a signing wallet above to trade (read-only address)");
    if (slipError) return setErr(slipError);
    if (inBal == null) return setErr("Balance not loaded yet — retry in a moment");
    if (raw > inBal) return setErr(`${isBuy ? "SOL" : "$HUB"} balance too low`);
    if (!quote) return setErr("Waiting on a live quote — try again in a moment");
    setBusy(true);
    setLogs([]);
    try {
      if (isBuy && quote.side === "buy") {
        const minHubOut = (BigInt(quote.hubOut) * BigInt(10_000 - slippageBps)) / 10_000n;
        await executeCurveBuy({
          connection,
          signer,
          curveWallet: new PublicKey(curve.curveWallet),
          solLamports: raw,
          minHubOut,
          onLog: (l) => setLogs((p) => [...p, l]),
          onPhase: setPhase,
        });
      } else if (!isBuy && quote.side === "sell") {
        const minSolOut = (BigInt(quote.solOut) * BigInt(10_000 - slippageBps)) / 10_000n;
        await executeCurveSell({
          connection,
          signer,
          hubMint: new PublicKey(mint),
          curveHubAta: new PublicKey(curve.curveHubAta),
          hubUnits: raw,
          hubDecimals: dec,
          minSolOut,
          onLog: (l) => setLogs((p) => [...p, l]),
          onPhase: setPhase,
        });
      } else {
        throw new Error("Quote is stale — try again in a moment");
      }
      void balances.refetch();
      onTraded();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setPhase(null);
    }
  };

  return (
    <div className="space-y-2">
      <CurveHeroPanel curve={curve} mint={mint} dec={dec} solUsd={solUsd} />

      <Panel
        title={`TRADE :: ${isBuy ? "SOL → $HUB" : "$HUB → SOL"}`}
        right={
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-expanded={settingsOpen}
            disabled={busy}
            className={`rounded-none border px-1.5 py-0.5 text-[11px] disabled:opacity-30 ${
              settingsOpen
                ? "border-emerald-500/60 text-emerald-300"
                : "border-green-500/30 text-green-500/60 hover:border-green-500/50"
            }`}
          >
            [⚙ SLIP{" "}
            {customSlip
              ? `${customSlip}%`
              : (SLIPPAGE.find((s) => s.bps === slipBps)?.label ?? `${slipBps / 100}%`)}
            ]
          </button>
        }
        collapsible
      >
        {settingsOpen && (
          <div className="mb-2 border border-green-500/20 p-2">
            <div className="mb-1.5 text-[10px] uppercase tracking-widest text-green-600">
              slippage tolerance
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {SLIPPAGE.map((s) => (
                <button
                  key={s.bps}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSlipBps(s.bps);
                    setCustomSlip("");
                  }}
                  className={`${btn} ${
                    slipBps === s.bps && !customSlip
                      ? "border-emerald-500/60 text-emerald-400"
                      : "border-green-500/30 text-green-500/60"
                  }`}
                >
                  [{s.label}]
                </button>
              ))}
              <input
                value={customSlip}
                onChange={(e) => setCustomSlip(e.target.value)}
                disabled={busy}
                placeholder="cust %"
                className="w-16 rounded-none border border-green-500/30 bg-black px-1.5 text-[11px] text-cyan-300 outline-none focus:border-cyan-400/60 disabled:opacity-30"
              />
            </div>
            {slipError && <div className="mt-1 text-[11px] text-amber-400">{slipError}</div>}
          </div>
        )}
        <div className="mb-2 flex gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => reset("BUY")}
            disabled={busy}
            className={`${btn} flex-1 ${isBuy ? "border-emerald-500/60 text-emerald-300" : "border-green-500/30 text-green-500/60"}`}
          >
            [BUY]
          </button>
          <button
            type="button"
            onClick={() => reset("SELL")}
            disabled={busy}
            className={`${btn} flex-1 ${!isBuy ? "border-cyan-400/60 text-cyan-300" : "border-green-500/30 text-green-500/60"}`}
          >
            [SELL]
          </button>
        </div>

        <div className="border border-green-500/20 bg-green-500/5 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] uppercase tracking-widest text-green-600">
            <span>
              you pay · bal {inBal != null ? formatRawAmount(inBal, inDec) : "…"}{" "}
              {isBuy ? "SOL" : "$HUB"}
            </span>
            <span className="flex gap-1">
              {QUICK.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => quickAmount(q.frac)}
                  disabled={busy || inBal == null || inBal <= 0n}
                  className={`${btn} border-cyan-400/40 text-cyan-300`}
                >
                  [{q.label}]
                </button>
              ))}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              value={amount}
              onChange={(e) => {
                setErr(null);
                setAmount(e.target.value);
              }}
              disabled={busy}
              inputMode="decimal"
              aria-label="trade amount"
              placeholder="0.0"
              className="min-w-0 flex-1 bg-transparent text-xl font-bold text-green-200 outline-none placeholder:text-green-500/25 disabled:opacity-40"
            />
            <span className="shrink-0 text-sm font-bold text-green-300">
              {isBuy ? "SOL" : "$HUB"}
            </span>
          </div>
          {inputError && <div className="mt-1 text-[11px] text-amber-400">{inputError}</div>}
        </div>

        <div className="relative z-10 -my-2.5 flex justify-center">
          <button
            type="button"
            onClick={flip}
            disabled={busy}
            aria-label="Switch trade direction"
            className="border border-green-500/50 bg-black px-2 py-1 text-sm leading-none text-green-400 transition-transform hover:border-emerald-400/60 hover:text-emerald-300 active:rotate-180 disabled:opacity-40"
          >
            ⇅
          </button>
        </div>

        <div className="border border-green-500/20 bg-green-500/5 p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] uppercase tracking-widest text-green-600">
            <span>
              you receive · bal {outBal != null ? formatRawAmount(outBal, outDec) : "…"}{" "}
              {isBuy ? "$HUB" : "SOL"}
            </span>
            <span>{quoting ? "QUOTING…" : quote ? "LIVE QUOTE" : "—"}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="min-w-0 break-all text-xl font-bold text-emerald-400">
              {quote
                ? formatRawAmount(
                    BigInt(quote.side === "buy" ? quote.hubOut : quote.solOut),
                    outDec,
                  )
                : quoting
                  ? "…"
                  : "0.0"}
            </span>
            <span className="shrink-0 text-sm font-bold text-green-300">
              {isBuy ? "$HUB" : "SOL"}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={doTrade}
          disabled={busy || !address || !!inputError || !quote}
          className={`mt-2 w-full rounded-none border py-1.5 text-[13px] font-bold disabled:opacity-30 ${
            isBuy
              ? "border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/10"
              : "border-cyan-400/60 text-cyan-300 hover:bg-cyan-500/10"
          }`}
        >
          {busy
            ? `${(phase ?? "prep").toUpperCase()}…`
            : !address
              ? "[CONNECT A WALLET TO TRADE]"
              : `[${isBuy ? "BUY" : "SELL"} ON THE CURVE]`}
        </button>
        {address && !signer && (
          <div className="mt-1 text-[10px] text-amber-400/80">
            read-only address — connect the wallet itself (WALLET_CONNECT) to sign trades.
          </div>
        )}
        {err && (
          <div className="mt-2 border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-400">
            ERR: {err}
          </div>
        )}
        <TxLogView logs={logs} />
        <div className="mt-2 text-[10px] text-green-700">
          Each leg is a two-step deposit-then-redeem against the curve wallet: your deposit is
          simulated, signed, sent and confirmed, then the curve API redeems it at the price locked
          in at quote time.
        </div>
      </Panel>

      <Panel title="LIVE ACTIVITY" right={`${trades.length} recent`} collapsible>
        {trades.length === 0 ? (
          <div className="text-xs text-green-700">
            no trades yet — be the first to buy the curve.
          </div>
        ) : (
          <div className="max-h-52 overflow-y-auto">
            {trades.map((t) => (
              <TradeRow key={t.payoutSignature} t={t} dec={dec} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/**
 * Devnet-only "seamless transition" swap surface: renders the live OTC Launcher bonding curve
 * (progress, quotes, buy/sell, activity feed) pre-graduation, then flips to graduated/AMM view
 * once the curve's SOL target is hit. On mainnet (or any non-devnet cluster) this is just the
 * standard Jupiter `SwapPanel` — the curve simulation only exists on devnet (see bonding-curve.ts).
 */
export function HubBondingDashboard({ state, address }: Props) {
  const { cluster, connection, resolveSigner } = useHub();
  const isDevnet = cluster === "devnet";

  // Fires the graduation FX exactly once per session, the instant a state poll observes the
  // curve flip from not-graduated to graduated — never on initial mount (a page load that
  // *already* finds a graduated curve just renders GraduatedPanel directly, no replay). The FX
  // blurs a frozen snapshot of the curve from the poll *just before* it graduated (captured via
  // prevCurveRef), so the backdrop reads as "this exact panel, moments ago" rather than the
  // already-graduated data.
  const [showGradFx, setShowGradFx] = useState(false);
  const [gradSnapshot, setGradSnapshot] = useState<CurveState | null>(null);
  const seenFirstLoad = useRef(false);
  const wasGraduated = useRef(false);
  const prevCurveRef = useRef<CurveState | null>(null);

  const curveQuery = useQuery({
    queryKey: ["hub", "curve", "state"],
    queryFn: fetchCurveState,
    enabled: isDevnet,
    refetchInterval: 5_000,
  });

  useEffect(() => {
    const data = curveQuery.data;
    if (!data) return;
    if (!seenFirstLoad.current) {
      seenFirstLoad.current = true;
      wasGraduated.current = data.graduated;
      prevCurveRef.current = data;
      return;
    }
    if (data.graduated && !wasGraduated.current) {
      setGradSnapshot(prevCurveRef.current);
      setShowGradFx(true);
    }
    wasGraduated.current = data.graduated;
    prevCurveRef.current = data;
  }, [curveQuery.data]);

  const tradesQuery = useQuery({
    queryKey: ["hub", "curve", "trades"],
    queryFn: fetchCurveTrades,
    enabled: isDevnet && !curveQuery.data?.graduated,
    refetchInterval: 6_000,
  });
  const solUsdQuery = useQuery({
    queryKey: ["hub", "curve", "sol-usd"],
    queryFn: fetchSolUsdPrice,
    enabled: isDevnet,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  if (!isDevnet) return <SwapPanel state={state} address={address} />;

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

  const curve = curveQuery.data;
  if (curve.graduated) {
    return (
      <div className="space-y-2">
        {showGradFx && (
          <GraduationSequence onComplete={() => setShowGradFx(false)} symbol="$HUB">
            <CurveHeroPanel
              curve={gradSnapshot ?? curve}
              mint={state.config.hubMint}
              dec={state.supply.decimals}
              solUsd={solUsdQuery.data ?? null}
              collapsible={false}
            />
          </GraduationSequence>
        )}
        <GraduatedPanel curve={curve} mint={state.config.hubMint} state={state} address={address} />
      </div>
    );
  }
  return (
    <BondingCurvePanel
      curve={curve}
      trades={tradesQuery.data?.trades ?? []}
      solUsd={solUsdQuery.data ?? null}
      state={state}
      address={address}
      connection={connection}
      resolveSigner={resolveSigner}
      onTraded={() => {
        void curveQuery.refetch();
        void tradesQuery.refetch();
      }}
    />
  );
}
