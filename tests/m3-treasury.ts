// M3 — LP gates (§A6.2, §A5.1 MemeStock basket extension).
import { Transaction } from "@solana/web3.js";
import {
  setup,
  Harness,
  ensureInitialized,
  Fixture,
  expectFail,
  fundWallet,
  TOKEN_PROGRAM_ID,
  createSplMint,
  createAtaIx,
  ata,
} from "./harness";
import { setConfig, bn } from "./flows";
import { vaultPda, hubPotPda } from "../sdk/src/pda";
import * as K from "../sdk/src/constants";

describe("M3 — LP", () => {
  let h: Harness;
  let f: Fixture;

  before(async function () {
    this.timeout(120_000);
    h = await setup();
    f = await ensureInitialized(h);
  });

  it("build_lp: rejected while lp_enabled=false; HUB/OTC gated by phase-2; HUB/SOL needs AMM accounts", async () => {
    const call = (pair: "hubSol" | "hubOtc") =>
      h.program.methods
        .buildLp({ [pair]: {} } as never, bn(1_000), bn(1_000))
        .accountsPartial({
          treasury: f.treasury.publicKey,
          config: f.config,
          treasuryState: f.treasuryState,
          lpVault: f.vault,
        })
        .signers([f.treasury])
        .rpc();
    await expectFail(call("hubSol"), "LpDisabled");
    await setConfig(h, f, "lpEnabled", { bool: [true] });
    await expectFail(call("hubOtc"), "LpPhase2Gated");
    await expectFail(call("hubSol"), "LpAccountsMissing");
    await setConfig(h, f, "lpEnabled", { bool: [false] });
  });

  it("compound_lp_otc: permissionless (no has_one) — gated by lp_enabled, then phase-2, then the pending-earmark dust floor", async () => {
    const ts = await h.program.account.treasuryState.fetch(f.treasuryState);
    // A random keypair, never registered as `treasury` anywhere — proves the instruction has no
    // `has_one = treasury` (or any other allow-list) check, mirroring `finalize_epoch`'s
    // `keeper: Signer` posture. If it were permissioned like `build_lp`, every call below would
    // fail with `Unauthorized`/`ConstraintHasOne` instead of the program-logic errors asserted.
    const randomKeeper = await fundWallet(h, 1_000_000);
    const call = (otcAmount = 0, lpTokenAmount = 0) =>
      h.program.methods
        .compoundLpOtc(bn(otcAmount), bn(lpTokenAmount), 0, false)
        .accountsPartial({
          keeper: randomKeeper.publicKey,
          config: f.config,
          treasuryState: f.treasuryState,
          vault: f.vault,
          hubMint: f.hubMint,
          vaultHub: ts.vaultHub,
          burn: f.burn,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([randomKeeper])
        .rpc();

    await expectFail(call(), "LpDisabled");
    await setConfig(h, f, "lpEnabled", { bool: [true] });
    await expectFail(call(), "LpPhase2Gated");
    await setConfig(h, f, "lpPhase2OpenTs", { i64: [bn(1)] });
    // `lp_pending_hub_units` is a singleton bucket shared with the M2 suite, which runs real
    // (mock) Jupiter swaps in `finalize_epoch` — by the time this test runs it may already sit
    // at/above `LP_COMPOUND_MIN_HUB_UNITS` instead of the pristine-zero state this suite used to
    // be able to assume. Assert whichever real gate that leaves live instead of hardcoding a
    // value this suite doesn't control.
    const pendingNow = (
      await h.program.account.treasuryState.fetch(f.treasuryState)
    ).lpPendingHubUnits.toNumber();
    if (pendingNow < K.LP_COMPOUND_MIN_HUB_UNITS) {
      await expectFail(call(), "LpCompoundBelowThreshold");
    } else {
      // Past the dust floor — a zero otc/lp amount now hits the next real gate instead.
      await expectFail(call(), "ZeroAmount");
      // This is as far as this suite can exercise on-chain without a live Raydium pool (see
      // `build_lp_otc_locked`'s tests for the same limitation); the deposit/cap/burn-excess path
      // itself is exercised once genuine local Raydium pools land.
      await expectFail(call(1, 1), "LpAccountsMissing");
    }

    await setConfig(h, f, "lpEnabled", { bool: [false] });
    await setConfig(h, f, "lpPhase2OpenTs", { i64: [bn(0)] });
  });

  it("build_lp_basket_locked: treasury-signed; gated by lp_enabled, then phase-2, then needs Raydium accounts", async () => {
    const [vault] = vaultPda(h.program.programId);
    const call = () =>
      h.program.methods
        .buildLpBasketLocked({ hubCrclx: {} } as never, bn(1_000), bn(1_000), bn(1), 0, false)
        .accountsPartial({
          treasury: f.treasury.publicKey,
          config: f.config,
          treasuryState: f.treasuryState,
          vault,
        })
        .signers([f.treasury])
        .rpc();
    await expectFail(call(), "LpDisabled");
    await setConfig(h, f, "lpEnabled", { bool: [true] });
    await expectFail(call(), "LpPhase2Gated");
    await setConfig(h, f, "lpPhase2OpenTs", { i64: [bn(1)] });
    await expectFail(call(), "LpAccountsMissing");
    await setConfig(h, f, "lpEnabled", { bool: [false] });
    await setConfig(h, f, "lpPhase2OpenTs", { i64: [bn(0)] });
  });

  it("compound_lp_basket: permissionless (no has_one) — gated by lp_enabled, then requires an already-seeded basket position", async () => {
    const [vault] = vaultPda(h.program.programId);
    const randomKeeper = await fundWallet(h, 1_000_000);
    const call = () =>
      h.program.methods
        .compoundLpBasket({ hubCrclx: {} } as never, bn(0), bn(0), 0, false)
        .accountsPartial({
          keeper: randomKeeper.publicKey,
          config: f.config,
          treasuryState: f.treasuryState,
          vault,
        })
        .signers([randomKeeper])
        .rpc();
    await expectFail(call(), "LpDisabled");
    await setConfig(h, f, "lpEnabled", { bool: [true] });
    // No `build_lp_basket_locked` has ever succeeded on this suite (blocked on live Raydium
    // pools, same limitation as `compound_lp_otc`'s test above) — `lp_basket_active` stays
    // false, so this is as far as this suite can exercise on-chain.
    await expectFail(call(), "InvalidLpPair");
    await setConfig(h, f, "lpEnabled", { bool: [false] });
  });

  it("harvest_lp_fees: quote_vault must match the HUB Pot's own bucket vault; requires an already-locked position", async () => {
    const [vault] = vaultPda(h.program.programId);
    const [hubPot] = hubPotPda(h.program.programId);
    const crclxMint = await createSplMint(h, 6);
    const nvdaxMint = await createSplMint(h, 6);
    const spcxxMint = await createSplMint(h, 6);
    const otcVault = ata(vault, f.otcMint);
    const crclxVault = ata(vault, crclxMint);
    const nvdaxVault = ata(vault, nvdaxMint);
    const spcxxVault = ata(vault, spcxxMint);
    await h.provider.sendAndConfirm(
      new Transaction().add(
        createAtaIx(h.payer.publicKey, vault, f.otcMint),
        createAtaIx(h.payer.publicKey, vault, crclxMint),
        createAtaIx(h.payer.publicKey, vault, nvdaxMint),
        createAtaIx(h.payer.publicKey, vault, spcxxMint),
      ),
      [h.payer],
    );
    await h.program.methods
      .initHubPot(f.otcMint, crclxMint, nvdaxMint, spcxxMint)
      .accountsPartial({
        authority: h.payer.publicKey,
        config: f.config,
        treasuryState: f.treasuryState,
        vault,
        otcVault,
        crclxVault,
        nvdaxVault,
        spcxxVault,
        hubPot,
      })
      .rpc();

    const ts = await h.program.account.treasuryState.fetch(f.treasuryState);
    const call = (quoteVault: typeof otcVault) =>
      h.program.methods
        .harvestLpFees({ hubCrclx: {} } as never)
        .accountsPartial({
          keeper: h.payer.publicKey,
          config: f.config,
          treasuryState: f.treasuryState,
          hubPot,
          vault,
          vaultHub: ts.vaultHub,
          quoteVault,
        })
        .rpc();
    // Wrong bucket vault for `HubCrclx` (this is the $OTC bucket's vault).
    await expectFail(call(otcVault), "InvalidTokenAccount");
    // Right vault, but no `build_lp_basket_locked` has ever succeeded (same live-Raydium-pool
    // limitation as above) — `lp_basket_active` stays false.
    await expectFail(call(crclxVault), "InvalidLpPair");
  });
});
