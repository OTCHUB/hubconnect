import { useEffect, useRef, useState } from "react";
import type { ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { useWalletBalances } from "../hooks/useWalletBalances";
import { shortKey } from "../lib/format";
import { dexscreenerTokenUrl, jupiterSwapUrl } from "../lib/marketplace";
import {
  SOL_DECIMALS,
  SOL_FEE_RESERVE_LAMPORTS,
  SOL_MINT,
  executeSwap,
  formatRawAmount,
  getQuote,
  parseAmountToRaw,
  parseSlippageBps,
  type JupiterQuote,
  type SwapPhase,
  type TxLog,
} from "../lib/swap";
import { AddressLink } from "./ui/AddressLink";
import { CopyButton } from "./ui/CopyButton";
import { Panel } from "./ui/Panel";
import { TxLogView } from "./ui/TxLogView";

type Props = { state: ProtocolState; address: string | null };
type Mode = "BUY" | "SELL";

const SLIPPAGE = [
  { label: "0.5%", bps: 50 },
  { label: "1%", bps: 100 },
  { label: "3%", bps: 300 },
];
const QUICK = [
  { label: "25%", frac: 0.25 },
  { label: "50%", frac: 0.5 },
  { label: "MAX", frac: 1 },
] as const;
const btn = "border px-2 py-1 text-[11px] disabled:opacity-30";

/**
 * SOL ↔ $HUB via Jupiter — Uniswap-style stacked YOU PAY / YOU RECEIVE cards with a flip button,
 * quick amounts and a collapsible slippage drawer (matches otchub's SwapCard layout), rendered in
 * the same DOS-terminal aesthetic as the rest of the dashboard. Quotes are public; swapping needs
 * a signer.
 */
export function SwapPanel({ state, address }: Props) {
  const { connection, cluster, swapTransport, resolveSigner } = useHub();
  const mint = state.config.hubMint;
  const dec = state.supply.decimals;
  const [mode, setMode] = useState<Mode>("BUY");
  const [amount, setAmount] = useState("0.1");
  const [slipBps, setSlipBps] = useState(100);
  const [customSlip, setCustomSlip] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quote, setQuote] = useState<JupiterQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<SwapPhase | null>(null);
  const [logs, setLogs] = useState<TxLog[]>([]);
  const gen = useRef(0);
  const balances = useWalletBalances(address, mint);

  const isBuy = mode === "BUY";
  const inputMint = isBuy ? SOL_MINT : mint;
  const outputMint = isBuy ? mint : SOL_MINT;
  const inDec = isBuy ? SOL_DECIMALS : dec;
  const outDec = isBuy ? dec : SOL_DECIMALS;
  const signer = address ? resolveSigner(address) : null;
  const mainnet = cluster === "mainnet-beta";

  let raw: bigint | null = null;
  let slippageBps = slipBps;
  let inputError: string | null = null;
  try {
    if (customSlip !== "") slippageBps = parseSlippageBps(customSlip);
    raw = parseAmountToRaw(amount, inDec);
    if (raw === 0n) throw new Error("Enter an amount greater than zero");
  } catch (e) {
    inputError = (e as Error).message;
  }
  const params = raw ? { inputMint, outputMint, amount: raw.toString(), slippageBps } : null;
  const inBal = balances.data ? (isBuy ? balances.data.solLamports : balances.data.hubUnits) : null;
  const outBal = balances.data
    ? isBuy
      ? balances.data.hubUnits
      : balances.data.solLamports
    : null;

  // Debounced public quote; stale responses are dropped via the generation counter.
  useEffect(() => {
    const g = ++gen.current;
    setQuote(null);
    if (!params || busy || !mainnet) return;
    const t = setTimeout(async () => {
      setQuoting(true);
      try {
        const q = await getQuote(swapTransport, params);
        if (gen.current === g) setQuote(q);
      } catch (e) {
        if (gen.current === g) setErr((e as Error).message);
      } finally {
        if (gen.current === g) setQuoting(false);
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMint, outputMint, raw?.toString(), slippageBps, busy, mainnet]);

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

  const doSwap = async () => {
    if (!params || busy) return;
    setErr(null);
    if (!signer) return setErr("Connect a signing wallet above to swap (read-only address)");
    if (inBal == null) return setErr("Balance not loaded yet — retry in a moment");
    if (raw! > inBal) return setErr(`${isBuy ? "SOL" : "$HUB"} balance too low`);
    const g = gen.current;
    setBusy(true);
    setLogs([]);
    const res = await executeSwap({
      connection,
      transport: swapTransport,
      signer,
      params,
      onLog: (l) => setLogs((p) => [...p, l]),
      onPhase: setPhase,
      shouldContinue: () => gen.current === g && resolveSigner(signer.publicKey) !== null,
    });
    // `in` narrowing works under both strict (hubconnect) and non-strict (otchub jsconfig) TS.
    if ("reason" in res) setErr(`Swap stopped: ${res.reason}`);
    else void balances.refetch();
    setBusy(false);
    setPhase(null);
  };

  const ticker = isBuy ? "$HUB" : "SOL";
  const payToken = isBuy ? "SOL" : "$HUB";
  const recvToken = isBuy ? "$HUB" : "SOL";
  const slipLabel = customSlip
    ? `${customSlip}%`
    : (SLIPPAGE.find((s) => s.bps === slipBps)?.label ?? `${slipBps / 100}%`);
  return (
    <Panel
      title={`SWAP :: ${isBuy ? "SOL → $HUB" : "$HUB → SOL"}`}
      right={
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline">POWERED BY JUPITER</span>
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-expanded={settingsOpen}
            className={`border px-1.5 py-0.5 text-[11px] ${
              settingsOpen
                ? "border-emerald-500/60 text-emerald-300"
                : "border-green-500/30 text-green-500/60 hover:border-green-500/50"
            }`}
          >
            [⚙ SLIP {slipLabel}]
          </button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-green-600">CA</span>
        <AddressLink address={mint} label={shortKey(mint, 6)} />
        <CopyButton text={mint} label="copy CA" />
        <a
          href={dexscreenerTokenUrl(mint)}
          target="_blank"
          rel="noreferrer"
          className="text-cyan-400 hover:text-cyan-200"
        >
          [DEXSCREENER ↗]
        </a>
        <a
          href={jupiterSwapUrl(mint)}
          target="_blank"
          rel="noreferrer"
          className="text-amber-400 hover:text-amber-200"
        >
          [JUP.AG ↗]
        </a>
      </div>
      {!mainnet && (
        <div className="mt-2 border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-400">
          Jupiter routes exist on mainnet only — quotes are disabled on {cluster}. The CA above is
          the {cluster} mint.
        </div>
      )}

      {settingsOpen && (
        <div className="mt-2 border border-green-500/20 p-2">
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
              className="w-16 border border-green-500/30 bg-black px-1.5 text-[11px] text-cyan-300 outline-none focus:border-cyan-400/60 disabled:opacity-30"
            />
          </div>
        </div>
      )}

      {/* YOU PAY */}
      <div className="mt-2 border border-green-500/20 bg-green-500/5 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] uppercase tracking-widest text-green-600">
          <span>
            you pay · bal {inBal != null ? formatRawAmount(inBal, inDec) : "…"} {payToken}
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
            aria-label="swap amount"
            placeholder="0.0"
            className="min-w-0 flex-1 bg-transparent text-xl font-bold text-green-200 outline-none placeholder:text-green-500/25 disabled:opacity-40"
          />
          <span className="shrink-0 text-sm font-bold text-green-300">{payToken}</span>
        </div>
        {isBuy && (
          <div className="mt-1 text-[10px] text-green-700">
            MAX leaves {formatRawAmount(SOL_FEE_RESERVE_LAMPORTS, SOL_DECIMALS)} SOL for fees/rent.
          </div>
        )}
        {inputError && <div className="mt-1 text-[11px] text-amber-400">{inputError}</div>}
      </div>

      {/* flip direction */}
      <div className="relative z-10 -my-2.5 flex justify-center">
        <button
          type="button"
          onClick={flip}
          disabled={busy}
          aria-label="Switch swap direction"
          className="border border-green-500/50 bg-black px-2 py-1 text-sm leading-none text-green-400 transition-transform hover:border-emerald-400/60 hover:text-emerald-300 active:rotate-180 disabled:opacity-40"
        >
          ⇅
        </button>
      </div>

      {/* YOU RECEIVE */}
      <div className="border border-green-500/20 bg-green-500/5 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] uppercase tracking-widest text-green-600">
          <span>
            you receive · bal {outBal != null ? formatRawAmount(outBal, outDec) : "…"} {recvToken}
          </span>
          <span>{quoting ? "QUOTING…" : quote ? "LIVE QUOTE" : "—"}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="min-w-0 break-all text-xl font-bold text-emerald-400">
            {quote ? formatRawAmount(BigInt(quote.outAmount), outDec) : quoting ? "…" : "0.0"}
          </span>
          <span className="shrink-0 text-sm font-bold text-green-300">{ticker}</span>
        </div>
      </div>

      {quote && (
        <div className="mt-2 space-y-0.5 border border-green-500/10 bg-green-500/5 px-2 py-1.5 text-[10px] text-green-600">
          <div>
            MIN_RECV{" "}
            <span className="text-green-300">
              {formatRawAmount(BigInt(quote.otherAmountThreshold), outDec)} {ticker}
            </span>
          </div>
          <div>
            PRICE_IMPACT{" "}
            <span className="text-green-300">
              {(Number(quote.priceImpactPct ?? 0) * 100).toFixed(3)}%
            </span>
          </div>
          <div className="truncate">
            ROUTE{" "}
            <span className="text-green-300">
              {quote.routePlan?.map((r) => r.swapInfo?.label).join(" → ") || "—"}
            </span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={doSwap}
        disabled={busy || !mainnet || !address || !!inputError || !quote}
        className={`mt-2 w-full border py-1.5 text-[13px] font-bold disabled:opacity-30 ${
          isBuy
            ? "border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/10"
            : "border-cyan-400/60 text-cyan-300 hover:bg-cyan-500/10"
        }`}
      >
        {busy
          ? `${(phase ?? "prep").toUpperCase()}…`
          : !address
            ? "[CONNECT A WALLET TO SWAP]"
            : `[SWAP ${isBuy ? "SOL → $HUB" : "$HUB → SOL"}]`}
      </button>
      {address && !signer && (
        <div className="mt-1 text-[10px] text-amber-400/80">
          read-only address — connect the wallet itself (WALLET_CONNECT) to sign swaps.
        </div>
      )}
      {err && (
        <div className="mt-2 border border-amber-500/40 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-400">
          ERR: {err}
        </div>
      )}
      <TxLogView logs={logs} />
      <div className="mt-2 text-[10px] text-green-700">
        Tx is simulated first; a failing sim aborts before signing (no fee spent). Signs with your
        connected wallet only. A quote is not a guarantee of execution.
      </div>
    </Panel>
  );
}
