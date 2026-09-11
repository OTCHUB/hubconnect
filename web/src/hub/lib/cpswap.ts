// Client for trading directly against a graduated devnet bonding curve's Raydium CP-Swap pool.
// Jupiter has no devnet routes (see SwapPanel.tsx's `!mainnet` gate), so once a devnet curve
// graduates (HubBondingDashboard.tsx's GraduatedPanel) this is the only way left to trade
// $HUB/SOL — the pool itself is real (workers/bonding-curve.ts's `attemptGraduation` created it
// via workers/raydium-cpswap.ts's `initialize`). Kept as a dependency-free hand-rolled client
// mirroring that Worker file rather than cross-importing between the src/ and workers/ build
// trees, same rationale as curve.ts re-implementing its own `transferCheckedIx`.
//
// Unlike curve.ts's pre-graduation "deposit, then the Worker redeems" trust model, a live AMM
// pool needs no relay: every trade here is one ordinary, single-signer on-chain transaction the
// wallet signs directly against Raydium's program, which enforces its own constant-product
// invariant and the caller-supplied minimum-out floor itself.
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { ataPda, createAtaIdempotentIx } from "@hub-sdk";
import type { TxLog } from "./swap";
import type { WalletSigner } from "./wallets";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

/** Same live devnet CP-Swap deployment `workers/raydium-cpswap.ts` verified against on-chain
 *  state (see that file's header comment) — mirrored here, not re-verified. */
export const CPMM_PROGRAM_ID = new PublicKey("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb");
export const CPMM_AMM_CONFIG = new PublicKey("5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy");
/** AmmConfig(index 0).trade_fee_rate — 25 / 10_000 = 0.25%, deducted from the input amount
 *  before the constant-product math runs (mirrors `swap_base_input`'s on-chain fee model). */
export const CPMM_TRADE_FEE_BPS = 25n;

/** `sha256("global:swap_base_input")[0..8]` — Anchor's instruction sighash, same convention
 *  already confirmed against this exact program for `initialize` in raydium-cpswap.ts. */
const SWAP_BASE_INPUT_DISCRIMINATOR = Buffer.from([143, 190, 90, 218, 196, 30, 51, 222]);

function findPda(seeds: (Buffer | Uint8Array)[]) {
  return PublicKey.findProgramAddressSync(seeds, CPMM_PROGRAM_ID);
}

export type CpSwapPoolKeys = {
  token0Mint: PublicKey;
  token1Mint: PublicKey;
  authority: PublicKey;
  poolState: PublicKey;
  vault0: PublicKey;
  vault1: PublicKey;
  observationState: PublicKey;
};

/** Identical derivation to workers/raydium-cpswap.ts's `deriveCpSwapPoolKeys` — the pool address
 *  depends only on the two mints + AmmConfig, so it's fully client-derivable with no RPC round
 *  trip. Orders token_0/token_1 by raw pubkey bytes, matching the program's own constraint. */
export function deriveCpSwapPoolKeys(hubMint: PublicKey): CpSwapPoolKeys {
  const hubFirst = Buffer.compare(hubMint.toBuffer(), WSOL_MINT.toBuffer()) < 0;
  const token0Mint = hubFirst ? hubMint : WSOL_MINT;
  const token1Mint = hubFirst ? WSOL_MINT : hubMint;
  const [authority] = findPda([Buffer.from("vault_and_lp_mint_auth_seed")]);
  const [poolState] = findPda([
    Buffer.from("pool"),
    CPMM_AMM_CONFIG.toBuffer(),
    token0Mint.toBuffer(),
    token1Mint.toBuffer(),
  ]);
  const [vault0] = findPda([
    Buffer.from("pool_vault"),
    poolState.toBuffer(),
    token0Mint.toBuffer(),
  ]);
  const [vault1] = findPda([
    Buffer.from("pool_vault"),
    poolState.toBuffer(),
    token1Mint.toBuffer(),
  ]);
  const [observationState] = findPda([Buffer.from("observation"), poolState.toBuffer()]);
  return { token0Mint, token1Mint, authority, poolState, vault0, vault1, observationState };
}

/** spl-token `SyncNative` (ix 17, no args) — reconciles a WSOL account's token balance with its
 *  lamport balance after a plain SystemProgram transfer wraps SOL into it. */
function syncNativeIx(tokenAccount: PublicKey): TransactionInstruction {
  return {
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: tokenAccount, isSigner: false, isWritable: true }],
    data: Buffer.from([17]),
  } as TransactionInstruction;
}

/** spl-token `CloseAccount` (ix 9, no args) — unwraps a WSOL ATA back to native SOL (destination
 *  receives its lamports, rent + wrapped balance together). Run after every trade that leaves the
 *  wallet holding WSOL, mirroring Jupiter's default `wrapAndUnwrapSol` behavior in swap.ts, so a
 *  balance readout here always means native SOL, never a leftover wrapped remainder. */
function closeAccountIx(
  account: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
): TransactionInstruction {
  return {
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]),
  } as TransactionInstruction;
}

/** Raydium CP-Swap `swap_base_input { amount_in, minimum_amount_out }` — account order verified
 *  against the program's public IDL (raydium-io/raydium-cp-swap): payer, authority, amm_config,
 *  pool_state, input/output token account, input/output vault, input/output token program,
 *  input/output mint, observation_state. Input vs. output vault is resolved by matching mints,
 *  not by the pool's fixed token_0/token_1 order. */
function buildSwapBaseInputIx(params: {
  payer: PublicKey;
  keys: CpSwapPoolKeys;
  inputTokenAccount: PublicKey;
  outputTokenAccount: PublicKey;
  inputMint: PublicKey;
  outputMint: PublicKey;
  amountIn: bigint;
  minimumAmountOut: bigint;
}): TransactionInstruction {
  const {
    payer,
    keys,
    inputTokenAccount,
    outputTokenAccount,
    inputMint,
    outputMint,
    amountIn,
    minimumAmountOut,
  } = params;
  const inputIsToken0 = inputMint.equals(keys.token0Mint);
  const inputVault = inputIsToken0 ? keys.vault0 : keys.vault1;
  const outputVault = inputIsToken0 ? keys.vault1 : keys.vault0;
  const data = Buffer.alloc(8 + 8 + 8);
  SWAP_BASE_INPUT_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(amountIn, 8);
  data.writeBigUInt64LE(minimumAmountOut, 16);
  const keysMeta = [
    { pubkey: payer, isSigner: true, isWritable: false },
    { pubkey: keys.authority, isSigner: false, isWritable: false },
    { pubkey: CPMM_AMM_CONFIG, isSigner: false, isWritable: false },
    { pubkey: keys.poolState, isSigner: false, isWritable: true },
    { pubkey: inputTokenAccount, isSigner: false, isWritable: true },
    { pubkey: outputTokenAccount, isSigner: false, isWritable: true },
    { pubkey: inputVault, isSigner: false, isWritable: true },
    { pubkey: outputVault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: inputMint, isSigner: false, isWritable: false },
    { pubkey: outputMint, isSigner: false, isWritable: false },
    { pubkey: keys.observationState, isSigner: false, isWritable: true },
  ];
  return { programId: CPMM_PROGRAM_ID, keys: keysMeta, data } as TransactionInstruction;
}

export type CpSwapReserves = { hubReserve: bigint; solReserve: bigint };

/** Live reserves straight from the pool's own vaults — the only ground truth for a quote, since
 *  no cached/indexed price source exists for a devnet-only pool. */
export async function fetchCpSwapReserves(
  connection: Connection,
  keys: CpSwapPoolKeys,
  hubMint: PublicKey,
): Promise<CpSwapReserves> {
  const hubIsToken0 = keys.token0Mint.equals(hubMint);
  const [bal0, bal1] = await Promise.all([
    connection.getTokenAccountBalance(keys.vault0).catch(() => null),
    connection.getTokenAccountBalance(keys.vault1).catch(() => null),
  ]);
  const r0 = BigInt(bal0?.value.amount ?? "0");
  const r1 = BigInt(bal1?.value.amount ?? "0");
  return hubIsToken0 ? { hubReserve: r0, solReserve: r1 } : { hubReserve: r1, solReserve: r0 };
}

/** Constant-product quote matching `swap_base_input`'s on-chain math: the trade fee is taken out
 *  of the input amount first, then `amountOut = reserveOut - reserveIn·reserveOut /
 *  (reserveIn + amountInAfterFee)`. An off-chain preview only — the on-chain `minimum_amount_out`
 *  floor is what actually protects the trade from a stale quote. */
export function quoteCpSwap(
  side: "buy" | "sell",
  amountIn: bigint,
  reserves: CpSwapReserves,
): bigint {
  const [reserveIn, reserveOut] =
    side === "buy"
      ? [reserves.solReserve, reserves.hubReserve]
      : [reserves.hubReserve, reserves.solReserve];
  if (reserveIn <= 0n || reserveOut <= 0n || amountIn <= 0n) return 0n;
  const amountInAfterFee = amountIn - (amountIn * CPMM_TRADE_FEE_BPS) / 10_000n;
  if (amountInAfterFee <= 0n) return 0n;
  return (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);
}

export type CpSwapPhase = "sim" | "sign" | "send" | "confirm";
export type CpSwapResult = { signature: string; explorer: string };

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

/** One full on-chain leg: wrap/unwrap SOL as needed around a single `swap_base_input`, simulated
 *  before signing (same reliability shape as swap.ts/curve.ts — a failing sim aborts with no fee
 *  spent, and no partial-multisig construction is ever needed since this is a single signer). */
export async function executeCpSwapTrade(opts: {
  connection: Connection;
  signer: WalletSigner;
  hubMint: PublicKey;
  side: "buy" | "sell";
  amountIn: bigint;
  minimumAmountOut: bigint;
  onLog: (l: TxLog) => void;
  onPhase?: (p: CpSwapPhase) => void;
}): Promise<CpSwapResult> {
  const { connection, signer, hubMint, side, amountIn, minimumAmountOut, onLog, onPhase } = opts;
  const payer = new PublicKey(signer.publicKey);
  const keys = deriveCpSwapPoolKeys(hubMint);
  const [hubAta] = ataPda(payer, hubMint);
  const [wsolAta] = ataPda(payer, WSOL_MINT);
  const inputMint = side === "buy" ? WSOL_MINT : hubMint;
  const outputMint = side === "buy" ? hubMint : WSOL_MINT;
  const inputAta = side === "buy" ? wsolAta : hubAta;
  const outputAta = side === "buy" ? hubAta : wsolAta;

  const tx = new Transaction();
  tx.add(
    createAtaIdempotentIx(payer, payer, WSOL_MINT),
    createAtaIdempotentIx(payer, payer, hubMint),
  );
  if (side === "buy") {
    tx.add(
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: wsolAta, lamports: amountIn }),
      syncNativeIx(wsolAta),
    );
  }
  tx.add(
    buildSwapBaseInputIx({
      payer,
      keys,
      inputTokenAccount: inputAta,
      outputTokenAccount: outputAta,
      inputMint,
      outputMint,
      amountIn,
      minimumAmountOut,
    }),
  );
  // Always unwrap WSOL back to native SOL right after — a buy's now-empty WSOL ATA and a sell's
  // freshly-received WSOL both get closed the same way, so the wallet's SOL balance is always
  // what's shown, never a wrapped remainder sitting invisibly in a separate token account.
  tx.add(closeAccountIx(wsolAta, payer, payer));

  const bh = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = payer;
  tx.recentBlockhash = bh.blockhash;

  onPhase?.("sim");
  const sim = await connection.simulateTransaction(tx, undefined, false);
  if (sim.value.err) throw new Error(`SIM_FAIL: ${JSON.stringify(sim.value.err)}`);
  onLog({ type: "sim", msg: `swap sim OK (${sim.value.unitsConsumed ?? "?"} CU)` });

  onPhase?.("sign");
  const signed = await signer.signTransactionRaw(tx);

  onPhase?.("send");
  const sig = await connection.sendRawTransaction(signed, { skipPreflight: true, maxRetries: 3 });
  onLog({ type: "ok", msg: `swap sent ${sig.slice(0, 8)}…`, sig });

  onPhase?.("confirm");
  const conf = await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  if (conf.value.err) throw new Error(`FAILED_ON_CHAIN: ${JSON.stringify(conf.value.err)}`);
  onLog({ type: "ok", msg: "swap confirmed", sig });
  return { signature: sig, explorer: explorerTx(sig) };
}
