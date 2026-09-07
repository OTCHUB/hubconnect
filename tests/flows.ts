// Instruction wrappers + invariant checks shared by the M2/M3 suites.
import { expect } from "chai";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { Harness, Fixture, MPL_CORE, waitForEpochEnd } from "./harness";
import { epochPda, tierPda, consignPda, accrualPda } from "../sdk/src/pda";
import * as K from "../sdk/src/constants";

export const bn = (n: number | bigint) => new anchor.BN(n.toString());

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

export async function claim(
  h: Harness,
  f: Fixture,
  claimer: Keypair,
  asset: PublicKey,
  epochIdx: number,
) {
  const [deskTier] = tierPda(h.program.programId, asset);
  const [epoch] = epochPda(h.program.programId, epochIdx);
  return h.program.methods
    .claimYield(bn(epochIdx))
    .accountsPartial({
      claimer: claimer.publicKey,
      deskAsset: asset,
      config: f.config,
      deskTier,
      epoch,
      pot: f.pot,
    })
    .signers([claimer])
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
  const [consignorAccrual] = accrualPda(h.program.programId, consignor, idx);
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

/** Wait for the open epoch to end, then finalize it. Returns the finalized index. */
export async function finalizeCurrent(h: Harness, f: Fixture) {
  const { idx, epoch } = await currentEpoch(h, f);
  await waitForEpochEnd(h, epoch.endTs.toNumber());
  await finalizeIdx(h, f, idx);
  return idx;
}

/**
 * Epochs are schedule-aligned (`next.start = prev.end`), so after a slow stretch the current
 * epoch may already be over. Catch up until the current epoch has ≥ `marginSecs` left.
 */
export async function openEpoch(h: Harness, f: Fixture, marginSecs = 3) {
  for (;;) {
    const { idx, epoch } = await currentEpoch(h, f);
    const now = await chainTime(h);
    const end = epoch.endTs.toNumber();
    if (end - now >= marginSecs) return idx;
    if (now >= end) await finalizeIdx(h, f, idx);
    else await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Claim every finalized epoch from `tier.next_claim_epoch` up to `current_epoch − 1`,
 * asserting each payout equals the program's pro-rata math. Returns lamports received.
 */
export async function claimAll(h: Harness, f: Fixture, owner: Keypair, asset: PublicKey) {
  const [deskTier] = tierPda(h.program.programId, asset);
  let total = 0;
  for (;;) {
    const t = await h.program.account.deskTier.fetch(deskTier);
    const c = await h.program.account.config.fetch(f.config);
    const idx = t.nextClaimEpoch.toNumber();
    if (idx >= c.currentEpoch.toNumber()) return total;
    const e = await h.program.account.epoch.fetch(epochPda(h.program.programId, idx)[0]);
    const w = K.TIER_WEIGHTS_BP[t.tier - 1];
    const totalW = e.totalWeightBp.toNumber();
    const remainingW = totalW - e.claimedWeightBp.toNumber();
    const dist = e.distributedLamports.toNumber();
    const expected =
      w === remainingW ? dist - e.claimedLamports.toNumber() : Math.floor((dist * w) / totalW);
    const b0 = await balance(h, owner.publicKey);
    await claim(h, f, owner, asset, idx);
    const got = (await balance(h, owner.publicKey)) - b0;
    expect(got, `claim epoch ${idx}`).to.eq(expected);
    total += got;
  }
}

export async function chainTime(h: Harness) {
  const slot = await h.provider.connection.getSlot();
  const t = await h.provider.connection.getBlockTime(slot);
  if (t === null) throw new Error("no block time for current slot");
  return t;
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
