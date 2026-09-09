// Jupiter "Build" (Metis on-chain router) client for the SOL→$HUB leg `finalize_epoch` executes
// synchronously via `jupiter_swap::swap_exact_in` (§ programs/hub/src/instructions/jupiter_swap.rs).
// Uses `/swap/v2/build`, not `/swap` or `/swap-instructions` — the docs call it out as the
// CPI-oriented path (raw `swapInstruction`, no assembled/signed transaction, no ALT dependency,
// which CPI can't use anyway) and it charges no Jupiter platform fee.
//
// `wrapAndUnwrapSol=false` + explicit `destinationTokenAccount` because the vault's WSOL/$HUB
// scratch ATAs are pre-provisioned (`init_treasury_float`) and the WSOL leg is wrapped by the
// program itself (System transfer of the swap amount + `SyncNative`) immediately before this CPI
// — Jupiter must not try to insert its own wrap/close-native instructions (there is no top-level
// transaction context for them to run in; this is an inner CPI). There is no explicit "source
// token account" parameter in the API: Jupiter always derives it as the ATA of (`taker`,
// `inputMint`), which only resolves to the right account because `vault_wsol` *is* that ATA.
import { AccountMeta, PublicKey } from "@solana/web3.js";
import { JUPITER_PROGRAM_ID, WSOL_MINT } from "../../../sdk/src/constants";

export type JupiterBuildConfig = {
  apiBase?: string;
  apiKey?: string;
  slippageBps?: number;
  /** CPI has no ALT support, so the route's account list eats directly into the tx's static
   * account budget (on top of `finalize_epoch`'s own ~15 accounts) — keep it small. */
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

export type SolToHubRoute = {
  /** Floors the swap's received $HUB — already net of `slippageBps` (`otherAmountThreshold`). */
  minHubOut: bigint;
  /** Raw Jupiter route instruction data, passed verbatim as `finalize_epoch`'s `jupiter_data`. */
  jupiterData: Buffer;
  /** The route's account list, passed verbatim as `ctx.remaining_accounts`. */
  remainingAccounts: AccountMeta[];
  /** Unrounded expected $HUB out, for logging (`minHubOut` is what's actually enforced). */
  outAmount: bigint;
  /** DEX labels in the route (e.g. `["Whirlpool"]`), for logging/journaling only. */
  routeLabels: string[];
};

const DEFAULT_API_BASE = "https://api.jup.ag";
const DEFAULT_SLIPPAGE_BPS = 100; // 1% — the SOL leg is a small, frequent, non-urgent buyback.
const DEFAULT_MAX_ACCOUNTS = 32;

/**
 * Fetches a WSOL→$HUB route sized for `finalize_epoch`'s synchronous CPI leg. `taker` must be
 * the `["vault"]` PDA (the CPI's `invoke_signed` authority) and `destinationTokenAccount` its
 * $HUB scratch ATA (`TreasuryState.vault_hub`). `amountLamports` must exactly equal the SOL
 * amount `finalize_epoch` will itself wrap into `vault_wsol` this call (burn + lp + treasury-float
 * bps of the round's effective inflow) — a mismatch either fails the CPI (insufficient balance)
 * or leaves an unswapped remainder rolling into the next cycle (see `swap_exact_in`'s doc comment).
 */
export async function fetchSolToHubRoute(
  taker: PublicKey,
  hubMint: PublicKey,
  destinationTokenAccount: PublicKey,
  amountLamports: bigint,
  cfg: JupiterBuildConfig = {},
): Promise<SolToHubRoute> {
  if (amountLamports <= 0n) {
    throw new Error("fetchSolToHubRoute: amountLamports must be > 0");
  }
  const doFetch = cfg.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    inputMint: WSOL_MINT,
    outputMint: hubMint.toBase58(),
    amount: amountLamports.toString(),
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
    minHubOut: BigInt(json.otherAmountThreshold),
    jupiterData: Buffer.from(ix.data, "base64"),
    remainingAccounts: ix.accounts.map((a) => ({
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
