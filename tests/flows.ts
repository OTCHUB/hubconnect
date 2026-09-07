// Instruction wrappers + invariant checks shared by the M2/M3 suites.
import { expect } from "chai";
import * as anchor from "@anchor-lang/core";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Harness, Fixture, MPL_CORE, TOKEN_PROGRAM_ID } from "./harness";
import { epochPda, tierPda, consignPda, accrualPda, otcPayPda } from "../sdk/src/pda";
import * as K from "../sdk/src/constants";

export const bn = (n: number | bigint) => new anchor.BN(n.toString());
export const big = (v: { toString(): string }) => BigInt(v.toString());

export async function currentEpoch(h: Harness, f: Fixture) {
  const c = await h.program.account.config.fetch(f.config);
  const idx = c.currentEpoch.toNumber();
  const [key] = epochPda(h.program.programId, idx);
  return { idx, key, epoch: await h.program.account.epoch.fetch(key), config: c };
}

/** `pot − rent floor ≥ liability` and Σ checks the program asserts on-chain (§B3 invariants). */
export async function assertSolvent(h: Harness, f: Fixture) {
  const c = await h.program.account.config.fetch(f.config);
  const rent = await h.provider.connection.getMinimumBalanceForRentExemption(0);
  const bal = await h.provider.connection.getBalance(f.pot);
  expect(bal - rent, "pot ≥ liability").to.be.gte(c.potLiabilityLamports.toNumber());
}

export async function activate(h: Harness, f: Fixture, owner: Keypair, asset: PublicKey) {
  const { key: epoch } = await currentEpoch(h, f);
  const [deskTier] = tierPda(h.program.programId, asset);
  await h.program.methods
    .activateTier()
    .accountsPartial({
      payer: owner.publicKey,
      deskAsset: asset,
      config: f.config,
      epoch,
      pot: f.pot,
      opsWallet: f.opsWallet,
      deskTier,
    })
    .signers([owner])
    .rpc();
  return deskTier;
}

export async function upgrade(
  h: Harness,
  f: Fixture,
  owner: Keypair,
  asset: PublicKey,
  target: number,
) {
  const { key: epoch } = await currentEpoch(h, f);
  const [deskTier] = tierPda(h.program.programId, asset);
  return h.program.methods
    .upgradeTier(target)
    .accountsPartial({
      payer: owner.publicKey,
      deskAsset: asset,
      config: f.config,
      epoch,
      pot: f.pot,
      opsWallet: f.opsWallet,
      deskTier,
    })
    .signers([owner])
    .rpc();
}

/** §A4.1 #14 — authority creates `["otc_pay"]` pointing at the vault's $OTC token account. */
export function initOtcPayments(h: Harness, f: Fixture, polAccount: PublicKey) {
  const [otcPay] = otcPayPda(h.program.programId);
  return h.program.methods
    .initOtcPayments()
    .accountsPartial({
      authority: h.payer.publicKey,
      config: f.config,
      treasuryState: f.treasuryState,
      vault: f.vault,
      polAccount,
      otcPay,
    })
    .rpc();
}

/** §A4.1 #15 — authority refreshes the $OTC/SOL reference rate and the enable switch. */
export function setOtcRate(h: Harness, f: Fixture, otcPerSol: number | bigint, enabled: boolean) {
  const [otcPay] = otcPayPda(h.program.programId);
  return h.program.methods
    .setOtcRate(bn(otcPerSol), enabled)
    .accountsPartial({ authority: h.payer.publicKey, config: f.config, otcPay })
    .rpc();
}

/** Accounts shared by both $OTC payment instructions (mint + POL reserve read from chain). */
async function otcPayAccounts(h: Harness, f: Fixture) {
  const [otcPay] = otcPayPda(h.program.programId);
  const c = await h.program.account.config.fetch(f.config);
  const p = await h.program.account.otcPayConfig.fetch(otcPay);
  return {
    config: f.config,
    otcPay,
    otcMint: c.otcMint,
    polAccount: p.polAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

/** §A4.1 #16 — `activate_tier` paid in $OTC from `payerOtc` (owner's token account). */
export async function activateOtc(
  h: Harness,
  f: Fixture,
  owner: Keypair,
  asset: PublicKey,
  payerOtc: PublicKey,
) {
  const [deskTier] = tierPda(h.program.programId, asset);
  await h.program.methods
    .activateTierOtc()
    .accountsPartial({
      payer: owner.publicKey,
      deskAsset: asset,
      ...(await otcPayAccounts(h, f)),
      payerOtc,
      deskTier,
    })
    .signers([owner])
    .rpc();
  return deskTier;
}

/** §A4.1 #17 — `upgrade_tier` paid in $OTC from `payerOtc` (owner's token account). */
export async function upgradeOtc(
  h: Harness,
  f: Fixture,
  owner: Keypair,
  asset: PublicKey,
  target: number,
  payerOtc: PublicKey,
) {
  const [deskTier] = tierPda(h.program.programId, asset);
  return h.program.methods
    .upgradeTierOtc(target)
    .accountsPartial({
      payer: owner.publicKey,
      deskAsset: asset,
      ...(await otcPayAccounts(h, f)),
      payerOtc,
      deskTier,
    })
    .signers([owner])
    .rpc();
}

/** Single-tx claim of everything the tier is owed across every closed round. */
export async function claim(h: Harness, f: Fixture, claimer: Keypair, asset: PublicKey) {
  const [deskTier] = tierPda(h.program.programId, asset);
  return h.program.methods
    .claimYield()
    .accountsPartial({
      claimer: claimer.publicKey,
      deskAsset: asset,
      config: f.config,
      deskTier,
      pot: f.pot,
    })
    .signers([claimer])
    .rpc();
}

export async function claimAccrual(h: Harness, f: Fixture, wallet: Keypair) {
  const [accrual] = accrualPda(h.program.programId, wallet.publicKey);
  return h.program.methods
    .claimAccrual()
    .accountsPartial({ wallet: wallet.publicKey, config: f.config, accrual, pot: f.pot })
    .signers([wallet])
    .rpc();
}

export async function inflow(
  h: Harness,
  f: Fixture,
  source: "b" | "c" | "d" | "f",
  lamports: number,
) {
  const { key: epoch } = await currentEpoch(h, f);
  return h.program.methods
    .registerTreasuryInflow({ [source]: {} } as never, bn(lamports))
    .accountsPartial({
      treasury: f.treasury.publicKey,
      config: f.config,
      epoch,
      pot: f.pot,
      treasuryState: f.treasuryState,
    })
    .signers([f.treasury])
    .rpc();
}

export async function consignedInflow(
  h: Harness,
  f: Fixture,
  asset: PublicKey,
  consignor: PublicKey,
  lamports: number,
) {
  const { key: epoch, idx } = await currentEpoch(h, f);
  const [consignedDesk] = consignPda(h.program.programId, asset);
  const [consignorAccrual] = accrualPda(h.program.programId, consignor);
  await h.program.methods
    .registerConsignedInflow(bn(lamports))
    .accountsPartial({
      treasury: f.treasury.publicKey,
      config: f.config,
      epoch,
      pot: f.pot,
      consignedDesk,
      consignorAccrual,
    })
    .signers([f.treasury])
    .rpc();
  return { epochIdx: idx, consignorAccrual };
}

/** Raw finalize of `idx` (no waiting) — also used for negative cases. */
export function finalizeIdx(h: Harness, f: Fixture, idx: number) {
  const [epoch] = epochPda(h.program.programId, idx);
  const [nextEpoch] = epochPda(h.program.programId, idx + 1);
  return h.program.methods
    .finalizeEpoch(bn(idx))
    .accountsPartial({
      keeper: h.payer.publicKey,
      config: f.config,
      epoch,
      nextEpoch,
      pot: f.pot,
      burn: f.burn,
    })
    .rpc();
}

/** Open-round inflow the program will see at finalize (booked inflow + whole-lamport dust carry). */
export async function effectiveInflow(h: Harness, f: Fixture) {
  const { epoch, config } = await currentEpoch(h, f);
  return epoch.inflowLamports.toNumber() + Number(big(config.dustScaled) / K.ACC_SCALE);
}

/** Top the open round up to `min_pot_threshold_lamports` (source C) if it is short. */
export async function fillToThreshold(h: Harness, f: Fixture) {
  const { config } = await currentEpoch(h, f);
  const short = config.minPotThresholdLamports.toNumber() - (await effectiveInflow(h, f));
  if (short > 0) await inflow(h, f, "c", short);
}

/** Make sure the threshold is met, then close the open round. Returns the closed index. */
export async function finalizeCurrent(h: Harness, f: Fixture) {
  await fillToThreshold(h, f);
  const { idx } = await currentEpoch(h, f);
  await finalizeIdx(h, f, idx);
  return idx;
}

/** Mirror of on-chain `pending_yield`: ⌊(acc − stamp) × w / ACC_SCALE⌋ for a live tier. */
export async function pendingOf(h: Harness, f: Fixture, asset: PublicKey) {
  const t = await h.program.account.deskTier.fetch(tierPda(h.program.programId, asset)[0]);
  const c = await h.program.account.config.fetch(f.config);
  if (t.voided) return 0;
  const w = BigInt(K.TIER_WEIGHTS_BP[t.tier - 1]);
  return Number(((big(c.accPerWeight) - big(t.stampAccPerWeight)) * w) / K.ACC_SCALE);
}

/** Exact share `tier` received from one closed round (⌊per_weight_scaled × w / ACC_SCALE⌋). */
export async function shareOfRound(h: Harness, idx: number, tier: number) {
  const e = await h.program.account.epoch.fetch(epochPda(h.program.programId, idx)[0]);
  return Number((big(e.perWeightScaled) * BigInt(K.TIER_WEIGHTS_BP[tier - 1])) / K.ACC_SCALE);
}

/**
 * Claim everything pending for `asset` in ONE transaction, asserting the payout equals the
 * accumulator math and that the stamp caught up. Returns lamports received (0 → no claim sent).
 */
export async function claimPending(h: Harness, f: Fixture, owner: Keypair, asset: PublicKey) {
  const expected = await pendingOf(h, f, asset);
  if (expected === 0) return 0;
  const b0 = await balance(h, owner.publicKey);
  await claim(h, f, owner, asset);
  const got = (await balance(h, owner.publicKey)) - b0;
  expect(got, "single-tx claim").to.eq(expected);
  const t = await h.program.account.deskTier.fetch(tierPda(h.program.programId, asset)[0]);
  const c = await h.program.account.config.fetch(f.config);
  expect(t.stampAccPerWeight.eq(c.accPerWeight), "stamp == acc").to.eq(true);
  expect(t.totalClaimedLamports.toNumber(), "lifetime ledger").to.be.gte(got);
  return got;
}

export async function txFee(h: Harness, sig: string) {
  const tx = await h.provider.connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx?.meta) throw new Error(`tx ${sig} not found`);
  return tx.meta.fee;
}

export async function recordBurn(
  h: Harness,
  f: Fixture,
  hubBurned: number,
  lamportsSpent: number,
  sig: number[],
) {
  return h.program.methods
    .recordBurn(bn(hubBurned), bn(lamportsSpent), sig)
    .accountsPartial({ keeper: h.payer.publicKey, config: f.config, burn: f.burn, pot: f.pot })
    .rpc();
}

export async function consign(h: Harness, f: Fixture, owner: Keypair, asset: PublicKey) {
  const [consignedDesk] = consignPda(h.program.programId, asset);
  return h.program.methods
    .consignDesk()
    .accountsPartial({
      owner: owner.publicKey,
      deskAsset: asset,
      deskCollection: f.deskCollection,
      config: f.config,
      vault: f.vault,
      treasuryState: f.treasuryState,
      consignedDesk,
      mplCoreProgram: MPL_CORE,
    })
    .signers([owner])
    .rpc();
}

export async function unconsign(h: Harness, f: Fixture, consignor: Keypair, asset: PublicKey) {
  const [consignedDesk] = consignPda(h.program.programId, asset);
  const cd = await h.program.account.consignedDesk.fetch(consignedDesk);
  const [consignEpoch] = epochPda(h.program.programId, cd.consignedEpoch.toNumber());
  return h.program.methods
    .unconsignDesk()
    .accountsPartial({
      consignor: consignor.publicKey,
      deskAsset: asset,
      deskCollection: f.deskCollection,
      config: f.config,
      consignEpoch,
      vault: f.vault,
      treasuryState: f.treasuryState,
      consignedDesk,
      mplCoreProgram: MPL_CORE,
      systemProgram: SystemProgram.programId,
    })
    .signers([consignor])
    .rpc();
}

export async function setConfig(
  h: Harness,
  f: Fixture,
  field: string,
  value: Record<string, unknown>,
) {
  return h.program.methods
    .updateConfig({ [field]: {} } as never, value as never)
    .accountsPartial({ authority: h.payer.publicKey, config: f.config })
    .rpc();
}

export const balance = (h: Harness, k: PublicKey) => h.provider.connection.getBalance(k);
