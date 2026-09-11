// Client for the devnet-only bonding-curve Worker (../../workers/bonding-curve.ts). Mirrors
// faucet.ts's pattern: always talks to a fixed origin — otchub.dev is where CURVE_KEY/CURVE_KV
// are deployed, at the otchub.dev/api/curve/* routes bound to that same Worker (see
// ../../wrangler.jsonc's env.devnet) — regardless of which host renders this module. Every
// caller gates on `cluster === "devnet"` first (see HubBondingDashboard.tsx).
//
// Trade lifecycle mirrors bonding-curve.ts's "verify deposit, then pay out" model: this module
// sends the real leg itself (SOL → curve wallet for a buy; $HUB → curve's ATA for a sell) as an
// ordinary wallet-signed transaction, confirms it, then asks the Worker to redeem it at the
// curve's current price. Same reliability shape as swap.ts/activate.ts: simulate before signing.
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { ataPda } from "@hub-sdk";
import type { TxLog } from "./swap";
import type { WalletSigner } from "./wallets";

export const CURVE_BASE_URL = "https://otchub.dev";
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/** spl-token `TransferChecked` (ix 12) — hand-rolled client mirror of workers/curve-ix.ts, kept
 *  dependency-free (no @solana/spl-token), same rationale as the rest of this lib. */
function transferCheckedIx(
  source: PublicKey,
  mint: PublicKey,
  dest: PublicKey,
  owner: PublicKey,
  amount: bigint,
  decimals: number,
): TransactionInstruction {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(decimals, 9);
  return {
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  } as TransactionInstruction;
}

export type CurveState = {
  virtualSolLamports: string;
  virtualHubUnits: string;
  realSolRaisedLamports: string;
  realHubSoldUnits: string;
  graduated: boolean;
  poolAddress: string | null;
  graduatedAt: number | null;
  createdAt: number;
  progressBp: number;
  graduationTargetLamports: string;
  curveWallet: string;
  curveHubAta: string;
  hubMint: string;
  spotPriceLamportsPerHub: string;
};

export type CurveTrade = {
  ts: number;
  side: "buy" | "sell";
  wallet: string;
  solLamports: string;
  hubUnits: string;
  signature: string;
  payoutSignature: string;
};

export type CurveQuote =
  { side: "buy"; solIn: string; hubOut: string } | { side: "sell"; hubIn: string; solOut: string };

export class CurveHttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "CurveHttpError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${CURVE_BASE_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new CurveHttpError(`could not reach the curve API at ${CURVE_BASE_URL}`, 0);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) {
    throw new CurveHttpError(
      body?.error ?? `curve request failed (HTTP ${res.status})`,
      res.status,
    );
  }
  return body;
}

export const fetchCurveState = () => call<CurveState>("/api/curve/state");
export const fetchCurveTrades = () => call<{ trades: CurveTrade[] }>("/api/curve/trades");

export const quoteCurve = (side: "buy" | "sell", amount: bigint) =>
  call<CurveQuote>("/api/curve/quote", {
    method: "POST",
    body: JSON.stringify({ side, amount: amount.toString() }),
  });

export type CurvePhase = "sim" | "sign" | "send" | "confirm" | "redeem";
export type CurveBuyResult = {
  side: "buy";
  solIn: string;
  hubOut: string;
  signature: string;
  explorer: string;
  graduated: boolean;
  progressBp: number;
};
export type CurveSellResult = {
  side: "sell";
  hubIn: string;
  solOut: string;
  signature: string;
  explorer: string;
  graduated: boolean;
  progressBp: number;
};

async function sendAndConfirmDeposit(opts: {
  connection: Connection;
  signer: WalletSigner;
  ix: TransactionInstruction;
  onLog: (l: TxLog) => void;
  onPhase?: (p: CurvePhase) => void;
}): Promise<string> {
  const { connection, signer, ix, onLog, onPhase } = opts;
  const payer = new PublicKey(signer.publicKey);
  const bh = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer, recentBlockhash: bh.blockhash }).add(ix);

  onPhase?.("sim");
  const sim = await connection.simulateTransaction(tx, undefined, false);
  if (sim.value.err) throw new Error(`SIM_FAIL: ${JSON.stringify(sim.value.err)}`);
  onLog({ type: "sim", msg: `deposit sim OK (${sim.value.unitsConsumed ?? "?"} CU)` });

  onPhase?.("sign");
  const signed = await signer.signTransactionRaw(tx);

  onPhase?.("send");
  const sig = await connection.sendRawTransaction(signed, { skipPreflight: true, maxRetries: 3 });
  onLog({ type: "ok", msg: `deposit sent ${sig.slice(0, 8)}…`, sig });

  onPhase?.("confirm");
  const conf = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (conf.value.err) throw new Error(`FAILED_ON_CHAIN: ${JSON.stringify(conf.value.err)}`);
  onLog({ type: "ok", msg: "deposit confirmed — redeeming on the curve…", sig });
  return sig;
}

/** Buy leg: deposit real SOL to the curve wallet, then redeem it for $HUB at the curve's current
 *  price. Two on-chain-adjacent steps, one Worker call — see bonding-curve.ts's trust model. */
export async function executeCurveBuy(opts: {
  connection: Connection;
  signer: WalletSigner;
  curveWallet: PublicKey;
  solLamports: bigint;
  minHubOut?: bigint;
  onLog: (l: TxLog) => void;
  onPhase?: (p: CurvePhase) => void;
}): Promise<CurveBuyResult> {
  const { connection, signer, curveWallet, solLamports, minHubOut, onLog, onPhase } = opts;
  const payer = new PublicKey(signer.publicKey);
  const ix = SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: curveWallet,
    lamports: solLamports,
  });
  const signature = await sendAndConfirmDeposit({ connection, signer, ix, onLog, onPhase });
  onPhase?.("redeem");
  const res = await call<CurveBuyResult>("/api/curve/buy", {
    method: "POST",
    body: JSON.stringify({ wallet: payer.toBase58(), signature, minHubOut: minHubOut?.toString() }),
  });
  onLog({ type: "ok", msg: `BUY FILLED — ${res.hubOut} $HUB out`, sig: res.signature });
  return res;
}

/** Sell leg: deposit real $HUB to the curve's ATA, then redeem it for SOL. */
export async function executeCurveSell(opts: {
  connection: Connection;
  signer: WalletSigner;
  hubMint: PublicKey;
  curveHubAta: PublicKey;
  hubUnits: bigint;
  hubDecimals: number;
  minSolOut?: bigint;
  onLog: (l: TxLog) => void;
  onPhase?: (p: CurvePhase) => void;
}): Promise<CurveSellResult> {
  const {
    connection,
    signer,
    hubMint,
    curveHubAta,
    hubUnits,
    hubDecimals,
    minSolOut,
    onLog,
    onPhase,
  } = opts;
  const payer = new PublicKey(signer.publicKey);
  const [sourceAta] = ataPda(payer, hubMint);
  const ix = transferCheckedIx(sourceAta, hubMint, curveHubAta, payer, hubUnits, hubDecimals);
  const signature = await sendAndConfirmDeposit({ connection, signer, ix, onLog, onPhase });
  onPhase?.("redeem");
  const res = await call<CurveSellResult>("/api/curve/sell", {
    method: "POST",
    body: JSON.stringify({ wallet: payer.toBase58(), signature, minSolOut: minSolOut?.toString() }),
  });
  onLog({ type: "ok", msg: `SELL FILLED — ${res.solOut} lamports out`, sig: res.signature });
  return res;
}

/** SOL/USD reference price for the curve's USD-denominated stats — real-world price is
 *  cluster-agnostic, so the canonical mainnet SOL mint's best pair is used even while the curve
 *  itself trades on devnet (devnet SOL has no market of its own). Null on any failure. */
export async function fetchSolUsdPrice(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112",
    );
    const body = (await res.json().catch(() => null)) as {
      pairs?: { priceUsd?: string; liquidity?: { usd?: number } }[];
    } | null;
    const pairs = body?.pairs ?? [];
    if (!pairs.length) return null;
    const best = pairs.reduce((a, b) =>
      (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a,
    );
    const price = Number(best.priceUsd);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}
