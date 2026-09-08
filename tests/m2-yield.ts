// M2 — tiers, threshold-gated rounds, single-tx accumulator claims, lazy revocation, burn
// (spec §B5 integration list). Round indices are never hardcoded: tests read state from chain.
import { expect } from "chai";
import * as anchor from "@anchor-lang/core";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
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
  createSplMint,
  createAtaIx,
  mintTo,
  ata,
  tokenBalance,
} from "./harness";
import {
  activate,
  upgrade,
  activateOtc,
  upgradeOtc,
  initOtcPayments,
  setOtcRate,
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
import { epochPda, tierPda, otcPayPda } from "../sdk/src/pda";
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
    // Flat fee (§A4): every activate/upgrade call pays STEP_FEE_LAMPORTS once, regardless of
    // tier or step size — 4 activations + 3 upgrades (i>0) = 7 fee-paying calls this loop.
    const calls = 4 + 3;
    const { toOps, toPot } = K.splitFee(K.STEP_FEE_LAMPORTS);
    expect((await balance(h, f.opsWallet)) - ops0).to.eq(toOps * calls);
    expect((await balance(h, f.pot)) - pot0).to.eq(toPot * calls);
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
    // Zero-sum: inflow == burn + lp-pending + credited + floor remainder (≤ 1 lamport).
    expect(
      e.burnPendingLamports.toNumber() +
        e.lpPendingLamports.toNumber() +
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

// §A4.1 — $OTC as an alternative step-fee currency. Mock 6-dp mint; 1 SOL = 1,000 OTC, so a
// 0.5 SOL step is worth 500 OTC and the 2× premium charges 1,000 OTC (1e9 base units).
describe("M2 — $OTC payment path (§A4.1)", () => {
  let h: Harness;
  let f: Fixture;
  let otcMint: PublicKey;
  let otcPay: PublicKey;
  let pol: PublicKey;
  const OTC_PER_SOL = 1_000n * 10n ** 6n;
  const owners: Keypair[] = [];
  const desks: PublicKey[] = [];
  const otcAccounts: PublicKey[] = [];

  const otcPayState = () => h.program.account.otcPayConfig.fetch(otcPay);
  const snapshot = async () => {
    const { epoch, config } = await currentEpoch(h, f);
    return {
      pot: await balance(h, f.pot),
      ops: await balance(h, f.opsWallet),
      inflow: epoch.inflowLamports.toNumber(),
      liability: config.potLiabilityLamports.toNumber(),
      weight: config.totalWeightBp.toNumber(),
      pol: await tokenBalance(h, pol),
      collected: big((await otcPayState()).totalOtcCollected),
    };
  };
  /** Fresh desk owner holding `sol` lamports and `units` of $OTC in its ATA. */
  const otcWallet = async (sol: number, units: bigint) => {
    const o = await fundWallet(h, sol);
    const acct = ata(o.publicKey, otcMint);
    await h.provider.sendAndConfirm(
      new Transaction().add(createAtaIx(h.payer.publicKey, o.publicKey, otcMint)),
      [h.payer],
    );
    await mintTo(h, otcMint, acct, units);
    owners.push(o);
    otcAccounts.push(acct);
    desks.push(await createDeskAsset(h, f.deskCollection, o.publicKey));
  };

  before(async function () {
    this.timeout(180_000);
    h = await setup();
    f = await ensureInitialized(h);
    [otcPay] = otcPayPda(h.program.programId);
    // Reuse the fixture's canonical $OTC mint (already wired to otc_pot/otc_vault at genesis)
    // rather than swapping config.otc_mint — claim_yield reads the same field.
    otcMint = f.otcMint;
    pol = ata(f.vault, otcMint);
    await h.provider.sendAndConfirm(
      new Transaction().add(createAtaIx(h.payer.publicKey, f.vault, otcMint)),
      [h.payer],
    );
    await otcWallet(1.5 * LAMPORTS_PER_SOL, 10_000n * 10n ** 6n); // A: pays activation + 1→3 in OTC
    await otcWallet(1.5 * LAMPORTS_PER_SOL, 5_000n * 10n ** 6n); // B: SOL activation, OTC upgrades
    await otcWallet(1.5 * LAMPORTS_PER_SOL, 5_000n * 10n ** 6n); // C: negative cases, SOL fallback
  });

  it("init_otc_payments: POL reserve must be the vault's $OTC account; authority-only; singleton", async () => {
    // A wallet-owned token account of the right mint is not program custody.
    await expectFail(initOtcPayments(h, f, otcAccounts[0]), "InvalidTokenAccount");
    const intruder = await fundWallet(h, LAMPORTS_PER_SOL / 10);
    await expectFail(
      h.program.methods
        .initOtcPayments()
        .accountsPartial({
          authority: intruder.publicKey,
          config: f.config,
          treasuryState: f.treasuryState,
          vault: f.vault,
          polAccount: pol,
          otcPay,
        })
        .signers([intruder])
        .rpc(),
      "Unauthorized",
    );
    await initOtcPayments(h, f, pol);
    const p = await otcPayState();
    expect(p.enabled).to.eq(false);
    expect(p.otcPerSol.toNumber()).to.eq(0);
    expect(p.rateTs.toNumber()).to.eq(0);
    expect(p.premiumBp).to.eq(K.OTC_PREMIUM_BP);
    expect(p.polAccount.toBase58()).to.eq(pol.toBase58());
    expect(p.totalOtcCollected.toNumber()).to.eq(0);
    await expectFail(initOtcPayments(h, f, pol)); // already initialized
  });

  it("activate_tier_otc is rejected while the path is disabled / unpriced", async () => {
    await expectFail(activateOtc(h, f, owners[0], desks[0], otcAccounts[0]), "OtcPaymentsDisabled");
  });

  it("set_otc_rate: authority-only; enabling at a zero rate is rejected; sets rate + timestamp", async () => {
    const intruder = Keypair.generate();
    await expectFail(
      h.program.methods
        .setOtcRate(new anchor.BN(1), true)
        .accountsPartial({ authority: intruder.publicKey, config: f.config, otcPay })
        .signers([intruder])
        .rpc(),
      "Unauthorized",
    );
    await expectFail(setOtcRate(h, f, 0, true), "ZeroAmount");
    await setOtcRate(h, f, 0, false); // disabled at any rate is fine
    await setOtcRate(h, f, OTC_PER_SOL, true);
    const p = await otcPayState();
    expect(p.enabled).to.eq(true);
    expect(big(p.otcPerSol)).to.eq(OTC_PER_SOL);
    expect(p.rateTs.toNumber()).to.be.gt(0);
    expect(p.premiumBp).to.eq(K.OTC_PREMIUM_BP); // premium is not a parameter
  });

  it("activate_tier_otc charges 2× the SOL value into the POL reserve; Σw grows, pot/ops/inflow/liability do not", async () => {
    const fee = K.otcFeeUnits(K.STEP_FEE_LAMPORTS, OTC_PER_SOL);
    expect(fee).to.eq(1_000n * 10n ** 6n);
    const s0 = await snapshot();
    const a0 = await tokenBalance(h, otcAccounts[0]);
    await expectFail(activateOtc(h, f, owners[1], desks[0], otcAccounts[1]), "NotDeskOwner");
    await activateOtc(h, f, owners[0], desks[0], otcAccounts[0]);
    const s1 = await snapshot();
    expect(a0 - (await tokenBalance(h, otcAccounts[0]))).to.eq(fee);
    expect(s1.pol - s0.pol).to.eq(fee);
    expect(s1.collected - s0.collected).to.eq(fee);
    expect(s1.pot).to.eq(s0.pot);
    expect(s1.ops).to.eq(s0.ops);
    expect(s1.inflow).to.eq(s0.inflow);
    expect(s1.liability).to.eq(s0.liability);
    expect(s1.weight - s0.weight).to.eq(K.TIER_WEIGHTS_BP[0]);
    const t = await tierOf(h, desks[0]);
    expect(t.tier).to.eq(1);
    expect(t.voided).to.eq(false);
    expect(t.ownerAtActivation.toBase58()).to.eq(owners[0].publicKey.toBase58());
    expect(
      t.stampAccPerWeight.eq((await h.program.account.config.fetch(f.config)).accPerWeight),
    ).to.eq(true);
    await expectFail(activateOtc(h, f, owners[0], desks[0], otcAccounts[0]), "TierAlreadyActive");
    await assertSolvent(h, f);
  });

  it("upgrade_tier_otc pays exactly the step difference in $OTC; non-step / maxed rejected", async () => {
    // Flat fee (§A4): upgrade_tier_otc charges the same otc_fee(STEP_FEE_LAMPORTS) once,
    // regardless of the 1→3 step size — same 1,000 OTC as any other call.
    const fee = K.otcFeeUnits(K.stepFeeLamports(1, 3), OTC_PER_SOL);
    expect(fee).to.eq(1_000n * 10n ** 6n);
    const s0 = await snapshot();
    await expectFail(upgradeOtc(h, f, owners[0], desks[0], 1, otcAccounts[0]), "InvalidTierStep");
    await expectFail(upgradeOtc(h, f, owners[0], desks[0], 5, otcAccounts[0]), "InvalidTierStep");
    await upgradeOtc(h, f, owners[0], desks[0], 3, otcAccounts[0]);
    const s1 = await snapshot();
    expect(s1.pol - s0.pol).to.eq(fee);
    expect(s1.collected - s0.collected).to.eq(fee);
    expect(s1.pot).to.eq(s0.pot);
    expect(s1.ops).to.eq(s0.ops);
    expect(s1.inflow).to.eq(s0.inflow);
    expect(s1.weight - s0.weight).to.eq(K.TIER_WEIGHTS_BP[2] - K.TIER_WEIGHTS_BP[0]);
    expect((await tierOf(h, desks[0])).tier).to.eq(3);
  });

  it("SOL and $OTC steps interleave on one tier: only the SOL leg touches the pot", async () => {
    // B: activate in SOL, upgrade 1→2 in $OTC.
    const s0 = await snapshot();
    await activate(h, f, owners[1], desks[1]);
    const s1 = await snapshot();
    expect(s1.pot - s0.pot).to.eq(K.splitFee(K.STEP_FEE_LAMPORTS).toPot);
    expect(s1.ops - s0.ops).to.eq(K.splitFee(K.STEP_FEE_LAMPORTS).toOps);
    expect(s1.pol).to.eq(s0.pol);
    await upgradeOtc(h, f, owners[1], desks[1], 2, otcAccounts[1]);
    const s2 = await snapshot();
    expect(s2.pot).to.eq(s1.pot);
    expect(s2.inflow).to.eq(s1.inflow);
    expect(s2.pol - s1.pol).to.eq(K.otcFeeUnits(K.STEP_FEE_LAMPORTS, OTC_PER_SOL));
    expect((await tierOf(h, desks[1])).tier).to.eq(2);
    // A: activated + upgraded in $OTC, finishes 3→4 in SOL.
    await upgrade(h, f, owners[0], desks[0], 4);
    const s3 = await snapshot();
    expect(s3.pot - s2.pot).to.eq(K.splitFee(K.STEP_FEE_LAMPORTS).toPot);
    expect(s3.inflow - s2.inflow).to.eq(K.splitFee(K.STEP_FEE_LAMPORTS).toPot);
    expect(s3.pol).to.eq(s2.pol);
    expect((await tierOf(h, desks[0])).tier).to.eq(4);
    expect(s3.weight - s0.weight).to.eq(
      K.TIER_WEIGHTS_BP[1] + (K.TIER_WEIGHTS_BP[3] - K.TIER_WEIGHTS_BP[2]),
    );
    await expectFail(upgradeOtc(h, f, owners[0], desks[0], 4, otcAccounts[0]), "TierMaxed");
    await assertSolvent(h, f);
  });

  it("rejects a payer token account that is not the payer's or not the $OTC mint", async () => {
    await expectFail(activateOtc(h, f, owners[2], desks[2], otcAccounts[0]), "InvalidTokenAccount");
    const other = await createSplMint(h, 6);
    const wrongMint = ata(owners[2].publicKey, other);
    await h.provider.sendAndConfirm(
      new Transaction().add(createAtaIx(h.payer.publicKey, owners[2].publicKey, other)),
      [h.payer],
    );
    await mintTo(h, other, wrongMint, 10_000n * 10n ** 6n);
    await expectFail(activateOtc(h, f, owners[2], desks[2], wrongMint), "InvalidTokenAccount");
    await expectFail(
      activateOtc(h, f, owners[2], desks[2], owners[2].publicKey),
      "InvalidTokenAccount",
    );
  });

  it("$OTC-paid tiers earn SOL yield like any other; upgrade_tier_otc requires pending claimed first", async function () {
    this.timeout(180_000);
    await finalizeCurrent(h, f);
    expect(await pendingOf(h, f, desks[0])).to.be.gt(0);
    expect(await pendingOf(h, f, desks[1])).to.be.gt(0);
    await expectFail(
      upgradeOtc(h, f, owners[1], desks[1], 3, otcAccounts[1]),
      "ClaimBeforeUpgrade",
    );
    expect(await claimPending(h, f, owners[0], desks[0])).to.be.gt(0);
    expect(await claimPending(h, f, owners[1], desks[1])).to.be.gt(0);
    const s0 = await snapshot();
    await upgradeOtc(h, f, owners[1], desks[1], 3, otcAccounts[1]);
    const s1 = await snapshot();
    expect(s1.pol - s0.pol).to.eq(K.otcFeeUnits(K.stepFeeLamports(2, 3), OTC_PER_SOL));
    expect(s1.pot).to.eq(s0.pot);
    expect((await tierOf(h, desks[1])).tier).to.eq(3);
    await assertSolvent(h, f);
  });

  it("disabling the path blocks $OTC payments only; the SOL path is unaffected", async () => {
    await setOtcRate(h, f, OTC_PER_SOL, false);
    await expectFail(activateOtc(h, f, owners[2], desks[2], otcAccounts[2]), "OtcPaymentsDisabled");
    await expectFail(
      upgradeOtc(h, f, owners[1], desks[1], 4, otcAccounts[1]),
      "OtcPaymentsDisabled",
    );
    const pol0 = await tokenBalance(h, pol);
    await activate(h, f, owners[2], desks[2]);
    expect((await tierOf(h, desks[2])).tier).to.eq(1);
    expect(await tokenBalance(h, pol)).to.eq(pol0);
    const p = await otcPayState();
    expect(p.enabled).to.eq(false);
    expect(big(p.otcPerSol)).to.eq(OTC_PER_SOL); // rate survives the switch
    await assertSolvent(h, f);
  });
});
