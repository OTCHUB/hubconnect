// Generic EOA-signed Jupiter swap helper — for keepers that sign their *own* top-level
// transaction (creator-fee draw legs, and any future keeper trading from its own wallet).
// Distinct from `keeper/keeper/src/jupiter.ts`, which builds raw CPI instructions for a
// program-owned PDA that can never sign a top-level tx itself (`finalize_epoch`'s two-hop
// WSOL→USDC→$HUB leg) — a normal wallet keeper doesn't need that complexity and can use
// Jupiter's simpler "Meta-Aggregator" `/order` + `/execute` flow (one quote+tx call, one
// managed-landing call, no manual instruction assembly, no ALT bookkeeping).
//
// See https://dev.jup.ag/docs/swap/order-and-execute.
import { Keypair, VersionedTransaction } from "@solana/web3.js";

export type EoaSwapConfig = {
  apiBase?: string;
  apiKey?: string;
  slippageBps?: number;
  fetchImpl?: typeof fetch;
};

export type EoaSwapResult = {
  signature: string;
  inAmount: bigint;
  outAmount: bigint;
  totalOutputAmount: bigint;
  router: string;
};

const DEFAULT_API_BASE = "https://api.jup.ag";
const DEFAULT_SLIPPAGE_BPS = 150; // creator-fee legs are small/frequent — a bit more headroom than the epoch swap.

type OrderResponse = {
  transaction: string | null;
  requestId: string;
  outAmount: string;
  router?: string;
  errorCode?: number;
  errorMessage?: string;
  error?: string;
};

type ExecuteResponse = {
  status: "Success" | "Failed";
  signature?: string;
  error?: string;
  code?: number;
  totalOutputAmount?: string;
};

/**
 * Swaps `amountIn` base units of `inputMint` → `outputMint`, signed and landed by `wallet`
 * itself (a normal EOA, not a PDA). Throws on any failure — callers should not attest an
 * on-chain result (`record_creator_fee_burn_result`/`_stack`/`_ops`) unless this resolves.
 */
export async function swapExactIn(
  wallet: Keypair,
  inputMint: string,
  outputMint: string,
  amountIn: bigint,
  cfg: EoaSwapConfig = {},
): Promise<EoaSwapResult> {
  if (amountIn <= 0n) throw new Error("swapExactIn: amountIn must be > 0");
  const doFetch = cfg.fetchImpl ?? fetch;
  const apiBase = cfg.apiBase ?? DEFAULT_API_BASE;
  const headers: Record<string, string> = cfg.apiKey ? { "x-api-key": cfg.apiKey } : {};

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountIn.toString(),
    taker: wallet.publicKey.toBase58(),
    slippageBps: String(cfg.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
  });
  const orderRes = await doFetch(`${apiBase}/swap/v2/order?${params}`, { headers });
  if (!orderRes.ok) {
    const body = await orderRes.text().catch(() => "");
    throw new Error(`Jupiter /order ${orderRes.status} ${orderRes.statusText}: ${body}`.trim());
  }
  const order = (await orderRes.json()) as OrderResponse;
  if (!order.transaction) {
    throw new Error(
      `Jupiter /order returned no transaction (router=${order.router ?? "n/a"}, errorCode=${order.errorCode}): ${order.errorMessage ?? order.error ?? "no route found"}`,
    );
  }

  const tx = VersionedTransaction.deserialize(Buffer.from(order.transaction, "base64"));
  tx.sign([wallet]);
  const signedTransaction = Buffer.from(tx.serialize()).toString("base64");

  const execRes = await doFetch(`${apiBase}/swap/v2/execute`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ signedTransaction, requestId: order.requestId }),
  });
  if (!execRes.ok) {
    const body = await execRes.text().catch(() => "");
    throw new Error(`Jupiter /execute ${execRes.status} ${execRes.statusText}: ${body}`.trim());
  }
  const exec = (await execRes.json()) as ExecuteResponse;
  if (exec.status !== "Success" || !exec.signature) {
    throw new Error(`Jupiter /execute failed (code ${exec.code}): ${exec.error ?? "unknown error"}`);
  }
  return {
    signature: exec.signature,
    inAmount: amountIn,
    outAmount: BigInt(order.outAmount),
    totalOutputAmount: exec.totalOutputAmount ? BigInt(exec.totalOutputAmount) : BigInt(order.outAmount),
    router: order.router ?? "unknown",
  };
}
