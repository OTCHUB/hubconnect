// Read-only program state access for the web dashboard, keepers, and the otchub Part C panel.
// No wallet required: decodes accounts via the IDL and returns plain JS numbers (lamports fit
// safely in Number up to 9e15 ≈ 9M SOL).
import { AnchorProvider, BorshAccountsCoder, Idl, Program } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../idl/hub.json";
import type { Hub } from "../idl/hub";
import {
  accrualPda,
  burnPda,
  configPda,
  epochPda,
  otcPotPda,
  creatorFeePda,
  potPda,
  tierPda,
  treasuryPda,
  consignPda,
  vaultPda,
  otcPayPda,
  tokenomicsPda,
  airdropClaimPda,
} from "./pda";
import {
  ACC_SCALE,
  BPS,
  HUB_MAX_SUPPLY_UNITS,
  OTC_RATE_MAX_AGE_SECS,
  TIER_WEIGHTS_BP,
  otcFeeUnits,
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
  tierWeightsBp: number[];
  stepFeeLamports: number;
  /** $HUB base units required to reach each tier from scratch (cumulative table). */
  tierHubCostUnits: number[];
  minPotThresholdLamports: number;
  burnPctBp: number;
  /** §A5 5% — earmarked at finalize into `TreasuryState.lpPendingLamports` (phase-2 LP build). */
  lpPctBp: number;
  opsPctBp: number;
  consignmentEnabled: boolean;
  consignorShareBp: number;
  lpEnabled: boolean;
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

export type EpochView = {
  index: number;
  startTs: number;
  /** 0 while open. */
  finalizedTs: number;
  inflowLamports: number;
  /** §A5 90% $OTC leg's lamport-equivalent value, credited through `accPerWeight` this round. */
  distributedLamports: number;
  burnPendingLamports: number;
  /** §A5 5% — this round's LP-build earmark, added to `TreasuryView.lpPendingLamports`. */
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

export type StakerAccrualView = {
  wallet: string;
  /** Consignor-share credits claimable via `claim_accrual`. */
  owedLamports: number;
  /** Lifetime SOL paid out to this wallet by `claim_accrual`. */
  totalClaimedLamports: number;
};

/** §A4.1 `OtcPayConfig` — `null` from `fetchOtcPay` means the path was never initialized. */
export type OtcPayView = {
  enabled: boolean;
  /** $OTC base units per 1 SOL (authority-refreshed reference rate). */
  otcPerSol: bigint;
  rateTs: number;
  /** Premium over the SOL step-fee value, bp (20_000 = 2.00×). */
  premiumBp: number;
  /** Vault-owned $OTC token account: the POL reserve every $OTC fee lands in. */
  polAccount: string;
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
  /** Desk assets in the snapshot (0 until `set_airdrop_root`). */
  snapshotDeskCount: number;
  snapshotTs: number;
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
};

export type AirdropClaimView = {
  asset: string;
  claimant: string;
  amountUnits: bigint;
  claimedTs: number;
};

export type SupplyView = SupplyBreakdown & {
  /** Live `Mint.supply`; null when the mint account is missing on this cluster. */
  mintSupplyUnits: bigint | null;
  decimals: number;
  /** Cumulative `record_burn` ledger — should match `max − mintSupply` once all burns are recorded. */
  ledgerBurnedUnits: bigint;
  /** True when `BurnState.total_hub_burned` ≠ `max − Mint.supply` (unrecorded / out-of-band burn). */
  ledgerDrift: boolean;
};

export type ProtocolState = {
  config: ConfigView;
  currentEpoch: EpochView;
  previousEpoch: EpochView | null;
  potLamports: number;
  burn: { totalHubBurned: number; burnPendingLamports: number };
  treasury: {
    desksOwned: number;
    desksConsigned: number;
    totalExits: number;
    totalSweeps: number;
    lpHubDepositedUnits: bigint;
    /** §A5 5% leg awaiting the phase-2 LP adapter (mirrors `burn.burnPendingLamports`). */
    lpPendingLamports: number;
  };
  /** `null` until the authority calls `init_otc_pot` (§A5 90% leg not provisioned yet). */
  otcPot: OtcPotView | null;
  /** `null` until the authority calls `init_creator_fee_state` (§A6.3 flywheel not provisioned). */
  creatorFee: CreatorFeeView | null;
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
    tierWeightsBp: [...c.tierWeightsBp],
    stepFeeLamports: n(c.stepFeeLamports),
    tierHubCostUnits: c.tierHubCostUnits.map((v) => n(v)),
    minPotThresholdLamports: n(c.minPotThresholdLamports),
    burnPctBp: c.burnPctBp,
    lpPctBp: c.lpPctBp,
    opsPctBp: c.opsPctBp,
    consignmentEnabled: c.consignmentEnabled,
    consignorShareBp: c.consignorShareBp,
    lpEnabled: c.lpEnabled,
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

export function toStakerAccrualView(
  a: Awaited<ReturnType<HubProgram["account"]["stakerAccrual"]["fetch"]>>,
): StakerAccrualView {
  return {
    wallet: a.wallet.toBase58(),
    owedLamports: n(a.owedLamports),
    totalClaimedLamports: n(a.totalClaimedLamports),
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
  const connection = program.provider.connection;

  const [cur, prev, potInfo, burn, otcPot, creatorFee, tres, token] = await Promise.all([
    program.account.epoch.fetch(curKey),
    config.currentEpoch > 0 ? program.account.epoch.fetchNullable(prevKey) : Promise.resolve(null),
    connection.getAccountInfo(potKey),
    program.account.burnState.fetch(burnKey),
    program.account.otcPotState.fetchNullable(otcPotKey),
    program.account.creatorFeeState.fetchNullable(creatorFeeKey),
    program.account.treasuryState.fetch(tresKey),
    fetchHubTokenState(connection, new PublicKey(config.hubMint), [
      new PublicKey(config.treasury),
      vaultKey,
    ]),
  ]);

  const ledgerBurned = big(burn.totalHubBurned);
  const lpHubDepositedUnits = big(tres.lpHubDeposited);

  return {
    config,
    currentEpoch: toEpochView(cur),
    previousEpoch: prev ? toEpochView(prev) : null,
    potLamports: potInfo?.lamports ?? 0,
    burn: {
      totalHubBurned: n(burn.totalHubBurned),
      burnPendingLamports: n(burn.burnPendingLamports),
    },
    otcPot: otcPot ? toOtcPotView(otcPot) : null,
    creatorFee: creatorFee ? toCreatorFeeView(creatorFee) : null,
    treasury: {
      desksOwned: tres.desksOwned,
      desksConsigned: tres.desksConsigned,
      totalExits: tres.totalExits,
      totalSweeps: tres.totalSweeps,
      lpHubDepositedUnits,
      lpPendingLamports: n(tres.lpPendingLamports),
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

export async function fetchConsignment(program: HubProgram, asset: PublicKey) {
  const [key] = consignPda(program.programId, asset);
  const c = await program.account.consignedDesk.fetchNullable(key);
  return c
    ? {
        assetId: c.assetId.toBase58(),
        consignor: c.consignor.toBase58(),
        consignedEpoch: n(c.consignedEpoch),
        active: c.active,
      }
    : null;
}

export async function fetchEpoch(program: HubProgram, index: number): Promise<EpochView | null> {
  const [key] = epochPda(program.programId, index);
  const e = await program.account.epoch.fetchNullable(key);
  return e ? toEpochView(e) : null;
}

export async function fetchStakerAccrual(
  program: HubProgram,
  wallet: PublicKey,
): Promise<StakerAccrualView | null> {
  const [key] = accrualPda(program.programId, wallet);
  const a = await program.account.stakerAccrual.fetchNullable(key);
  return a ? toStakerAccrualView(a) : null;
}

export function toOtcPayView(
  p: Awaited<ReturnType<HubProgram["account"]["otcPayConfig"]["fetch"]>>,
): OtcPayView {
  return {
    enabled: p.enabled,
    otcPerSol: big(p.otcPerSol),
    rateTs: n(p.rateTs),
    premiumBp: p.premiumBp,
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
  return (BigInt(Math.trunc(owedLamports)) * pot.totalOtcBoughtUnits) / BigInt(pot.totalLamportsSpent);
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

/** True when `activate_tier_otc` / `upgrade_tier_otc` would pass the program's payable gate. */
export function otcPayable(p: OtcPayView | null, nowSecs = Math.floor(Date.now() / 1000)) {
  return !!p && p.enabled && p.otcPerSol > 0n && nowSecs - p.rateTs <= OTC_RATE_MAX_AGE_SECS;
}

/** $OTC units the program will charge for an `activate`/`upgrade` call under `p` — the flat SOL
 * step-fee value at the premium; independent of `from`/`to` (kept as params for API stability). */
export function otcStepFeeUnits(p: OtcPayView, c: ConfigView, _from: number, _to: number) {
  return otcFeeUnits(c.stepFeeLamports, p.otcPerSol, p.premiumBp);
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
 * closed now with its current inflow and Σw — mirrors `finalize_epoch`'s §A5 5%/5%/90% split
 * (burn + LP-pending come off first, the remainder is the distributable $OTC leg).
 */
export function projectRoundYield(
  e: EpochView,
  tier: number,
  totalWeightBp: number,
  burnPctBp: number,
  lpPctBp: number,
) {
  const w = TIER_WEIGHTS_BP[tier - 1] ?? 0;
  if (!w || totalWeightBp === 0) return 0;
  const burn = Math.floor((e.inflowLamports * burnPctBp) / BPS);
  const lp = Math.floor((e.inflowLamports * lpPctBp) / BPS);
  const distributable = e.inflowLamports - burn - lp;
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
