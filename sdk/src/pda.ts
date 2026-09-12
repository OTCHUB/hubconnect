import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants";

/** Public key type accepted for a token-program argument (string or `PublicKey`). */
type TokenProgramId = PublicKey | string;

export const SEEDS = {
  config: Buffer.from("config"),
  epoch: Buffer.from("epoch"),
  tier: Buffer.from("tier"),
  pot: Buffer.from("pot"),
  burn: Buffer.from("burn"),
  otcPot: Buffer.from("otc_pot"),
  creatorFee: Buffer.from("creator_fee"),
  treasury: Buffer.from("treasury"),
  vault: Buffer.from("vault"),
  otcPay: Buffer.from("otc_pay"),
  tokenomics: Buffer.from("tokenomics"),
  airdrop: Buffer.from("airdrop"),
  rewardRound: Buffer.from("reward_round"),
  rewardClaim: Buffer.from("reward_claim"),
  hubPot: Buffer.from("hub_pot"),
  hubPotRound: Buffer.from("hub_pot_round"),
  hubPotClaim: Buffer.from("hub_pot_claim"),
  tierFee: Buffer.from("tier_fee"),
} as const;

const u64le = (n: BN | number | bigint) => new BN(n.toString()).toArrayLike(Buffer, "le", 8);
const u32le = (n: BN | number | bigint) => new BN(n.toString()).toArrayLike(Buffer, "le", 4);

export function configPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.config], programId);
}
export function potPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.pot], programId);
}
export function burnPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.burn], programId);
}
/** §A5 90% leg — $OTC yield-vault bookkeeping (otc_pending_lamports + lifetime avg buy rate). */
export function otcPotPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.otcPot], programId);
}
/** §A4 revised — ascending per-tier `activate_tier`/`upgrade_tier` SOL fee (T1 0.2 / T2 0.3 /
 *  T3 0.4 / T4 0.5 SOL), admin-retunable via `set_tier_step_fee`. */
export function tierFeePda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.tierFee], programId);
}
export function treasuryPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.treasury], programId);
}
/** §A6.3 creator-fee flywheel bookkeeping: pending $OTC + per-leg earmarks. */
export function creatorFeePda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.creatorFee], programId);
}
export function vaultPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.vault], programId);
}
/** §A4.1 $OTC payment parameters + POL reserve pointer. */
export function otcPayPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.otcPay], programId);
}
/** §A7.1 supply allocation plan + airdrop Merkle root. */
export function tokenomicsPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.tokenomics], programId);
}
/** §A7.1 per-desk airdrop claim receipt (exists ⇒ already claimed). */
export function airdropClaimPda(programId: PublicKey, asset: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.airdrop, asset.toBuffer()], programId);
}
/** §A6.3/§A7.1 bridge — one `fund_treasury_reward` snapshot, split across active desks. */
export function rewardRoundPda(programId: PublicKey, index: BN | number | bigint) {
  return PublicKey.findProgramAddressSync([SEEDS.rewardRound, u32le(index)], programId);
}
/** One payout receipt per desk asset per reward round (exists ⇒ already paid this round). */
export function rewardClaimPda(
  programId: PublicKey,
  round: BN | number | bigint,
  asset: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [SEEDS.rewardClaim, u32le(round), asset.toBuffer()],
    programId,
  );
}
/** §A5.1 MemeStock basket ($OTC, CRCLx, NVDAx, SPCXx) bookkeeping. */
export function hubPotPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.hubPot], programId);
}
/** One `fund_hub_pot` snapshot (all 4 buckets), split across active desks. */
export function hubPotRoundPda(programId: PublicKey, index: BN | number | bigint) {
  return PublicKey.findProgramAddressSync([SEEDS.hubPotRound, u32le(index)], programId);
}
/** One payout receipt per desk asset per HUB Pot round (exists ⇒ already paid this round). */
export function hubPotClaimPda(
  programId: PublicKey,
  round: BN | number | bigint,
  asset: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [SEEDS.hubPotClaim, u32le(round), asset.toBuffer()],
    programId,
  );
}
export function epochPda(programId: PublicKey, index: BN | number | bigint) {
  return PublicKey.findProgramAddressSync([SEEDS.epoch, u64le(index)], programId);
}
export function tierPda(programId: PublicKey, asset: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.tier, asset.toBuffer()], programId);
}

/**
 * SPL associated token account. `tokenProgramId` must be whichever token program actually owns
 * `mint` — defaults to classic `TOKEN_PROGRAM_ID` for backwards compatibility (correct for $HUB/
 * WSOL/USDC), but callers must pass `TOKEN_2022_PROGRAM_ID` for $OTC or any M.I.M ETF basket
 * mint (CRCLx/NVDAx/SPCXx), all of which are Token-2022. Getting this wrong derives the wrong
 * address entirely (the ATA seeds include the token program), not merely a validation failure.
 */
export function ataPda(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: TokenProgramId = TOKEN_PROGRAM_ID,
) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), new PublicKey(tokenProgramId).toBuffer(), mint.toBuffer()],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
  );
}

/** Metaplex Token Metadata account for `mint` — what Dexscreener / CoinGecko / wallets read. */
export function tokenMetadataPda(mint: PublicKey) {
  const program = new PublicKey(TOKEN_METADATA_PROGRAM_ID);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), program.toBuffer(), mint.toBuffer()],
    program,
  );
}
