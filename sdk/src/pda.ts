import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants";

export const SEEDS = {
  config: Buffer.from("config"),
  epoch: Buffer.from("epoch"),
  tier: Buffer.from("tier"),
  consign: Buffer.from("consign"),
  accrual: Buffer.from("accrual"),
  pot: Buffer.from("pot"),
  burn: Buffer.from("burn"),
  treasury: Buffer.from("treasury"),
  vault: Buffer.from("vault"),
  otcPay: Buffer.from("otc_pay"),
  tokenomics: Buffer.from("tokenomics"),
  airdrop: Buffer.from("airdrop"),
} as const;

const u64le = (n: BN | number | bigint) => new BN(n.toString()).toArrayLike(Buffer, "le", 8);

export function configPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.config], programId);
}
export function potPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.pot], programId);
}
export function burnPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.burn], programId);
}
export function treasuryPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.treasury], programId);
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
export function epochPda(programId: PublicKey, index: BN | number | bigint) {
  return PublicKey.findProgramAddressSync([SEEDS.epoch, u64le(index)], programId);
}
export function tierPda(programId: PublicKey, asset: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.tier, asset.toBuffer()], programId);
}
export function consignPda(programId: PublicKey, asset: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.consign, asset.toBuffer()], programId);
}
/** Per-wallet ledger: consignor-share credits (`owed`) + lifetime claimed yield. */
export function accrualPda(programId: PublicKey, wallet: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.accrual, wallet.toBuffer()], programId);
}

/** SPL associated token account (classic Token program). */
export function ataPda(owner: PublicKey, mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), new PublicKey(TOKEN_PROGRAM_ID).toBuffer(), mint.toBuffer()],
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
