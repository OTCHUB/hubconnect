// Direct Raydium CP-Swap CPI for `finalize_epoch`'s hop2 (USDC→$HUB) — replaces a Jupiter-routed
// hop2 because Jupiter's Metis routing engine gates newly-created/thin pools out of "normal
// routing" on a liquidity-depth check ($500/$1000 price-impact test), regardless of the pool
// itself being real and swappable on-chain. See `programs/hub/src/instructions/epochs.rs`'s
// `finalize_epoch` doc comment and `raydium_cpswap::swap_base_input`.
//
// Unlike Jupiter's hop1, hop2 needs no off-chain quote/build API call: the on-chain
// `swap_base_input` CPI builds its own instruction data from `(amount_in, minimum_amount_out)`,
// so this module only (a) assembles the pool's fixed 13-account list and (b) computes an
// off-chain constant-product estimate purely to floor `minimum_amount_out` — the swap itself
// trusts the post-CPI balance delta, not this estimate (same posture as `jupiter_swap::
// swap_exact_in`).
import { AccountMeta, Connection, PublicKey } from "@solana/web3.js";
import {
  HUB_USDC_POOL,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
} from "../../../sdk/src/constants";

export type RaydiumHop2Route = {
  /** Floors the hop's received output — an off-chain estimate, not what's enforced on-chain
   * (that's the post-CPI balance delta; see module doc comment). */
  minOut: bigint;
  /** This hop's fixed account list, concatenated after hop1's into `ctx.remaining_accounts`. */
  accounts: AccountMeta[];
  /** Unrounded expected output, for logging (`minOut` is what's actually enforced on-chain). */
  outAmount: bigint;
  /** For logging/journaling parity with the Jupiter hop's `routeLabels`. */
  routeLabels: string[];
};

/**
 * Fixed 13-account list for Raydium CP-Swap's `swap_base_input`, in its IDL order: payer,
 * authority, amm_config, pool_state, input_token_account, output_token_account, input_vault,
 * output_vault, input_token_program, output_token_program, input_token_mint, output_token_mint,
 * observation_state. `payer` (the vault PDA) is declared `isSigner: false` here — a client can
 * never mark a PDA as a signer in the *outer* transaction (there's no keypair to sign with); the
 * on-chain `raydium_cpswap::swap_base_input` elevates it to a real signer itself inside the CPI
 * via `invoke_signed`'s seed-derived privilege escalation, mirroring how hop1's
 * `jupiter_swap::swap_exact_in` already handles the same vault PDA.
 */
export function hop2SwapAccounts(
  vault: PublicKey,
  vaultUsdc: PublicKey,
  vaultHub: PublicKey,
  hubMint: PublicKey,
  usdcMint: PublicKey = new PublicKey(USDC_MINT),
): AccountMeta[] {
  const ro = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
  const rw = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
  return [
    ro(vault), // payer
    ro(new PublicKey(HUB_USDC_POOL.authority)),
    ro(new PublicKey(HUB_USDC_POOL.ammConfig)),
    rw(new PublicKey(HUB_USDC_POOL.poolState)),
    rw(vaultUsdc), // input_token_account
    rw(vaultHub), // output_token_account
    rw(new PublicKey(HUB_USDC_POOL.usdcVault)), // input_vault
    rw(new PublicKey(HUB_USDC_POOL.hubVault)), // output_vault
    ro(new PublicKey(TOKEN_PROGRAM_ID)), // input_token_program (USDC, classic)
    ro(new PublicKey(TOKEN_2022_PROGRAM_ID)), // output_token_program ($HUB, Token-2022)
    ro(usdcMint), // input_token_mint
    ro(hubMint), // output_token_mint
    rw(new PublicKey(HUB_USDC_POOL.observationState)),
  ];
}

/**
 * Off-chain constant-product quote (mirrors Raydium CP-Swap's own on-chain math) purely to floor
 * `minimum_amount_out` — see module doc comment. `amountIn` is hop1's *actual* quoted USDC
 * output (an estimate; the real on-chain amount is whatever hop1 deposits into `vault_usdc`),
 * the same sizing convention the old Jupiter-routed hop2 quote used.
 */
export async function quoteHop2(
  connection: Connection,
  amountIn: bigint,
  slippageBps: number,
): Promise<{ outAmount: bigint; minOut: bigint }> {
  if (amountIn <= 0n) throw new Error("quoteHop2: amountIn must be > 0");
  const [usdcVaultBal, hubVaultBal] = await Promise.all([
    connection.getTokenAccountBalance(new PublicKey(HUB_USDC_POOL.usdcVault)),
    connection.getTokenAccountBalance(new PublicKey(HUB_USDC_POOL.hubVault)),
  ]);
  const reserveIn = BigInt(usdcVaultBal.value.amount);
  const reserveOut = BigInt(hubVaultBal.value.amount);
  if (reserveIn <= 0n || reserveOut <= 0n) {
    throw new Error("quoteHop2: HUB/USDC pool has empty reserves");
  }
  const feeDenom = BigInt(HUB_USDC_POOL.tradeFeeRateDenominator);
  const amountInAfterFee = (amountIn * (feeDenom - BigInt(HUB_USDC_POOL.tradeFeeRate))) / feeDenom;
  const outAmount = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
  const minOut = (outAmount * BigInt(10_000 - slippageBps)) / 10_000n;
  return { outAmount, minOut };
}

/** Assembles hop2 (USDC→$HUB) as a direct Raydium CP-Swap CPI — see module doc comment. */
export async function fetchHop2Route(
  connection: Connection,
  vault: PublicKey,
  vaultUsdc: PublicKey,
  vaultHub: PublicKey,
  hubMint: PublicKey,
  amountIn: bigint,
  slippageBps: number,
): Promise<RaydiumHop2Route> {
  const { outAmount, minOut } = await quoteHop2(connection, amountIn, slippageBps);
  return {
    minOut,
    accounts: hop2SwapAccounts(vault, vaultUsdc, vaultHub, hubMint),
    outAmount,
    routeLabels: ["Raydium CP"],
  };
}
