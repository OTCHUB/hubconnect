// Read-only program state access for the web dashboard, keepers, and the otchub Part C panel.
// No wallet required: decodes accounts via the IDL and returns plain JS numbers (lamports fit
// safely in Number up to 9e15 ≈ 9M SOL).
import { AnchorProvider, BorshAccountsCoder, Idl, Program } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../idl/hub.json";
import type { Hub } from "../idl/hub";
import {
  burnPda,
  configPda,
  epochPda,
  otcPotPda,
  creatorFeePda,
  potPda,
  tierPda,
  treasuryPda,
  vaultPda,
  otcPayPda,
  tokenomicsPda,
  airdropClaimPda,
  rewardRoundPda,
  rewardClaimPda,
  hubPotPda,
  hubPotRoundPda,
  hubPotClaimPda,
} from "./pda";
import {
  ACC_SCALE,
  BPS,
  HUB_MAX_SUPPLY_UNITS,
  PRICE_STALENESS_SECS,
  TIER_HUB_COST_UNITS,
  TIER_WEIGHTS_BP,
  supplyBreakdown,
  type SupplyBreakdown,
} from "./constants";
import { fetchHubTokenState, type HubTokenState } from "./token";

export const HUB_IDL = idl as Hub;

export type HubProgram = Program<Hub>;

export function programId(): PublicKey {
  return new PublicKey((idl as Idl).address);
}

/** A Program bound to a read-only provider (no signer). */
export function createReader(connection: Connection, id = programId()): HubProgram {
  const provider = new AnchorProvider(connection, {} as never, { commitment: "confirmed" });
  return new Program<Hub>({ ...(idl as Hub), address: id.toBase58() }, provider);
}

export function accountsCoder() {
  return new BorshAccountsCoder(idl as Idl);
}

const n = (v: { toNumber(): number } | number) => (typeof v === "number" ? v : v.toNumber());
// u128 fields (accumulator, dust) exceed Number; keep them as bigint.
const big = (v: { toString(): string }) => BigInt(v.toString());

export type ConfigView = {
  authority: string;
  pot: string;
  opsWallet: string;
  treasury: string;
  otcProgram: string;
  otcDeskPot: string;
  deskCollection: string;
  hubMint: string;
  otcMint: string;
  /** USDC mint used by `finalize_epoch`'s two-hop price-discovery swap (WSOL→USDC→$HUB). */
  usdcMint: string;
  tierWeightsBp: number[];
  stepFeeLamports: number;
  /** Fixed USD target per tier, in micro-USDC (6 decimals) — never changes at runtime. */
  tierUsdCostMicros: number[];
  /** $HUB base units currently equal to `tierUsdCostMicros`, refreshed by `finalize_epoch`'s
   * two-hop Jupiter price observation. Raw cache value — ignores staleness; most callers want
   * `hubCost`/`hubCostDelta` instead, which apply the same `PRICE_STALENESS_SECS` fallback to
   * the ceiling table (`TIER_HUB_COST_UNITS`) the on-chain `Config::hub_cost` uses. */
  tierHubCostUnitsCached: number[];
  /** Unix timestamp of the last eligible price update; 0 = never updated (treated as stale). */
  lastPriceUpdateTs: number;
  /** bp of every tier activation/upgrade's $HUB cost that is burned outright — the remainder
   * funds the active-desk reward pool. */
  tierCostBurnBp: number;
  minPotThresholdLamports: number;
  burnPctBp: number;
  /** §A5 2.5% — swapped SOL→$HUB at finalize and earmarked into `TreasuryView.lpPendingHubUnits`
   * (phase-2 LP build). */
  lpPctBp: number;
  /** §A5 2.5% — earmarked at finalize into `TreasuryState.treasury_float_vault` (buy-and-hold,
   * capped). Together with `burnPctBp` + `lpPctBp`, this is the 10% swapped SOL→$HUB in
   * `finalize_epoch`'s synchronous Jupiter CPI; the remainder is the 90% $OTC leg. */
  treasuryFloatPctBp: number;
  opsPctBp: number;
  lpEnabled: boolean;
  /** §A6.2 phase-2 LP target (lamport-equivalent value) — mirrors `Config.lp_target_sol_lamports`. */
  lpTargetSolLamports: number;
  /** §A6.2 phase-2 gate: HUB/OTC LP opens only after this ts (0 = closed). */
  lpPhase2OpenTs: number;
  paused: boolean;
  currentEpoch: number;
  genesisTs: number;
  totalWeightBp: number;
  potLiabilityLamports: number;
  /** Lifetime Σ(distributable × ACC_SCALE / Σw) over closed rounds. */
  accPerWeight: bigint;
  /** Sub-lamport remainders (× ACC_SCALE); whole lamports re-enter at the next finalize. */
  dustScaled: bigint;
};

/**
 * Live $HUB cost to reach `tier` from scratch — mirrors on-chain `Config::hub_cost` exactly:
 * prefers the price-updated cache (`config.tierHubCostUnitsCached`) when it's fresh, falls back
 * to the genesis/ceiling table (`TIER_HUB_COST_UNITS`) when `lastPriceUpdateTs` is 0 (never
 * updated) or older than `PRICE_STALENESS_SECS` — never trades off a possibly-stale price. Use
 * this (not `TIER_HUB_COST_UNITS` directly) for any UI/quote that should match what the program
 * will actually charge right now.
 */
export function liveHubCostUnits(tier: number, nowTs: number, config: ConfigView): number {
  const idx = tier - 1;
  const ceiling = TIER_HUB_COST_UNITS[idx];
  if (ceiling == null) return 0;
  const stale =
    config.lastPriceUpdateTs === 0 || nowTs - config.lastPriceUpdateTs > PRICE_STALENESS_SECS;
  return stale ? ceiling : (config.tierHubCostUnitsCached[idx] ?? ceiling);
}

/**
 * Live $HUB due for `from` → `to` (`from = 0` is a fresh activation: the full cost of `to`) —
 * mirrors `Config::hub_cost_delta`, built on `liveHubCostUnits` above. An upgrade only ever pays
 * the difference from the tier already held, never the same $HUB twice.
 */
export function liveHubCostDeltaUnits(
  from: number,
  to: number,
  nowTs: number,
  config: ConfigView,
): number {
  const toCost = liveHubCostUnits(to, nowTs, config);
  if (from === 0) return toCost;
  return toCost - liveHubCostUnits(from, nowTs, config);
}

export type EpochView = {
  index: number;
  startTs: number;
  /** 0 while open. */
  finalizedTs: number;
  inflowLamports: number;
  /** §A5 90% $OTC leg's lamport-equivalent value, credited through `accPerWeight` this round. */
  distributedLamports: number;
  burnPendingLamports: number;
  /** §A5 2.5% — SOL input to this round's LP-build leg, swapped to $HUB and added to
   * `TreasuryView.lpPendingHubUnits`. */
  lpPendingLamports: number;
  rolledForwardLamports: number;
  totalWeightBp: number;
  perWeightScaled: bigint;
  accPerWeightAfter: bigint;
  finalized: boolean;
};

export type DeskTierView = {
  assetId: string;
  ownerAtActivation: string;
  tier: number;
  activatedEpoch: number;
  /** `Config.accPerWeight` at activation / last claim. */
  stampAccPerWeight: bigint;
  /** Lifetime SOL this desk has been paid by `claim_yield` (reset on re-activation). */
  totalClaimedLamports: number;
  voided: boolean;
};

/**
 * §A4.1 `OtcPayConfig` (revised) — `null` from `fetchOtcPay` means the path was never
 * initialized. Pricing is no longer a static authority-refreshed rate: the 2× premium is a real
 * synchronous on-chain Jupiter OTC→$HUB swap priced at the live market rate, so this only holds
 * the on/off switch and the dead-reserve pointer — a per-call quote is required to know the
 * current $OTC cost (see `otcPotLeg` in `./constants` for the swap/desk-pot split math).
 */
export type OtcPayView = {
  enabled: boolean;
  /**
   * Vault-owned $OTC token account recorded at `init_otc_payments`. Legacy field: the live
   * activate/upgrade-tier $OTC path no longer routes tokens through it (the swap-burn leg goes
   * to the payer's own $HUB ATA and is burned there; the desk-pot leg lands in `OtcPotState`'s
   * `otc_vault` instead) — kept for account-layout compatibility only.
   */
  polAccount: string;
  /** Lifetime $OTC paid across both legs of every `activate_tier_otc` / `upgrade_tier_otc` call
   * (swap-burn leg + desk-pot leg combined — the full ~2x premium, not just one side of it). */
  totalOtcCollectedUnits: bigint;
};

/**
 * §A5 90% leg — `OtcPotState`. `null` from `fetchOtcPot` means `init_otc_pot` was never called
 * (the $OTC vault path does not exist yet on this cluster).
 */
export type OtcPotView = {
  /** Keeper trusted to call `record_otc_buy` (may differ from `Config.authority`). */
  authority: string;
  /** Vault-owned $OTC token account `claim_yield` pays desks from. */
  otcVault: string;
  /** SOL earmarked by `finalize_epoch` for $OTC buys, not yet drawn by `record_otc_buy`. */
  otcPendingLamports: number;
  /** Lifetime cumulative SOL spent buying $OTC (denominator of the average rate). */
  totalLamportsSpent: number;
  /** Lifetime cumulative $OTC bought (numerator of the average rate). */
  totalOtcBoughtUnits: bigint;
};

/**
 * §A6.3 second flywheel — `CreatorFeeState`. `null` from `fetchCreatorFee` means
 * `init_creator_fee_state` was never called (the flywheel doesn't exist yet on this cluster).
 */
export type CreatorFeeView = {
  /** Keeper trusted to call `draw_creator_fee_leg` / attest results. */
  authority: string;
  /** Vault-owned $OTC token account holding the claimed launcher holder-leg proceeds. */
  creatorFeeVault: string;
  clearThresholdUnits: bigint;
  /** Received but not yet split by `clear_creator_fees`. */
  pendingOtcUnits: bigint;
  burnPendingOtc: bigint;
  lpPendingOtc: bigint;
  stackPendingOtc: bigint;
  opsPendingOtc: bigint;
  totalReceivedOtc: bigint;
  /** Lifetime $OTC injected straight into the desk pot (the 80% leg, no swap). */
  totalDeskPotOtc: bigint;
  totalBurnOtc: bigint;
  totalBurnHub: bigint;
  totalLpOtc: bigint;
  totalStackOtc: bigint;
  totalStackHub: bigint;
  totalOpsOtc: bigint;
  totalOpsSolLamports: bigint;
};

/** §A7.1 `TokenomicsConfig` — `null` from `fetchTokenomics` means the plan was never recorded. */
export type TokenomicsView = {
  maxSupplyUnits: bigint;
  airdropPerDeskUnits: bigint;
  /** Cumulative desk assets covered by the snapshot so far (0 until `set_airdrop_root`); capped
   * on-chain at `AIRDROP_DESK_CAP` and never decreases once claims have started. */
  snapshotDeskCount: number;
  snapshotTs: number;
  /** Number of `set_airdrop_root` rounds published so far (0 = none, 1 = genesis, ≥2 = later
   * rounds that grew `snapshotDeskCount` to onboard desks minted after an earlier round). */
  snapshotRound: number;
  airdropUnits: bigint;
  airdropBp: number;
  treasuryLockBp: number;
  teamBp: number;
  publicBp: number;
  /** Hex Merkle root; all-zero ⇒ snapshot not published. */
  airdropRoot: string;
  airdropRootSet: boolean;
  /** Vault-owned $HUB token account funding claims. */
  airdropVault: string;
  airdropClaimedUnits: bigint;
  airdropClaims: number;
  airdropOpen: boolean;
  /** Vault-owned $HUB token account holding the immutable 2% (yield-reserve) genesis floor — no
   * instruction ever debits it. The treasury multisig's own float ATA is separate and accumulates
   * additional $HUB on top over time (source C claims). */
  treasuryLockVault: string;
  /** `maxSupplyUnits × YIELD_RESERVE_BP / BPS`, recorded once at `init_tokenomics` — compare
   * against `treasuryLockVault`'s live balance to confirm the floor is intact. */
  treasuryLockUnits: bigint;
  /** §A6.3 bridge — lifetime $HUB deposited into `treasuryLockVault` by `fund_treasury_reward`,
   * on top of the immutable `treasuryLockUnits` floor (OTC-launcher holder rewards, swapped). */
  rewardDepositedUnits: bigint;
  /** Lifetime $HUB paid out to active desk holders via `distribute_treasury_reward`. */
  rewardDistributedUnits: bigint;
  /** Deposited but not yet snapshotted into a `RewardRound` by `open_reward_round`. */
  rewardPendingUnits: bigint;
  /** Number of `RewardRound`s opened so far (next round's index). */
  rewardRoundCount: number;
};

export type AirdropClaimView = {
  asset: string;
  claimant: string;
  amountUnits: bigint;
  claimedTs: number;
};

/** One `fund_treasury_reward` snapshot — `amountUnits` split across active desks' Σw. */
export type RewardRoundView = {
  index: number;
  amountUnits: bigint;
  totalWeightBp: bigint;
  distributedUnits: bigint;
  claims: number;
  openedTs: number;
};

/** One desk's payout receipt for a given reward round (exists ⇒ already paid). */
export type RewardClaimView = {
  round: number;
  asset: string;
  owner: string;
  amountUnits: bigint;
  claimedTs: number;
};

/** §A5.1 `HubPotConfig` — `null` from `fetchHubPot` means `init_hub_pot` was never called. */
export type HubPotView = {
  otcMint: string;
  crclxMint: string;
  nvdaxMint: string;
  spcxxMint: string;
  otcVault: string;
  crclxVault: string;
  nvdaxVault: string;
  spcxxVault: string;
  otcPendingUnits: bigint;
  crclxPendingUnits: bigint;
  nvdaxPendingUnits: bigint;
  spcxxPendingUnits: bigint;
  otcDepositedUnits: bigint;
  crclxDepositedUnits: bigint;
  nvdaxDepositedUnits: bigint;
  spcxxDepositedUnits: bigint;
  roundCount: number;
};

/** One `fund_hub_pot` snapshot — each bucket's units split across active desks' Σw. */
export type HubPotRoundView = {
  index: number;
  otcUnits: bigint;
  crclxUnits: bigint;
  nvdaxUnits: bigint;
  spcxxUnits: bigint;
  totalWeightBp: bigint;
  otcDistributedUnits: bigint;
  crclxDistributedUnits: bigint;
  nvdaxDistributedUnits: bigint;
  spcxxDistributedUnits: bigint;
  claims: number;
  openedTs: number;
};

/** One desk's basket payout receipt for a given HUB Pot round (exists ⇒ already paid). */
export type HubPotClaimView = {
  round: number;
  asset: string;
  owner: string;
  otcUnits: bigint;
  crclxUnits: bigint;
  nvdaxUnits: bigint;
  spcxxUnits: bigint;
  claimedTs: number;
};

export type SupplyView = SupplyBreakdown & {
  /** Live `Mint.supply`; null when the mint account is missing on this cluster. */
  mintSupplyUnits: bigint | null;
  decimals: number;
  /** Cumulative on-chain burn ledger (`BurnState.total_hub_burned`) — should match
   * `max − mintSupply` once all burns are recorded. */
  ledgerBurnedUnits: bigint;
  /** True when `BurnState.total_hub_burned` ≠ `max − Mint.supply` (unrecorded / out-of-band burn). */
  ledgerDrift: boolean;
};

export type ProtocolState = {
  config: ConfigView;
  currentEpoch: EpochView;
  previousEpoch: EpochView | null;
  potLamports: number;
  burn: { totalHubBurned: number };
  treasury: {
    desksOwned: number;
    totalExits: number;
    totalSweeps: number;
    lpHubDepositedUnits: bigint;
    /** §A5 2.5% leg — lifetime $HUB swapped-in and earmarked for the $HUB/$OTC LP, awaiting the
     * phase-2 `build_lp_otc_locked` adapter. */
    lpPendingHubUnits: number;
  };
  /** `null` until the authority calls `init_otc_pot` (§A5 90% leg not provisioned yet). */
  otcPot: OtcPotView | null;
  /** `null` until the authority calls `init_creator_fee_state` (§A6.3 flywheel not provisioned). */
  creatorFee: CreatorFeeView | null;
  /** `null` until the authority calls `init_tokenomics` — required by `activate_tier`/
   * `upgrade_tier`'s 50/50 burn-split, which needs `treasuryLockVault` as its reward-pool leg. */
  tokenomics: TokenomicsView | null;
  token: HubTokenState;
  supply: SupplyView;
};

/**
 * Supply math (§A3.1): burned is proven by the mint itself (`max − Mint.supply`, since the
 * keeper uses spl `Burn`, not a sink wallet); locked = treasury multisig + vault ATAs + LP
 * deposits; circulating = max − burned − locked.
 */
export function toSupplyView(
  token: HubTokenState,
  ledgerBurnedUnits: bigint,
  lpHubDepositedUnits: bigint,
): SupplyView {
  const mintSupply = token.mint?.supplyUnits ?? null;
  const burned =
    mintSupply != null && mintSupply <= HUB_MAX_SUPPLY_UNITS
      ? HUB_MAX_SUPPLY_UNITS - mintSupply
      : ledgerBurnedUnits;
  return {
    ...supplyBreakdown(burned, token.lockedUnits + lpHubDepositedUnits),
    mintSupplyUnits: mintSupply,
    decimals: token.mint?.decimals ?? 6,
    ledgerBurnedUnits,
    ledgerDrift: mintSupply != null && burned !== ledgerBurnedUnits,
  };
}

export function toConfigView(
  c: Awaited<ReturnType<HubProgram["account"]["config"]["fetch"]>>,
): ConfigView {
  return {
    authority: c.authority.toBase58(),
    pot: c.pot.toBase58(),
    opsWallet: c.opsWallet.toBase58(),
    treasury: c.treasury.toBase58(),
    otcProgram: c.otcProgram.toBase58(),
    otcDeskPot: c.otcDeskPot.toBase58(),
    deskCollection: c.deskCollection.toBase58(),
    hubMint: c.hubMint.toBase58(),
    otcMint: c.otcMint.toBase58(),
    usdcMint: c.usdcMint.toBase58(),
    tierWeightsBp: [...c.tierWeightsBp],
    stepFeeLamports: n(c.stepFeeLamports),
    tierUsdCostMicros: c.tierUsdCostMicros.map((v: { toNumber(): number } | number) => n(v)),
    tierHubCostUnitsCached: c.tierHubCostUnitsCached.map((v: { toNumber(): number } | number) =>
      n(v),
    ),
    lastPriceUpdateTs: n(c.lastPriceUpdateTs),
    tierCostBurnBp: c.tierCostBurnBp,
    minPotThresholdLamports: n(c.minPotThresholdLamports),
    burnPctBp: c.burnPctBp,
    lpPctBp: c.lpPctBp,
    treasuryFloatPctBp: c.treasuryFloatPctBp,
    opsPctBp: c.opsPctBp,
    lpEnabled: c.lpEnabled,
    lpTargetSolLamports: n(c.lpTargetSolLamports),
    lpPhase2OpenTs: n(c.lpPhase2OpenTs),
    paused: c.paused,
    currentEpoch: n(c.currentEpoch),
    genesisTs: n(c.genesisTs),
    totalWeightBp: n(c.totalWeightBp),
    potLiabilityLamports: n(c.potLiabilityLamports),
    accPerWeight: big(c.accPerWeight),
    dustScaled: big(c.dustScaled),
  };
}

export function toEpochView(
  e: Awaited<ReturnType<HubProgram["account"]["epoch"]["fetch"]>>,
): EpochView {
  return {
    index: n(e.index),
    startTs: n(e.startTs),
    finalizedTs: n(e.finalizedTs),
    inflowLamports: n(e.inflowLamports),
    distributedLamports: n(e.distributedLamports),
    burnPendingLamports: n(e.burnPendingLamports),
    lpPendingLamports: n(e.lpPendingLamports),
    rolledForwardLamports: n(e.rolledForwardLamports),
    totalWeightBp: n(e.totalWeightBp),
    perWeightScaled: big(e.perWeightScaled),
    accPerWeightAfter: big(e.accPerWeightAfter),
    finalized: e.finalized,
  };
}

export function toDeskTierView(
  t: Awaited<ReturnType<HubProgram["account"]["deskTier"]["fetch"]>>,
): DeskTierView {
  return {
    assetId: t.assetId.toBase58(),
    ownerAtActivation: t.ownerAtActivation.toBase58(),
    tier: t.tier,
    activatedEpoch: n(t.activatedEpoch),
    stampAccPerWeight: big(t.stampAccPerWeight),
    totalClaimedLamports: n(t.totalClaimedLamports),
    voided: t.voided,
  };
}

export async function fetchProtocolState(program: HubProgram): Promise<ProtocolState> {
  const id = program.programId;
  const [configKey] = configPda(id);
  const config = toConfigView(await program.account.config.fetch(configKey));
  const [curKey] = epochPda(id, config.currentEpoch);
  const [prevKey] = epochPda(id, Math.max(0, config.currentEpoch - 1));
  const [potKey] = potPda(id);
  const [burnKey] = burnPda(id);
  const [otcPotKey] = otcPotPda(id);
  const [creatorFeeKey] = creatorFeePda(id);
  const [tresKey] = treasuryPda(id);
  const [vaultKey] = vaultPda(id);
  const [tokenomicsKey] = tokenomicsPda(id);
  const connection = program.provider.connection;

  const [cur, prev, potInfo, burn, otcPot, creatorFee, tres, token, tokenomics] = await Promise.all(
    [
      program.account.epoch.fetch(curKey),
      config.currentEpoch > 0
        ? program.account.epoch.fetchNullable(prevKey)
        : Promise.resolve(null),
      connection.getAccountInfo(potKey),
      program.account.burnState.fetch(burnKey),
      program.account.otcPotState.fetchNullable(otcPotKey),
      program.account.creatorFeeState.fetchNullable(creatorFeeKey),
      program.account.treasuryState.fetch(tresKey),
      fetchHubTokenState(connection, new PublicKey(config.hubMint), [
        new PublicKey(config.treasury),
        vaultKey,
      ]),
      program.account.tokenomicsConfig.fetchNullable(tokenomicsKey),
    ],
  );

  const ledgerBurned = big(burn.totalHubBurned);
  const lpHubDepositedUnits = big(tres.lpHubDeposited);

  return {
    config,
    currentEpoch: toEpochView(cur),
    previousEpoch: prev ? toEpochView(prev) : null,
    potLamports: potInfo?.lamports ?? 0,
    burn: {
      totalHubBurned: n(burn.totalHubBurned),
    },
    otcPot: otcPot ? toOtcPotView(otcPot) : null,
    creatorFee: creatorFee ? toCreatorFeeView(creatorFee) : null,
    tokenomics: tokenomics ? toTokenomicsView(tokenomics) : null,
    treasury: {
      desksOwned: tres.desksOwned,
      totalExits: tres.totalExits,
      totalSweeps: tres.totalSweeps,
      lpHubDepositedUnits,
      lpPendingHubUnits: n(tres.lpPendingHubUnits),
    },
    token,
    supply: toSupplyView(token, ledgerBurned, lpHubDepositedUnits),
  };
}

export async function fetchDeskTier(
  program: HubProgram,
  asset: PublicKey,
): Promise<DeskTierView | null> {
  const [key] = tierPda(program.programId, asset);
  const t = await program.account.deskTier.fetchNullable(key);
  return t ? toDeskTierView(t) : null;
}

export async function fetchEpoch(program: HubProgram, index: number): Promise<EpochView | null> {
  const [key] = epochPda(program.programId, index);
  const e = await program.account.epoch.fetchNullable(key);
  return e ? toEpochView(e) : null;
}

export function toOtcPayView(
  p: Awaited<ReturnType<HubProgram["account"]["otcPayConfig"]["fetch"]>>,
): OtcPayView {
  return {
    enabled: p.enabled,
    polAccount: p.polAccount.toBase58(),
    totalOtcCollectedUnits: big(p.totalOtcCollected),
  };
}

export async function fetchOtcPay(program: HubProgram): Promise<OtcPayView | null> {
  const [key] = otcPayPda(program.programId);
  const p = await program.account.otcPayConfig.fetchNullable(key);
  return p ? toOtcPayView(p) : null;
}

export function toOtcPotView(
  p: Awaited<ReturnType<HubProgram["account"]["otcPotState"]["fetch"]>>,
): OtcPotView {
  return {
    authority: p.authority.toBase58(),
    otcVault: p.otcVault.toBase58(),
    otcPendingLamports: n(p.otcPendingLamports),
    totalLamportsSpent: n(p.totalLamportsSpent),
    totalOtcBoughtUnits: big(p.totalOtcBoughtUnits),
  };
}

/** `null` ⇒ `init_otc_pot` was never called on this cluster (§A5 90% leg not provisioned). */
export async function fetchOtcPot(program: HubProgram): Promise<OtcPotView | null> {
  const [key] = otcPotPda(program.programId);
  const p = await program.account.otcPotState.fetchNullable(key);
  return p ? toOtcPotView(p) : null;
}

/**
 * $OTC base units `claim_yield` would pay for `owedLamports` at the pot's lifetime average buy
 * rate (`totalOtcBoughtUnits / totalLamportsSpent`) — mirrors the on-chain price exactly.
 * `null` when the pot doesn't exist yet or hasn't recorded a buy (`NoOtcPurchased` on-chain).
 */
export function otcDueForLamports(owedLamports: number, pot: OtcPotView | null): bigint | null {
  if (!pot || pot.totalLamportsSpent <= 0 || owedLamports <= 0) return null;
  return (
    (BigInt(Math.trunc(owedLamports)) * pot.totalOtcBoughtUnits) / BigInt(pot.totalLamportsSpent)
  );
}

export function toCreatorFeeView(
  s: Awaited<ReturnType<HubProgram["account"]["creatorFeeState"]["fetch"]>>,
): CreatorFeeView {
  return {
    authority: s.authority.toBase58(),
    creatorFeeVault: s.creatorFeeVault.toBase58(),
    clearThresholdUnits: big(s.clearThresholdUnits),
    pendingOtcUnits: big(s.pendingOtcUnits),
    burnPendingOtc: big(s.burnPendingOtc),
    lpPendingOtc: big(s.lpPendingOtc),
    stackPendingOtc: big(s.stackPendingOtc),
    opsPendingOtc: big(s.opsPendingOtc),
    totalReceivedOtc: big(s.totalReceivedOtc),
    totalDeskPotOtc: big(s.totalDeskPotOtc),
    totalBurnOtc: big(s.totalBurnOtc),
    totalBurnHub: big(s.totalBurnHub),
    totalLpOtc: big(s.totalLpOtc),
    totalStackOtc: big(s.totalStackOtc),
    totalStackHub: big(s.totalStackHub),
    totalOpsOtc: big(s.totalOpsOtc),
    totalOpsSolLamports: big(s.totalOpsSolLamports),
  };
}

/** `null` ⇒ `init_creator_fee_state` was never called on this cluster (flywheel not provisioned). */
export async function fetchCreatorFee(program: HubProgram): Promise<CreatorFeeView | null> {
  const [key] = creatorFeePda(program.programId);
  const s = await program.account.creatorFeeState.fetchNullable(key);
  return s ? toCreatorFeeView(s) : null;
}

/**
 * Progress toward the next `clear_creator_fees` call, 0–1 (never > 1; the pending balance is
 * fully split as soon as it clears the threshold, so it can't overshoot in steady state).
 */
export function creatorFeeClearProgress(view: CreatorFeeView | null): number {
  if (!view || view.clearThresholdUnits <= 0n) return 0;
  const ratio = Number(view.pendingOtcUnits) / Number(view.clearThresholdUnits);
  return Math.max(0, Math.min(1, ratio));
}

export function toTokenomicsView(
  t: Awaited<ReturnType<HubProgram["account"]["tokenomicsConfig"]["fetch"]>>,
): TokenomicsView {
  const root = Buffer.from(t.airdropRoot).toString("hex");
  return {
    maxSupplyUnits: big(t.maxSupplyUnits),
    airdropPerDeskUnits: big(t.airdropPerDeskUnits),
    snapshotDeskCount: t.snapshotDeskCount,
    snapshotTs: n(t.snapshotTs),
    snapshotRound: t.snapshotRound,
    airdropUnits: big(t.airdropUnits),
    airdropBp: t.airdropBp,
    treasuryLockBp: t.treasuryLockBp,
    teamBp: t.teamBp,
    publicBp: t.publicBp,
    airdropRoot: root,
    airdropRootSet: /[^0]/.test(root),
    airdropVault: t.airdropVault.toBase58(),
    airdropClaimedUnits: big(t.airdropClaimedUnits),
    airdropClaims: t.airdropClaims,
    airdropOpen: t.airdropOpen,
    treasuryLockVault: t.treasuryLockVault.toBase58(),
    treasuryLockUnits: big(t.treasuryLockUnits),
    rewardDepositedUnits: big(t.rewardDepositedUnits),
    rewardDistributedUnits: big(t.rewardDistributedUnits),
    rewardPendingUnits: big(t.rewardPendingUnits),
    rewardRoundCount: t.rewardRoundCount,
  };
}

export async function fetchTokenomics(program: HubProgram): Promise<TokenomicsView | null> {
  const [key] = tokenomicsPda(program.programId);
  const t = await program.account.tokenomicsConfig.fetchNullable(key);
  return t ? toTokenomicsView(t) : null;
}

/** `null` ⇒ this desk has not claimed its airdrop. */
export async function fetchAirdropClaim(
  program: HubProgram,
  asset: PublicKey,
): Promise<AirdropClaimView | null> {
  const [key] = airdropClaimPda(program.programId, asset);
  const c = await program.account.airdropClaim.fetchNullable(key);
  return c
    ? {
        asset: c.asset.toBase58(),
        claimant: c.claimant.toBase58(),
        amountUnits: big(c.amountUnits),
        claimedTs: n(c.claimedTs),
      }
    : null;
}

export function toRewardRoundView(
  r: Awaited<ReturnType<HubProgram["account"]["rewardRound"]["fetch"]>>,
): RewardRoundView {
  return {
    index: r.index,
    amountUnits: big(r.amountUnits),
    totalWeightBp: big(r.totalWeightBp),
    distributedUnits: big(r.distributedUnits),
    claims: r.claims,
    openedTs: n(r.openedTs),
  };
}

/** `null` ⇒ this round index has not been opened yet (`open_reward_round`). */
export async function fetchRewardRound(
  program: HubProgram,
  index: number,
): Promise<RewardRoundView | null> {
  const [key] = rewardRoundPda(program.programId, index);
  const r = await program.account.rewardRound.fetchNullable(key);
  return r ? toRewardRoundView(r) : null;
}

/** `null` ⇒ this desk has not yet been paid its share of `round`. */
export async function fetchRewardClaim(
  program: HubProgram,
  round: number,
  asset: PublicKey,
): Promise<RewardClaimView | null> {
  const [key] = rewardClaimPda(program.programId, round, asset);
  const c = await program.account.rewardClaim.fetchNullable(key);
  return c
    ? {
        round: c.round,
        asset: c.asset.toBase58(),
        owner: c.owner.toBase58(),
        amountUnits: big(c.amountUnits),
        claimedTs: n(c.claimedTs),
      }
    : null;
}

/** Tier-weighted share of an open `RewardRound` a desk would receive — mirrors the on-chain
 * `reward_share` floor-division exactly. */
export function rewardShareUnits(round: RewardRoundView, tier: number): bigint {
  const w = TIER_WEIGHTS_BP[tier - 1] ?? 0;
  if (!w || round.totalWeightBp <= 0n) return 0n;
  return (round.amountUnits * BigInt(w)) / round.totalWeightBp;
}

export function toHubPotView(
  p: Awaited<ReturnType<HubProgram["account"]["hubPotConfig"]["fetch"]>>,
): HubPotView {
  return {
    otcMint: p.otcMint.toBase58(),
    crclxMint: p.crclxMint.toBase58(),
    nvdaxMint: p.nvdaxMint.toBase58(),
    spcxxMint: p.spcxxMint.toBase58(),
    otcVault: p.otcVault.toBase58(),
    crclxVault: p.crclxVault.toBase58(),
    nvdaxVault: p.nvdaxVault.toBase58(),
    spcxxVault: p.spcxxVault.toBase58(),
    otcPendingUnits: big(p.otcPendingUnits),
    crclxPendingUnits: big(p.crclxPendingUnits),
    nvdaxPendingUnits: big(p.nvdaxPendingUnits),
    spcxxPendingUnits: big(p.spcxxPendingUnits),
    otcDepositedUnits: big(p.otcDepositedUnits),
    crclxDepositedUnits: big(p.crclxDepositedUnits),
    nvdaxDepositedUnits: big(p.nvdaxDepositedUnits),
    spcxxDepositedUnits: big(p.spcxxDepositedUnits),
    roundCount: p.roundCount,
  };
}

/** `null` ⇒ `init_hub_pot` has not been called yet. */
export async function fetchHubPot(program: HubProgram): Promise<HubPotView | null> {
  const [key] = hubPotPda(program.programId);
  const p = await program.account.hubPotConfig.fetchNullable(key);
  return p ? toHubPotView(p) : null;
}

export function toHubPotRoundView(
  r: Awaited<ReturnType<HubProgram["account"]["hubPotRound"]["fetch"]>>,
): HubPotRoundView {
  return {
    index: r.index,
    otcUnits: big(r.otcUnits),
    crclxUnits: big(r.crclxUnits),
    nvdaxUnits: big(r.nvdaxUnits),
    spcxxUnits: big(r.spcxxUnits),
    totalWeightBp: big(r.totalWeightBp),
    otcDistributedUnits: big(r.otcDistributedUnits),
    crclxDistributedUnits: big(r.crclxDistributedUnits),
    nvdaxDistributedUnits: big(r.nvdaxDistributedUnits),
    spcxxDistributedUnits: big(r.spcxxDistributedUnits),
    claims: r.claims,
    openedTs: n(r.openedTs),
  };
}

/** `null` ⇒ this round index has not been opened yet (`open_hub_pot_round`). */
export async function fetchHubPotRound(
  program: HubProgram,
  index: number,
): Promise<HubPotRoundView | null> {
  const [key] = hubPotRoundPda(program.programId, index);
  const r = await program.account.hubPotRound.fetchNullable(key);
  return r ? toHubPotRoundView(r) : null;
}

/** `null` ⇒ this desk has not yet been paid its basket share of `round`. */
export async function fetchHubPotClaim(
  program: HubProgram,
  round: number,
  asset: PublicKey,
): Promise<HubPotClaimView | null> {
  const [key] = hubPotClaimPda(program.programId, round, asset);
  const c = await program.account.hubPotClaim.fetchNullable(key);
  return c
    ? {
        round: c.round,
        asset: c.asset.toBase58(),
        owner: c.owner.toBase58(),
        otcUnits: big(c.otcUnits),
        crclxUnits: big(c.crclxUnits),
        nvdaxUnits: big(c.nvdaxUnits),
        spcxxUnits: big(c.spcxxUnits),
        claimedTs: n(c.claimedTs),
      }
    : null;
}

/** Tier-weighted share of all 4 open `HubPotRound` buckets a desk would receive — mirrors the
 * on-chain `reward_share` floor-division exactly, applied independently per bucket. */
export function hubPotShareUnits(
  round: HubPotRoundView,
  tier: number,
): { otc: bigint; crclx: bigint; nvdax: bigint; spcxx: bigint } {
  const w = TIER_WEIGHTS_BP[tier - 1] ?? 0;
  if (!w || round.totalWeightBp <= 0n) return { otc: 0n, crclx: 0n, nvdax: 0n, spcxx: 0n };
  const wBig = BigInt(w);
  return {
    otc: (round.otcUnits * wBig) / round.totalWeightBp,
    crclx: (round.crclxUnits * wBig) / round.totalWeightBp,
    nvdax: (round.nvdaxUnits * wBig) / round.totalWeightBp,
    spcxx: (round.spcxxUnits * wBig) / round.totalWeightBp,
  };
}

/** True when `activate_tier_otc` / `upgrade_tier_otc` would pass the program's payable gate.
 * Pricing is a live Jupiter quote supplied per-call now, not a stored rate — this only reflects
 * the on/off switch (`init_otc_payments` must also have run, i.e. `p` is non-null). */
export function otcPayable(p: OtcPayView | null) {
  return !!p && p.enabled;
}

/** Whole lamports of dust that will be folded into the open round at the next finalize. */
export function dustCarryLamports(c: ConfigView) {
  return Number(c.dustScaled / ACC_SCALE);
}

/** Open-round inflow as the program will see it at finalize (includes dust carry). */
export function effectiveInflowLamports(e: EpochView, c: ConfigView) {
  return e.inflowLamports + dustCarryLamports(c);
}

/** 0..1 progress of the open round toward `min_pot_threshold_lamports`. */
export function roundProgress(e: EpochView, c: ConfigView) {
  const t = Math.max(1, c.minPotThresholdLamports);
  return Math.min(1, effectiveInflowLamports(e, c) / t);
}

/** True when `finalize_epoch` would succeed right now (threshold met and Σw > 0). */
export function canFinalize(e: EpochView, c: ConfigView) {
  return (
    !e.finalized &&
    c.totalWeightBp > 0 &&
    effectiveInflowLamports(e, c) >= c.minPotThresholdLamports
  );
}

/** Lamports still needed before the open round can close (0 when ready). */
export function lamportsToThreshold(e: EpochView, c: ConfigView) {
  return Math.max(0, c.minPotThresholdLamports - effectiveInflowLamports(e, c));
}

/**
 * Projected staker allotment (lamport-equivalent $OTC value) for `tier` if the open round
 * closed now with its current inflow and Σw — mirrors `finalize_epoch`'s §A5 4-way split
 * (5% burn / 2.5% LP / 2.5% treasury float come off first — all three swapped SOL→$HUB in one
 * synchronous Jupiter CPI — the remaining 90% is the distributable $OTC leg).
 */
export function projectRoundYield(
  e: EpochView,
  tier: number,
  totalWeightBp: number,
  burnPctBp: number,
  lpPctBp: number,
  treasuryFloatPctBp: number,
) {
  const w = TIER_WEIGHTS_BP[tier - 1] ?? 0;
  if (!w || totalWeightBp === 0) return 0;
  const burn = Math.floor((e.inflowLamports * burnPctBp) / BPS);
  const lp = Math.floor((e.inflowLamports * lpPctBp) / BPS);
  const float = Math.floor((e.inflowLamports * treasuryFloatPctBp) / BPS);
  const distributable = e.inflowLamports - burn - lp - float;
  return Math.floor((distributable * w) / totalWeightBp);
}

/** Exact share `tier` received from a closed round: ⌊per_weight_scaled × w / ACC_SCALE⌋. */
export function owedForEpoch(e: EpochView, tier: number) {
  const w = TIER_WEIGHTS_BP[tier - 1] ?? 0;
  if (!e.finalized || !w) return 0;
  return Number((e.perWeightScaled * BigInt(w)) / ACC_SCALE);
}

/**
 * Everything a live tier can take in one `claim_yield` right now — mirrors on-chain
 * `pending_yield`: ⌊(acc − stamp) × w / ACC_SCALE⌋ across every round closed since its stamp.
 */
export function pendingYieldLamports(t: DeskTierView, c: ConfigView) {
  const w = TIER_WEIGHTS_BP[t.tier - 1] ?? 0;
  if (t.voided || !w || c.accPerWeight <= t.stampAccPerWeight) return 0;
  return Number(((c.accPerWeight - t.stampAccPerWeight) * BigInt(w)) / ACC_SCALE);
}
