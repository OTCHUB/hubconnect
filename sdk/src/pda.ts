import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

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
export function epochPda(programId: PublicKey, index: BN | number | bigint) {
  return PublicKey.findProgramAddressSync([SEEDS.epoch, u64le(index)], programId);
}
export function tierPda(programId: PublicKey, asset: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.tier, asset.toBuffer()], programId);
}
export function consignPda(programId: PublicKey, asset: PublicKey) {
  return PublicKey.findProgramAddressSync([SEEDS.consign, asset.toBuffer()], programId);
}
export function accrualPda(programId: PublicKey, wallet: PublicKey, epoch: BN | number | bigint) {
  return PublicKey.findProgramAddressSync(
    [SEEDS.accrual, wallet.toBuffer(), u64le(epoch)],
    programId,
  );
}
