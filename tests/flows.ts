// Instruction wrappers + invariant checks shared by the M2/M3 suites.
import { expect } from "chai";
import * as anchor from "@anchor-lang/core";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  Harness,
  Fixture,
  TOKEN_PROGRAM_ID,
  ata,
  createAtaIx,
  mintTo,
  tokenBalance,
} from "./harness";
import { epochPda, tierPda, otcPayPda } from "../sdk/src/pda";
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

/**
 * Idempotently top up `owner`'s $HUB ATA with a flat surplus, comfortably above any single
 * tier's cumulative cost (max T4 = 200k units), so activate/upgrade never run short.
 */
export async function ensureHubBalance(h: Harness, f: Fixture, owner: PublicKey) {
  const acct = ata(owner, f.hubMint);
  await h.provider.sendAndConfirm(
    new Transaction().add(createAtaIx(h.payer.publicKey, owner, f.hubMint)),
    [h.payer],
  );
  await mintTo(h, f.hubMint, acct, 1_000_000n * 10n ** 6n);
  return acct;
}

export async function activate(h: Harness, f: Fixture, owner: Keypair, asset: PublicKey) {
  const { key: epoch } = await currentEpoch(h, f);
  const [deskTier] = tierPda(h.program.programId, asset);
  const payerHub = await ensureHubBalance(h, f, owner.publicKey);
  await h.program.methods
    .activateTier(1)
    .accountsPartial({
      payer: owner.publicKey,
      deskAsset: asset,
      config: f.config,
      epoch,
      pot: f.pot,
      opsWallet: f.opsWallet,
      hubMint: f.hubMint,
      payerHub,
      tokenProgram: TOKEN_PROGRAM_ID,
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
  const payerHub = await ensureHubBalance(h, f, owner.publicKey);
  return h.program.methods
    .upgradeTier(target)
    .accountsPartial({
      payer: owner.publicKey,
      deskAsset: asset,
      config: f.config,
      epoch,
      pot: f.pot,
      opsWallet: f.opsWallet,
      hubMint: f.hubMint,
      payerHub,
      tokenProgram: TOKEN_PROGRAM_ID,
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

/** Accounts shared by both $OTC payment instructions (mints + POL reserve read from chain). */
async function otcPayAccounts(h: Harness, f: Fixture) {
  const [otcPay] = otcPayPda(h.program.programId);
  const c = await h.program.account.config.fetch(f.config);
  const p = await h.program.account.otcPayConfig.fetch(otcPay);
  return {
    config: f.config,
    otcPay,
    otcMint: c.otcMint,
    polAccount: p.polAccount,
    hubMint: c.hubMint,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

/** §A4.1 #16 — `activate_tier` paid in $OTC from `payerOtc` (owner's token account); the $HUB
 * tier cost is still burned from `payerHub`, exactly like the SOL path. */
export async function activateOtc(
  h: Harness,
  f: Fixture,
  owner: Keypair,
  asset: PublicKey,
  payerOtc: PublicKey,
) {
  const [deskTier] = tierPda(h.program.programId, asset);
  const payerHub = await ensureHubBalance(h, f, owner.publicKey);
  await h.program.methods
    .activateTierOtc(1)
    .accountsPartial({
      payer: owner.publicKey,
      deskAsset: asset,
      ...(await otcPayAccounts(h, f)),
      payerOtc,
      payerHub,
      deskTier,
    })
    .signers([owner])
    .rpc();
  return deskTier;
}

/** §A4.1 #17 — `upgrade_tier` paid in $OTC from `payerOtc` (owner's token account); the $HUB
 * cost delta is still burned from `payerHub`, exactly like the SOL path. */
export async function upgradeOtc(
  h: Harness,
  f: Fixture,
  owner: Keypair,
  asset: PublicKey,
  target: number,
  payerOtc: PublicKey,
) {
  const [deskTier] = tierPda(h.program.programId, asset);
  const payerHub = await ensureHubBalance(h, f, owner.publicKey);
  return h.program.methods
    .upgradeTierOtc(target)
    .accountsPartial({
      payer: owner.publicKey,
      deskAsset: asset,
      ...(await otcPayAccounts(h, f)),
      payerOtc,
      payerHub,
      deskTier,
    })
    .signers([owner])
    .rpc();
}

/** Single-tx claim of everything the tier is owed across every closed round (paid in $OTC). */
export async function claim(h: Harness, f: Fixture, claimer: Keypair, asset: PublicKey) {
  const [deskTier] = tierPda(h.program.programId, asset);
  const claimerOtc = await ensureOtcAccount(h, f, claimer.publicKey);
  return h.program.methods
    .claimYield()
    .accountsPartial({
      claimer: claimer.publicKey,
      deskAsset: asset,
      config: f.config,
      deskTier,
      pot: f.pot,
      otcPot: f.otcPot,
      otcMint: f.otcMint,
      otcVault: f.otcVault,
      claimerOtc,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([claimer])
    .rpc();
}

/** Idempotently ensure `owner` has an ATA for the fixture's canonical $OTC mint. */
export async function ensureOtcAccount(h: Harness, f: Fixture, owner: PublicKey) {
  const acct = ata(owner, f.otcMint);
  await h.provider.sendAndConfirm(
    new Transaction().add(createAtaIx(h.payer.publicKey, owner, f.otcMint)),
    [h.payer],
  );
  return acct;
}

/** §A5 keeper leg: fund `otc_vault` 1:1 (base units) against whatever finalize just credited,
 * so `claim_yield`'s lifetime average buy rate stays 1 and lamport-denominated pending amounts
 * translate directly into the $OTC amounts tests assert on. */
export async function settleOtcPending(h: Harness, f: Fixture) {
  const p = await h.program.account.otcPotState.fetch(f.otcPot);
  const pending = p.otcPendingLamports.toNumber();
  if (pending <= 0) return;
  const sig = Array.from(Keypair.generate().secretKey);
  await h.program.methods
    .recordOtcBuy(bn(pending), bn(pending), sig)
    .accountsPartial({
      keeper: h.payer.publicKey,
      config: f.config,
      otcPot: f.otcPot,
      otcMint: f.otcMint,
      keeperOtc: f.keeperOtc,
      otcVault: f.otcVault,
      pot: f.pot,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
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

/** Raw finalize of `idx` (no waiting) — also used for negative cases. On success, immediately
 * settles the round's $OTC leg (see `settleOtcPending`) so claims never hit `NoOtcPurchased`. */
export async function finalizeIdx(h: Harness, f: Fixture, idx: number) {
  const [epoch] = epochPda(h.program.programId, idx);
  const [nextEpoch] = epochPda(h.program.programId, idx + 1);
  const sig = await h.program.methods
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
  await settleOtcPending(h, f);
  return sig;
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
 * accumulator math and that the stamp caught up. §A5: paid in $OTC, priced at `otc_pot`'s
 * lifetime average buy rate — `settleOtcPending` keeps that rate at 1 in tests, so the $OTC
 * amount received equals the lamport-denominated `pendingOf` value. Returns $OTC base units
 * received (0 → no claim sent).
 */
export async function claimPending(h: Harness, f: Fixture, owner: Keypair, asset: PublicKey) {
  const expected = await pendingOf(h, f, asset);
  if (expected === 0) return 0;
  const claimerOtc = await ensureOtcAccount(h, f, owner.publicKey);
  const b0 = await tokenBalance(h, claimerOtc);
  await claim(h, f, owner, asset);
  const got = Number((await tokenBalance(h, claimerOtc)) - b0);
  expect(got, "single-tx claim (paid in $OTC at the test's 1:1 buy rate)").to.eq(expected);
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
