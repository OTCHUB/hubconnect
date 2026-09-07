// M2 — tiers, threshold-gated rounds, single-tx accumulator claims, lazy revocation, burn
// (spec §B5 integration list). Round indices are never hardcoded: tests read state from chain.
import { expect } from "chai";
import * as anchor from "@anchor-lang/core";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  setup,
  Harness,
  ensureInitialized,
  Fixture,
  fundWallet,
  createDeskAsset,
  transferDeskAsset,
  coreOwner,
  expectFail,
} from "./harness";
import {
  activate,
  upgrade,
  claim,
  claimPending,
  pendingOf,
  shareOfRound,
  effectiveInflow,
  fillToThreshold,
  inflow,
  finalizeCurrent,
  finalizeIdx,
  recordBurn,
  assertSolvent,
  currentEpoch,
  setConfig,
  balance,
  big,
  txFee,
} from "./flows";
import { epochPda, tierPda } from "../sdk/src/pda";
import * as K from "../sdk/src/constants";

const tierOf = (h: Harness, asset: PublicKey) =>
  h.program.account.deskTier.fetch(tierPda(h.program.programId, asset)[0]);
const sumW = K.TIER_WEIGHTS_BP.reduce((a, b) => a + b, 0);

describe("M2 — yield engine", () => {
  let h: Harness;
  let f: Fixture;
  const owners: Keypair[] = [];
  const desks: PublicKey[] = [];
  let weightBefore = 0;

  before(async function () {
    this.timeout(180_000);
    h = await setup();
    f = await ensureInitialized(h);
    weightBefore = (await h.program.account.config.fetch(f.config)).totalWeightBp.toNumber();
    for (let i = 0; i < 4; i++) {
      const o = await fundWallet(h, 2.6 * LAMPORTS_PER_SOL);
      owners.push(o);
      desks.push(await createDeskAsset(h, f.deskCollection, o.publicKey));
    }
  });

  it("activate + upgrade to T1..T4 pays exact 90/10 split and accumulates Σw", async () => {
    const ops0 = await balance(h, f.opsWallet);
    const pot0 = await balance(h, f.pot);
    for (let i = 0; i < 4; i++) {
      await activate(h, f, owners[i], desks[i]);
      if (i > 0) await upgrade(h, f, owners[i], desks[i], i + 1);
      const t = await tierOf(h, desks[i]);
      expect(t.tier).to.eq(i + 1);
      expect(t.ownerAtActivation.toBase58()).to.eq(owners[i].publicKey.toBase58());
      await assertSolvent(h, f);
    }
    const { toOps, toPot } = K.splitFee(K.cumulativeFeeLamports(1 + 2 + 3 + 4));
    expect((await balance(h, f.opsWallet)) - ops0).to.eq(toOps);
    expect((await balance(h, f.pot)) - pot0).to.eq(toPot);
    const c = await h.program.account.config.fetch(f.config);
    expect(c.totalWeightBp.toNumber() - weightBefore).to.eq(sumW);
  });

  it("rejects double activation, non-owner activation, and non-step upgrades", async () => {
    await expectFail(activate(h, f, owners[0], desks[0]), "TierAlreadyActive");
    await expectFail(activate(h, f, owners[1], desks[0]), "NotDeskOwner");
    await expectFail(upgrade(h, f, owners[1], desks[1], 2), "InvalidTierStep");
    await expectFail(upgrade(h, f, owners[3], desks[3], 4), "TierMaxed");
    await expectFail(upgrade(h, f, owners[0], desks[0], 5), "InvalidTierStep");
  });

  let e0 = 0;
  it("finalize is gated by min_pot_threshold, not the clock: below → PotBelowThreshold; at → closes; 10/90 split", async function () {
    this.timeout(180_000);
    e0 = (await currentEpoch(h, f)).idx;
    // Activation fees already booked inflow; raise the bar 1 SOL above it to prove the gate.
    const before = await effectiveInflow(h, f);
    await setConfig(h, f, "minPotThresholdLamports", {
      u64: [new anchor.BN(before + LAMPORTS_PER_SOL)],
    });
    await expectFail(finalizeIdx(h, f, e0), "PotBelowThreshold");
    await inflow(h, f, "b", LAMPORTS_PER_SOL - 1);
    await expectFail(finalizeIdx(h, f, e0), "PotBelowThreshold"); // 1 lamport short
    await inflow(h, f, "b", 1);
    const inflowTotal = (await currentEpoch(h, f)).epoch.inflowLamports.toNumber();
    const burnBefore = (
      await h.program.account.burnState.fetch(f.burn)
    ).burnPendingLamports.toNumber();
    const acc0 = big((await h.program.account.config.fetch(f.config)).accPerWeight);

    await finalizeIdx(h, f, e0); // exactly at threshold → allowed, no waiting
    const e = await h.program.account.epoch.fetch(epochPda(h.program.programId, e0)[0]);
    const c = await h.program.account.config.fetch(f.config);
    const burn = Math.floor((inflowTotal * K.BURN_PCT_BP) / K.BPS);
    expect(e.finalized).to.eq(true);
    expect(e.finalizedTs.toNumber()).to.be.gt(0);
    expect(e.burnPendingLamports.toNumber()).to.eq(burn);
    // Zero-sum: inflow == burn + credited + floor remainder (≤ 1 lamport).
    expect(
      e.burnPendingLamports.toNumber() +
        e.distributedLamports.toNumber() +
        e.rolledForwardLamports.toNumber(),
    ).to.eq(inflowTotal);
    expect(e.rolledForwardLamports.toNumber()).to.be.lte(1);
    expect(e.totalWeightBp.toNumber()).to.eq(c.totalWeightBp.toNumber());
    // Accumulator advanced by exactly this round's per-weight credit.
    expect(big(c.accPerWeight) - acc0).to.eq(big(e.perWeightScaled));
    expect(big(e.accPerWeightAfter)).to.eq(big(c.accPerWeight));
    expect((await h.program.account.burnState.fetch(f.burn)).burnPendingLamports.toNumber()).to.eq(
      burnBefore + burn,
    );
    // Next round opens with the floor remainder only.
    const next = await currentEpoch(h, f);
    expect(next.idx).to.eq(e0 + 1);
    expect(next.epoch.inflowLamports.toNumber()).to.eq(e.rolledForwardLamports.toNumber());
    await assertSolvent(h, f);
    await expectFail(finalizeIdx(h, f, e0)); // already finalized (next epoch account exists)
    await setConfig(h, f, "minPotThresholdLamports", { u64: [new anchor.BN(h.thresholdLamports)] });
  });

  it("one claim per desk pays ⌊per_w × w⌋ exactly; Σ payouts + dust == credited; re-claim → NothingToClaim", async () => {
    const e = await h.program.account.epoch.fetch(epochPda(h.program.programId, e0)[0]);
    let paid = 0;
    for (let i = 0; i < 4; i++) {
      const expected = await shareOfRound(h, e0, i + 1);
      const got = await claimPending(h, f, owners[i], desks[i]);
      // Fresh Σw == these four desks → the round share is the whole pending amount.
      if (weightBefore === 0) expect(got).to.eq(expected);
      paid += got;
    }
    const dist = e.distributedLamports.toNumber();
    if (weightBefore === 0) {
      expect(paid).to.be.lte(dist);
      expect(paid).to.be.gte(dist - 4); // ≤ 1 lamport floor per claimer, carried as dust
    }
    // Ordering follows weights 1.0 / 1.25 / 1.6 / 2.0.
    expect(await pendingOf(h, f, desks[0])).to.eq(0);
    await assertSolvent(h, f);
    await expectFail(claim(h, f, owners[0], desks[0]), "NothingToClaim");
  });

  it("upgrade requires pending yield claimed; then pays exactly the step difference", async function () {
    this.timeout(180_000);
    await finalizeCurrent(h, f); // closed, unclaimed by everyone
    expect(await pendingOf(h, f, desks[0])).to.be.gt(0);
    await expectFail(upgrade(h, f, owners[0], desks[0], 2), "ClaimBeforeUpgrade");
    await claimPending(h, f, owners[0], desks[0]);
    const pot0 = await balance(h, f.pot);
    await upgrade(h, f, owners[0], desks[0], 3);
    expect((await balance(h, f.pot)) - pot0).to.eq(K.splitFee(K.stepFeeLamports(1, 3)).toPot);
    const t = await tierOf(h, desks[0]);
    expect(t.tier).to.eq(3);
    // Stamp advanced at upgrade → new weight only prices future rounds.
    expect(
      t.stampAccPerWeight.eq((await h.program.account.config.fetch(f.config)).accPerWeight),
    ).to.eq(true);
  });

  it("multi-round: one tx settles every round closed since the stamp (accumulator, not per-epoch)", async function () {
    this.timeout(180_000);
    // desks[1] skipped the previous round; close one more so two rounds are outstanding.
    const rA = (await currentEpoch(h, f)).idx - 1;
    await inflow(h, f, "c", LAMPORTS_PER_SOL / 2);
    const rB = await finalizeCurrent(h, f);
    expect(rB).to.eq(rA + 1);
    const perRound = (await shareOfRound(h, rA, 2)) + (await shareOfRound(h, rB, 2));
    const pending = await pendingOf(h, f, desks[1]);
    // Summing floors ≤ flooring the sum ≤ summing floors + (rounds − 1).
    expect(pending).to.be.gte(perRound);
    expect(pending).to.be.lte(perRound + 1);
    const got = await claimPending(h, f, owners[1], desks[1]);
    expect(got).to.eq(pending);
    expect(got).to.be.gt(0);
    await assertSolvent(h, f);
  });

  it("lazy revocation: transfer voids at claim (pending forfeited to dust); wash-transfer stays voided; re-activate at full price", async () => {
    const buyer = await fundWallet(h, 1.5 * LAMPORTS_PER_SOL);
    await transferDeskAsset(h, desks[2], f.deskCollection, owners[2], buyer.publicKey);
    expect((await coreOwner(h, desks[2])).toBase58()).to.eq(buyer.publicKey.toBase58());
    const c0 = await h.program.account.config.fetch(f.config);
    const w0 = c0.totalWeightBp.toNumber();
    const forfeit = await pendingOf(h, f, desks[2]);
    expect(forfeit).to.be.gt(0); // two unclaimed rounds
    const b0 = await balance(h, owners[2].publicKey);
    await claim(h, f, owners[2], desks[2]); // Ok, but voids
    expect((await tierOf(h, desks[2])).voided).to.eq(true);
    expect(await balance(h, owners[2].publicKey)).to.eq(b0);
    const c1 = await h.program.account.config.fetch(f.config);
    expect(c1.totalWeightBp.toNumber()).to.eq(w0 - K.TIER_WEIGHTS_BP[2]);
    // Forfeited share stays pot liability and re-enters the next round via dust.
    expect(big(c1.dustScaled) - big(c0.dustScaled) >= BigInt(forfeit) * K.ACC_SCALE).to.eq(true);
    expect(c1.potLiabilityLamports.toNumber()).to.eq(c0.potLiabilityLamports.toNumber());
    await expectFail(claim(h, f, buyer, desks[2]), "TierVoided");
    await expectFail(upgrade(h, f, buyer, desks[2], 4), "TierVoided");
    await transferDeskAsset(h, desks[2], f.deskCollection, buyer, owners[2].publicKey);
    await expectFail(claim(h, f, owners[2], desks[2]), "TierVoided");
    const pot0 = await balance(h, f.pot);
    await activate(h, f, owners[2], desks[2]);
    expect((await balance(h, f.pot)) - pot0).to.eq(K.splitFee(K.STEP_FEE_LAMPORTS).toPot);
    const t2 = await tierOf(h, desks[2]);
    expect(t2.tier).to.eq(1);
    expect(t2.voided).to.eq(false);
    await assertSolvent(h, f);
  });

  it("dust carry: forfeited / floor lamports re-enter the next round's inflow at finalize", async function () {
    this.timeout(180_000);
    await fillToThreshold(h, f);
    const { idx, epoch, config } = await currentEpoch(h, f);
    const carry = Number(big(config.dustScaled) / K.ACC_SCALE);
    expect(carry).to.be.gt(0); // the voided desk's share from the previous test
    const booked = epoch.inflowLamports.toNumber();
    await finalizeIdx(h, f, idx);
    const e = await h.program.account.epoch.fetch(epochPda(h.program.programId, idx)[0]);
    expect(e.inflowLamports.toNumber()).to.eq(booked + carry);
    expect(Number(big((await h.program.account.config.fetch(f.config)).dustScaled))).to.be.lt(
      Number(K.ACC_SCALE),
    );
    await assertSolvent(h, f);
  });

  it("record_burn reimburses keeper up to burn-pending; over-spend and replay rejected", async () => {
    const pending = (
      await h.program.account.burnState.fetch(f.burn)
    ).burnPendingLamports.toNumber();
    expect(pending).to.be.gt(0);
    const sig = Array.from(Keypair.generate().secretKey); // unique 64 bytes per run (replay guard)
    await expectFail(recordBurn(h, f, 1_000, pending + 1, sig), "BurnExceedsPending");
    const k0 = await balance(h, h.payer.publicKey);
    const pot0 = await balance(h, f.pot);
    const tx = await recordBurn(h, f, 1_000_000, pending, sig);
    // The localnet mint wallet holds 5e8 SOL (> 2^53 lamports), so JS numbers lose ≤ 64 lamports
    // of precision on the keeper side; the pot side is small and checked exactly.
    const keeperDelta = (await balance(h, h.payer.publicKey)) - k0;
    expect(Math.abs(keeperDelta - (pending - (await txFee(h, tx))))).to.be.lte(64);
    expect(pot0 - (await balance(h, f.pot))).to.eq(pending);
    const b = await h.program.account.burnState.fetch(f.burn);
    expect(b.burnPendingLamports.toNumber()).to.eq(0);
    expect(b.totalHubBurned.toNumber()).to.be.gte(1_000_000);
    await expectFail(recordBurn(h, f, 1, 1, sig));
    await assertSolvent(h, f);
  });
});
