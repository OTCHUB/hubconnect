// SOL ↔ $HUB swaps via the Jupiter aggregator, ported from otchub/src/lib/jupiterSwap.js.
// Reliability model: every swap tx is SIMULATED before the wallet is asked to sign; a failing
// simulation aborts with no fee spent. The tx's fee payer must be the connected wallet, and the
// signed message must equal the simulated one (a wallet cannot substitute a different tx).
//
// Quote/build calls go through a `SwapTransport` so hosts can proxy Jupiter server-side (otchub
// routes them through its Base44 `jupiterSwapRelay` function to dodge browser CORS/rate limits);
// the default transport calls Jupiter's public lite API directly.
import { Buffer } from "buffer";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { WalletSigner } from "./wallets";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const SOL_DECIMALS = 9;
/** MAX on the SOL side leaves this for fees/rent — not a guarantee of the final fee. */
export const SOL_FEE_RESERVE_LAMPORTS = 10_000_000n;
export const U64_MAX = (1n << 64n) - 1n;

export type QuoteParams = {
  inputMint: string;
  outputMint: string;
  /** Raw base units as a decimal string. */
  amount: string;
  slippageBps: number;
};

export type JupiterQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct?: string;
  routePlan?: { swapInfo?: { label?: string } }[];
  error?: string;
};

export type SwapTransport = {
  quote: (params: QuoteParams) => Promise<JupiterQuote>;
  /** Returns the base64-serialized unsigned VersionedTransaction Jupiter built for `userPublicKey`. */
  swapTransaction: (quote: JupiterQuote, userPublicKey: string) => Promise<string>;
};

const JUP = "https://lite-api.jup.ag/swap/v1";

/** Browser-direct Jupiter lite API (mainnet only — Jupiter has no devnet routes). */
export const jupiterLiteTransport: SwapTransport = {
  async quote(p) {
    const qs = new URLSearchParams({
      inputMint: p.inputMint,
      outputMint: p.outputMint,
      amount: p.amount,
      slippageBps: String(p.slippageBps),
      swapMode: "ExactIn",
    });
    const res = await fetch(`${JUP}/quote?${qs}`);
    const body = (await res.json().catch(() => ({}))) as JupiterQuote & { error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? `Jupiter quote HTTP ${res.status}`);
    return body;
  },
  async swapTransaction(quoteResponse, userPublicKey) {
    const res = await fetch(`${JUP}/swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      swapTransaction?: string;
      error?: string;
    };
    if (!res.ok || body.error) throw new Error(body.error ?? `Jupiter swap HTTP ${res.status}`);
    if (!body.swapTransaction) throw new Error("Swap build returned no transaction");
    return body.swapTransaction;
  },
};

// ---- amounts: never through floating point ----
export function validateRawAmount(v: string | bigint | number, positive = false): bigint {
  if (!/^[0-9]{1,20}$/.test(String(v))) throw new Error("Raw amount must be an unsigned integer");
  const raw = BigInt(v);
  if (raw > U64_MAX) throw new Error("Amount exceeds u64");
  if (positive && raw === 0n) throw new Error("Enter an amount greater than zero");
  return raw;
}

export function parseAmountToRaw(value: string, decimals: number): bigint {
  if (!/^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(value))
    throw new Error("Enter a plain decimal amount");
  const [whole = "", fraction = ""] = value.split(".");
  const sig = fraction.replace(/0+$/, "");
  if (sig.length > decimals) throw new Error(`Amount supports at most ${decimals} decimal places`);
  const digits = `${whole || "0"}${sig.padEnd(decimals, "0")}`.replace(/^0+/, "") || "0";
  return validateRawAmount(digits);
}

export function formatRawAmount(v: bigint, decimals: number): string {
  const digits = v.toString().padStart(decimals + 1, "0");
  if (decimals === 0) return digits;
  const frac = digits.slice(-decimals).replace(/0+$/, "");
  return `${digits.slice(0, -decimals)}${frac ? `.${frac}` : ""}`;
}

/** "0.5" → 50 bp; rejects > 50%. */
export function parseSlippageBps(pct: string): number {
  const bps = Number(parseAmountToRaw(pct, 2));
  if (bps > 5000) throw new Error("Slippage must be between 0% and 50%");
  return bps;
}

const isPubkey = (s: string) => {
  try {
    return new PublicKey(s).toBase58() === s;
  } catch {
    return false;
  }
};

/** Quote must be for exactly what was asked (mints, amount, slippage, ExactIn) and route-able. */
export function validateQuote(q: JupiterQuote, p: QuoteParams): JupiterQuote {
  if (!isPubkey(p.inputMint) || !isPubkey(p.outputMint) || p.inputMint === p.outputMint)
    throw new Error("Invalid swap mint pair");
  if (!q || q.error) throw new Error(q?.error ?? "Empty quote");
  if (
    q.inputMint !== p.inputMint ||
    q.outputMint !== p.outputMint ||
    q.inAmount !== p.amount ||
    q.slippageBps !== p.slippageBps ||
    q.swapMode !== "ExactIn"
  )
    throw new Error("Quote does not match the requested swap");
  if (!q.routePlan?.length || q.routePlan.some((h) => !h?.swapInfo))
    throw new Error("No Jupiter route is available for this token and amount");
  const out = validateRawAmount(q.outAmount, true);
  if (validateRawAmount(q.otherAmountThreshold) > out)
    throw new Error("Invalid minimum received in quote");
  return q;
}

export async function getQuote(t: SwapTransport, p: QuoteParams) {
  validateRawAmount(p.amount, true);
  if (!Number.isInteger(p.slippageBps) || p.slippageBps < 0 || p.slippageBps > 5000)
    throw new Error("Slippage must be between 0% and 50%");
  return validateQuote(await t.quote(p), p);
}

export type TxLog = { type: "info" | "sim" | "ok" | "err"; msg: string; sig?: string };
export type SwapPhase = "quote" | "build" | "sim" | "sign" | "send" | "confirm";
export type SwapResult = { ok: true; sig: string } | { ok: false; reason: string };

/**
 * Full lifecycle for one Jupiter swap: quote → build → fee-payer check → simulate → sign →
 * send → confirm. `shouldContinue` is consulted only BEFORE signing (context guards must never
 * drop an approved tx).
 */
export async function executeSwap(opts: {
  connection: Connection;
  transport: SwapTransport;
  signer: WalletSigner;
  params: QuoteParams;
  onLog: (l: TxLog) => void;
  onPhase?: (p: SwapPhase) => void;
  shouldContinue?: () => boolean;
}): Promise<SwapResult> {
  const { connection, transport, signer, params, onLog, onPhase } = opts;
  const live = opts.shouldContinue ?? (() => true);
  const abort = (): SwapResult => {
    onLog({ type: "err", msg: "ABORT: swap context changed before signing" });
    return { ok: false, reason: "context_changed" };
  };
  const user = signer.publicKey;
  try {
    onPhase?.("quote");
    onLog({ type: "info", msg: "Quoting via Jupiter…" });
    const quote = await getQuote(transport, params);
    if (!live()) return abort();
    onPhase?.("build");
    onLog({ type: "info", msg: `Building swap tx for ${user.slice(0, 6)}…${user.slice(-4)}` });
    const b64 = await transport.swapTransaction(quote, user);
    if (!live()) return abort();

    const unsigned = VersionedTransaction.deserialize(new Uint8Array(Buffer.from(b64, "base64")));
    const simulatedMsg = Buffer.from(unsigned.message.serialize());
    const feePayer = unsigned.message.staticAccountKeys[0]?.toBase58();
    if (feePayer !== user) {
      onLog({ type: "err", msg: "ABORT: tx fee payer != connected wallet" });
      return { ok: false, reason: "fee_payer_mismatch" };
    }

    onPhase?.("sim");
    onLog({ type: "info", msg: "Simulating swap tx…" });
    const sim = await connection.simulateTransaction(unsigned, { sigVerify: false });
    if (!live()) return abort();
    if (sim.value.err) {
      const reason = JSON.stringify(sim.value.err);
      onLog({ type: "err", msg: `SIM_FAIL: ${reason}` });
      return { ok: false, reason };
    }
    onPhase?.("sign");
    onLog({
      type: "sim",
      msg: `Sim OK (${sim.value.unitsConsumed ?? "?"} CU). Requesting signature…`,
    });
    if (!live()) return abort();
    let signedBytes: Uint8Array;
    try {
      signedBytes = await signer.signTransactionRaw(unsigned);
    } catch (e) {
      onLog({ type: "err", msg: `SIGN_REJECTED: ${(e as Error).message}` });
      return { ok: false, reason: "rejected" };
    }
    const signed = VersionedTransaction.deserialize(new Uint8Array(signedBytes));
    if (
      !Buffer.from(signed.message.serialize()).equals(simulatedMsg) ||
      !signed.signatures[0]?.some((b) => b !== 0)
    )
      throw new Error("Wallet returned a changed or unsigned transaction");

    onPhase?.("send");
    const sig = await connection.sendRawTransaction(signedBytes, {
      skipPreflight: true,
      maxRetries: 3,
    });
    onLog({ type: "ok", msg: `SWAP SENT ${sig.slice(0, 8)}…`, sig });
    onPhase?.("confirm");
    onLog({ type: "info", msg: "Confirming landing…" });
    const bh = await connection.getLatestBlockhash("confirmed");
    const conf = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    if (conf.value.err) {
      onLog({ type: "err", msg: `FAILED_ON_CHAIN: ${JSON.stringify(conf.value.err)}`, sig });
      return { ok: false, reason: "failed_on_chain" };
    }
    onLog({ type: "ok", msg: "SWAP CONFIRMED", sig });
    return { ok: true, sig };
  } catch (e) {
    const msg = (e as Error).message;
    onLog({ type: "err", msg: `SWAP_ABORT: ${msg}` });
    return { ok: false, reason: msg };
  }
}
