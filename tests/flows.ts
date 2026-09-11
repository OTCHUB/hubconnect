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
import { epochPda, tierPda, otcPayPda, vaultPda } from "../sdk/src/pda";
import * as K from "../sdk/src/constants";
import { MOCK_JUPITER_PROGRAM, mockRoute } from "../scripts/lib/mock-jupiter";

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
      tokenomics: f.tokenomics,
      treasuryLockVault: f.treasuryLockVault,
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
      tokenomics: f.tokenomics,
      treasuryLockVault: f.treasuryLockVault,
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

/** §A4.1 #15 (revised) — authority toggles the on/off switch only; pricing is a live Jupiter
 * quote supplied per-call now (see `otcPotLeg` in `sdk/src/constants.ts`), not a stored rate. */
export function setOtcPaymentsEnabled(h: Harness, f: Fixture, enabled: boolean) {
  const [otcPay] = otcPayPda(h.program.programId);
  return h.program.methods
    .setOtcPaymentsEnabled(enabled)
    .accountsPartial({ authority: h.payer.publicKey, config: f.config, otcPay })
    .rpc();
}

/** Accounts shared by both $OTC payment instructions: the $OTC-side pieces (pay config, mint,
 * yield-vault bookkeeping) plus the Jupiter program pinned for the swap-burn CPI. The flat SOL
 * fee (pot/ops/epoch) and $HUB-burn pieces are wired by the caller, exactly like the SOL path —
 * there is no more `opsOtcAccount`: the ops leg is paid in SOL now, not $OTC.
 *
 * On real mainnet accounts $OTC/basket mints are Token-2022 and $HUB is classic Token, hence the
 * two distinct `otcTokenProgram`/`hubTokenProgram` accounts on `ActivateTierOtc`/`UpgradeTierOtc`
 * (see `otc_pay.rs`). This harness's mock `otcMint`/`hubMint` (`ensureInitialized`) are both
 * plain classic-SPL test mints, so both accounts point at the same classic `TOKEN_PROGRAM_ID`
 * here — only the real basket needs Token-2022. */
async function otcPayAccounts(h: Harness, f: Fixture) {
  const [otcPay] = otcPayPda(h.program.programId);
  const c = await h.program.account.config.fetch(f.config);
  return {
    otcPay,
    otcMint: c.otcMint,
    otcPot: f.otcPot,
    otcVault: f.otcVault,
    hubMint: c.hubMint,
    otcTokenProgram: TOKEN_PROGRAM_ID,
    hubTokenProgram: TOKEN_PROGRAM_ID,
    jupiterProgram: new PublicKey(K.JUPITER_PROGRAM_ID),
    tokenomics: f.tokenomics,
    treasuryLockVault: f.treasuryLockVault,
  };
}

/**
 * §A4.1 #16 (revised) — `activate_tier` paid in $OTC from `payerOtc`: the same flat 0.5 SOL fee
 * as the SOL path (90% pot / 10% ops, booked as inflow) **plus** the $OTC 2× premium —
 * `otcSwapAmount` swapped $OTC→$HUB via Jupiter (`min_out = hub_cost_delta`, burned in full) and
 * an equal-scaled amount injected into the $OTC yield vault (see `otcPotLeg`). `jupiterData` /
 * `remainingAccounts` are the caller-assembled Jupiter route (`payer` signs directly, no PDA) —
 * empty defaults only satisfy the SOL-side fee path; a real swap needs a real Jupiter quote
 * (blocked on the pending localnet Jupiter V6 clone, see Anchor.toml task).
 */
export async function activateOtc(
  h: Harness,
  f: Fixture,
  owner: Keypair,
  asset: PublicKey,
  payerOtc: PublicKey,
  otcSwapAmount: number | bigint,
  jupiterData: Buffer = Buffer.alloc(0),
  remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [],
) {
  const { key: epoch } = await currentEpoch(h, f);
  const [deskTier] = tierPda(h.program.programId, asset);
  const payerHub = await ensureHubBalance(h, f, owner.publicKey);
  await h.program.methods
    .activateTierOtc(1, bn(otcSwapAmount), jupiterData)
    .accountsPartial({
      payer: owner.publicKey,
      deskAsset: asset,
      config: f.config,
      epoch,
      pot: f.pot,
      opsWallet: f.opsWallet,
      ...(await otcPayAccounts(h, f)),
      payerOtc,
      payerHub,
      deskTier,
    })
    .remainingAccounts(remainingAccounts)
    .signers([owner])
    .rpc();
  return deskTier;
}

/** §A4.1 #17 (revised) — `upgrade_tier` paid in $OTC from `payerOtc`; see `activateOtc` for the
 * flat-fee + swap-burn/desk-pot split. Ownership change → void, no charge, like the SOL path. */
export async function upgradeOtc(
  h: Harness,
  f: Fixture,
  owner: Keypair,
  asset: PublicKey,
  target: number,
  payerOtc: PublicKey,
  otcSwapAmount: number | bigint,
  jupiterData: Buffer = Buffer.alloc(0),
  remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [],
) {
  const { key: epoch } = await currentEpoch(h, f);
  const [deskTier] = tierPda(h.program.programId, asset);
  const payerHub = await ensureHubBalance(h, f, owner.publicKey);
  return h.program.methods
    .upgradeTierOtc(target, bn(otcSwapAmount), jupiterData)
    .accountsPartial({
      payer: owner.publicKey,
      deskAsset: asset,
      config: f.config,
      epoch,
      pot: f.pot,
      opsWallet: f.opsWallet,
      ...(await otcPayAccounts(h, f)),
      payerOtc,
      payerHub,
      deskTier,
    })
    .remainingAccounts(remainingAccounts)
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
  if (process.env.HUB_DEBUG_FINALIZE) {
    const c = await h.program.account.config.fetch(f.config);
    console.log(
      `[settleOtcPending debug] pending=${pending} potLiability=${c.potLiabilityLamports.toString()}`,
    );
  }
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

/**
 * §A5 revenue-model extension — `register_treasury_inflow` skims `Config.protocol_fee_bp` to
 * `ops_wallet` (floor-divided per on-chain `bps_of`) before booking the remainder as epoch
 * inflow, so sending `net` lamports via `inflow(...)` only books `net − ⌊net × feeBp / BPS⌋`.
 * This inverts that: the minimal gross amount to hand `inflow(...)` so the *booked* (net) delta
 * equals exactly `net`, exact for any `feeBp` (not just the current 1_000 / 10%).
 */
export function grossForInflow(net: number, feeBp: number): number {
  if (net <= 0) return 0;
  if (feeBp === 0) return net;
  const netOf = (gross: number) => gross - Math.floor((gross * feeBp) / K.BPS);
  let gross = Math.ceil((net * K.BPS) / (K.BPS - feeBp));
  while (netOf(gross) < net) gross++;
  while (gross > 0 && netOf(gross - 1) >= net) gross--;
  return gross;
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
      opsWallet: f.opsWallet,
    })
    .signers([f.treasury])
    .rpc();
}

/**
 * Raw finalize of `idx` (no waiting) — also used for negative cases. On success, immediately
 * settles the round's $OTC leg (see `settleOtcPending`) so claims never hit `NoOtcPurchased`.
 *
 * §A5: the 5%/2.5%/2.5% burn/lp/treasury-float legs are now swapped SOL→$HUB inside
 * `finalize_epoch` via a **two-hop** synchronous CPI: hop1 WSOL→USDC via a caller-assembled
 * Jupiter route, hop2 USDC→$HUB via a **direct Raydium CP-Swap CPI**
 * (`raydium_cpswap::swap_base_input`) that needs no off-chain instruction data (hub builds its
 * own `(discriminator, amount_in, minimum_amount_out)` payload), only its fixed 13-account list.
 * So the account list grew (vault/hub_mint/vault_wsol/vault_usdc/vault_hub/treasury_float_vault/
 * jupiter_program) and the ix takes `minUsdcOut` + `minHubOut` + `hop1AccountCount` + `hop1Data`
 * (+ `remainingAccounts`, hop1's caller-assembled route accounts followed by hop2's Raydium
 * accounts, split on-chain at `hop1AccountCount`).
 *
 * On localnet, unless the caller supplies its own `remainingAccounts`, this auto-assembles both
 * hops against `programs/mock_jupiter` (see `scripts/lib/mock-jupiter.ts`) at a fixed synthetic
 * 1:1 fill rate — mirrors `scripts/devnet-yield-cycle.ts`'s `buildFinalizeSwap`. hop2 works
 * against the *same* mock program as hop1: `constants::RAYDIUM_CP_SWAP_PROGRAM_ID` redirects to
 * `programs/mock_jupiter`'s id under the `mock-jupiter` Cargo feature exactly like
 * `JUPITER_PROGRAM_ID` does, and that crate's `swap_base_input` instruction is named to match so
 * Anchor's own discriminator hash lands on the bytes hub hardcodes — so `mockRoute`'s account
 * list (built for hop1's `mock_swap`) is byte-for-byte reusable for hop2 too, just without its
 * `jupiterData` (hub builds hop2's instruction data itself, it never reads a caller-supplied
 * blob for that leg). This only works because the local build now always carries hub's
 * `mock-jupiter` Cargo feature (see package.json's `test` script), which repoints both
 * `constants::JUPITER_PROGRAM_ID` and `constants::RAYDIUM_CP_SWAP_PROGRAM_ID` at
 * `programs/mock_jupiter`'s id, and because `ensureInitialized` pre-funds that mock's USDC and
 * $HUB liquidity reserves. `test:devnet` (HUB_CLUSTER=devnet) is untouched — real Jupiter/Raydium
 * or a devnet-provisioned mock route only, via explicit `swap` args.
 */
export async function finalizeIdx(
  h: Harness,
  f: Fixture,
  idx: number,
  swap: {
    minUsdcOut?: number | bigint;
    minHubOut?: number | bigint;
    hop1AccountCount?: number;
    hop1Data?: Buffer;
    remainingAccounts?: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
    jupiterProgram?: PublicKey;
    raydiumProgram?: PublicKey;
  } = {},
) {
  const [epoch] = epochPda(h.program.programId, idx);
  const [nextEpoch] = epochPda(h.program.programId, idx + 1);
  const [vault] = vaultPda(h.program.programId);
  const cfg = await h.program.account.config.fetch(f.config);
  const treasury = await h.program.account.treasuryState.fetch(f.treasuryState);

  let built: Partial<{
    minUsdcOut: number;
    minHubOut: number;
    hop1AccountCount: number;
    hop1Data: Buffer;
    remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[];
  }> = {};
  if (h.cluster === "localnet" && swap.remainingAccounts === undefined) {
    const epochAcct = await h.program.account.epoch.fetch(epoch);
    // Mirrors on-chain `finalize_epoch`: the burn/lp/float skim is computed from this epoch's own
    // fresh inflow only — the whole-lamport dust carry (round_credit slack + void_tier forfeitures)
    // bypasses the skim entirely and is folded straight into the round's distributable pool.
    const fresh = epochAcct.inflowLamports.toNumber();
    const bpsOf = (bp: number) => Math.floor((fresh * bp) / K.BPS);
    const swapTotal = bpsOf(cfg.burnPctBp) + bpsOf(cfg.lpPctBp) + bpsOf(cfg.treasuryFloatPctBp);
    if (swapTotal > 0) {
      const hop1 = mockRoute({
        sourceAuthority: vault,
        sourceAuthorityIsSigner: false, // vault is a PDA; hub re-signs via invoke_signed
        sourceTokenAccount: treasury.vaultWsol,
        sourceMint: new PublicKey(K.WSOL_MINT),
        destinationTokenAccount: treasury.vaultUsdc,
        destinationMint: cfg.usdcMint,
        amountIn: swapTotal,
        amountOut: swapTotal,
      });
      // hop2's account list is the same shape as hop1's mock — see doc comment above — just
      // targeting vault_usdc → vault_hub instead of vault_wsol → vault_usdc; its `jupiterData` is
      // discarded, hub builds hop2's own instruction data on-chain.
      const hop2 = mockRoute({
        sourceAuthority: vault,
        sourceAuthorityIsSigner: false,
        sourceTokenAccount: treasury.vaultUsdc,
        sourceMint: cfg.usdcMint,
        destinationTokenAccount: treasury.vaultHub,
        destinationMint: cfg.hubMint,
        amountIn: swapTotal,
        amountOut: swapTotal,
      });
      built = {
        minUsdcOut: swapTotal,
        minHubOut: swapTotal,
        hop1AccountCount: hop1.remainingAccounts.length,
        hop1Data: hop1.jupiterData,
        remainingAccounts: [...hop1.remainingAccounts, ...hop2.remainingAccounts],
      };
    }
  }

  const sig = await h.program.methods
    .finalizeEpoch(
      bn(idx),
      bn(swap.minUsdcOut ?? built.minUsdcOut ?? 0),
      bn(swap.minHubOut ?? built.minHubOut ?? 0),
      swap.hop1AccountCount ?? built.hop1AccountCount ?? 0,
      swap.hop1Data ?? built.hop1Data ?? Buffer.alloc(0),
    )
    .accountsPartial({
      keeper: h.payer.publicKey,
      config: f.config,
      epoch,
      nextEpoch,
      pot: f.pot,
      burn: f.burn,
      otcPot: f.otcPot,
      treasuryState: f.treasuryState,
      vault,
      hubMint: cfg.hubMint,
      vaultWsol: treasury.vaultWsol,
      vaultUsdc: treasury.vaultUsdc,
      vaultHub: treasury.vaultHub,
      treasuryFloatVault: treasury.treasuryFloatVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      jupiterProgram:
        swap.jupiterProgram ??
        (h.cluster === "localnet" ? MOCK_JUPITER_PROGRAM : new PublicKey(K.JUPITER_PROGRAM_ID)),
      raydiumProgram:
        swap.raydiumProgram ??
        (h.cluster === "localnet"
          ? MOCK_JUPITER_PROGRAM
          : new PublicKey(K.RAYDIUM_CP_SWAP_PROGRAM_ID)),
    })
    .remainingAccounts(swap.remainingAccounts ?? built.remainingAccounts ?? [])
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
  if (short > 0) await inflow(h, f, "c", grossForInflow(short, config.protocolFeeBp));
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
 * lifetime average buy rate (`total_otc_bought_units / total_lamports_spent`) — mirrors
 * `claim_yield`'s on-chain formula exactly. `settleOtcPending` keeps that rate at 1 on its own,
 * but `activate_tier_otc` / `upgrade_tier_otc`'s desk-pot leg also raises
 * `total_otc_bought_units` without a matching `total_lamports_spent`, so the rate can be > 1 by
 * the time this runs; recomputing it live (rather than assuming 1:1) keeps this helper correct
 * either way. Returns $OTC base units received (0 → no claim sent).
 */
export async function claimPending(h: Harness, f: Fixture, owner: Keypair, asset: PublicKey) {
  const owed = await pendingOf(h, f, asset);
  if (owed === 0) return 0;
  const p = await h.program.account.otcPotState.fetch(f.otcPot);
  const expected = Number((BigInt(owed) * big(p.totalOtcBoughtUnits)) / big(p.totalLamportsSpent));
  const claimerOtc = await ensureOtcAccount(h, f, owner.publicKey);
  const b0 = await tokenBalance(h, claimerOtc);
  await claim(h, f, owner, asset);
  const got = Number((await tokenBalance(h, claimerOtc)) - b0);
  expect(got, "single-tx claim (paid in $OTC at the pot's lifetime average buy rate)").to.eq(
    expected,
  );
  const t = await h.program.account.deskTier.fetch(tierPda(h.program.programId, asset)[0]);
  const c = await h.program.account.config.fetch(f.config);
  expect(t.stampAccPerWeight.eq(c.accPerWeight), "stamp == acc").to.eq(true);
  // `total_claimed_lamports` is lamport-denominated (it accumulates `owed`, not the $OTC units
  // paid out) — compare against `owed`, not `got`, since the buy rate can be != 1.
  expect(t.totalClaimedLamports.toNumber(), "lifetime ledger").to.be.gte(owed);
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
