// Jupiter "Build" (Metis on-chain router) client for `finalize_epoch`'s hop1 (WSOL→USDC) leg,
// executed synchronously via `jupiter_swap::swap_exact_in` (§
// programs/hub/src/instructions/epochs.rs / jupiter_swap.rs). Uses `/swap/v2/build`, not `/swap`
// or `/swap-instructions` — the docs call it out as the CPI-oriented path (raw `swapInstruction`,
// no assembled/signed transaction, no ALT dependency, which CPI can't use anyway) and it charges
// no Jupiter platform fee.
//
// hop2 (USDC→$HUB) is a **direct Raydium CP-Swap CPI** (see `./raydium.ts`), not a Jupiter route:
// Jupiter's Metis routing engine gates newly-created/thin pools out of "normal routing" on a
// liquidity-depth check regardless of the pool itself being real and swappable on-chain, which
// made the team-seeded HUB/USDC pool unroutable through Jupiter (see `raydium_cpswap::
// swap_base_input`'s doc comment).
//
// `wrapAndUnwrapSol=false` + explicit `destinationTokenAccount` for hop1 because the vault's
// WSOL/USDC scratch ATAs are pre-provisioned (`init_treasury_float`) and the WSOL leg is wrapped
// by the program itself (System transfer of the swap amount + `SyncNative`) immediately before
// hop1's CPI — Jupiter must not try to insert its own wrap/close-native instructions (there is no
// top-level transaction context for them to run in; this is an inner CPI). There is no explicit
// "source token account" parameter in the API: Jupiter always derives it as the ATA of (`taker`,
// `inputMint`), which only resolves to the right account because `vault_wsol` *is* that ATA.
import { AccountMeta, Connection, PublicKey } from "@solana/web3.js";
import { USDC_MINT, JUPITER_PROGRAM_ID, WSOL_MINT } from "../../../sdk/src/constants";
import { fetchHop2Route, type RaydiumHop2Route } from "./raydium";

export type JupiterBuildConfig = {
  apiBase?: string;
  apiKey?: string;
  slippageBps?: number;
  /** CPI has no ALT support, so each hop's route account list eats directly into the tx's static
   * account budget (on top of `finalize_epoch`'s own ~16 accounts, split across *two* hops) —
   * keep it small. */
  maxAccounts?: number;
  fetchImpl?: typeof fetch;
};

type ApiAccount = { pubkey: string; isSigner: boolean; isWritable: boolean };
type ApiInstruction = { programId: string; accounts: ApiAccount[]; data: string };
type BuildResponse = {
  outAmount: string;
  otherAmountThreshold: string;
  routePlan?: { swapInfo?: { label?: string } }[];
  swapInstruction: ApiInstruction;
};

export type JupiterHopRoute = {
  /** Floors the hop's received output — already net of `slippageBps` (`otherAmountThreshold`). */
  minOut: bigint;
  /** Raw Jupiter route instruction data for this hop (`hop1Data`/`hop2Data`). */
  data: Buffer;
  /** This hop's account list, concatenated with the other hop's into `ctx.remaining_accounts`. */
  accounts: AccountMeta[];
  /** Unrounded expected output, for logging (`minOut` is what's actually enforced on-chain). */
  outAmount: bigint;
  /** DEX labels in the route (e.g. `["Whirlpool"]`), for logging/journaling only. */
  routeLabels: string[];
};

/** Both hops of `finalize_epoch`'s two-hop swap, pre-assembled for `program.methods.finalizeEpoch`:
 * `hop1AccountCount = hop1.accounts.length`, `remainingAccounts = [...hop1.accounts,
 * ...hop2.accounts]`. hop1 is a Jupiter route; hop2 is a direct Raydium CP-Swap CPI (`./raydium`)
 * — see this module's doc comment. */
export type WsolToHubRoute = {
  hop1: JupiterHopRoute; // WSOL → USDC (Jupiter)
  hop2: RaydiumHop2Route; // USDC → $HUB (direct Raydium CP-Swap CPI)
};

const DEFAULT_API_BASE = "https://api.jup.ag";
const DEFAULT_SLIPPAGE_BPS = 100; // 1% — the SOL leg is a small, frequent, non-urgent buyback.
const DEFAULT_MAX_ACCOUNTS = 16; // halved vs. the old single-hop default — two hops now share the budget.

/**
 * Fetches one Jupiter route leg via `/swap/v2/build`. `taker` must be the CPI's `invoke_signed`
 * authority for that leg (the `["vault"]` PDA for both hops here) and `destinationTokenAccount`
 * the vault-owned scratch ATA the hop deposits into (`vault_usdc` for hop1, `vault_hub` for
 * hop2). `amountLamports`/`amountUnits` must exactly equal the balance `finalize_epoch` will
 * itself have moved into the hop's source account by the time this CPI runs — a mismatch either
 * fails the CPI (insufficient balance) or leaves an unswapped remainder rolling into the next
 * cycle (see `swap_exact_in`'s doc comment).
 */
async function fetchHopRoute(
  taker: PublicKey,
  inputMint: PublicKey,
  outputMint: PublicKey,
  destinationTokenAccount: PublicKey,
  amountIn: bigint,
  cfg: JupiterBuildConfig,
): Promise<JupiterHopRoute> {
  if (amountIn <= 0n) {
    throw new Error("fetchHopRoute: amountIn must be > 0");
  }
  const doFetch = cfg.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    inputMint: inputMint.toBase58(),
    outputMint: outputMint.toBase58(),
    amount: amountIn.toString(),
    taker: taker.toBase58(),
    slippageBps: String(cfg.slippageBps ?? DEFAULT_SLIPPAGE_BPS),
    maxAccounts: String(cfg.maxAccounts ?? DEFAULT_MAX_ACCOUNTS),
    wrapAndUnwrapSol: "false",
    destinationTokenAccount: destinationTokenAccount.toBase58(),
  });
  const res = await doFetch(`${cfg.apiBase ?? DEFAULT_API_BASE}/swap/v2/build?${params}`, {
    headers: cfg.apiKey ? { "x-api-key": cfg.apiKey } : undefined,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jupiter /build ${res.status} ${res.statusText}: ${body}`.trim());
  }
  const json = (await res.json()) as BuildResponse;
  const ix = json.swapInstruction;
  if (!ix) throw new Error("Jupiter /build returned no swapInstruction (no route found)");
  if (ix.programId !== JUPITER_PROGRAM_ID) {
    throw new Error(
      `Jupiter /build returned unexpected swapInstruction.programId ${ix.programId} (expected ${JUPITER_PROGRAM_ID})`,
    );
  }
  return {
    minOut: BigInt(json.otherAmountThreshold),
    data: Buffer.from(ix.data, "base64"),
    accounts: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    outAmount: BigInt(json.outAmount),
    routeLabels: (json.routePlan ?? [])
      .map((p) => p.swapInfo?.label)
      .filter((l): l is string => !!l),
  };
}

/**
 * Fetches both legs of `finalize_epoch`'s two-hop WSOL→USDC→$HUB swap: hop1 via Jupiter, hop2 as
 * a direct Raydium CP-Swap CPI (see module doc comment / `./raydium.ts`). `taker` must be the
 * `["vault"]` PDA; `vaultUsdc`/`vaultHub` are `TreasuryState.vault_usdc`/`vault_hub`.
 * `amountLamports` is the round's swap-leg SOL input (burn + lp + treasury-float bps of
 * effective inflow) — hop2's input amount is hop1's *actual* quoted `outAmount` (not
 * `minOut`), since that's what hop1 will really deposit into `vault_usdc` for hop2 to consume.
 */
export async function fetchWsolToHubRoute(
  connection: Connection,
  taker: PublicKey,
  hubMint: PublicKey,
  vaultUsdc: PublicKey,
  vaultHub: PublicKey,
  amountLamports: bigint,
  cfg: JupiterBuildConfig = {},
  usdcMint: PublicKey = new PublicKey(USDC_MINT),
): Promise<WsolToHubRoute> {
  const hop1 = await fetchHopRoute(
    taker,
    new PublicKey(WSOL_MINT),
    usdcMint,
    vaultUsdc,
    amountLamports,
    cfg,
  );
  const hop2 = await fetchHop2Route(
    connection,
    taker,
    vaultUsdc,
    vaultHub,
    hubMint,
    hop1.outAmount,
    cfg.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
  );
  return { hop1, hop2 };
}
