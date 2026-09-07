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
  potPda,
  tierPda,
  treasuryPda,
  consignPda,
} from "./pda";
import { ACC_SCALE, BPS, TIER_WEIGHTS_BP } from "./constants";

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
  minPotThresholdLamports: number;
  burnPctBp: number;
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
  distributedLamports: number;
  burnPendingLamports: number;
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

export type ProtocolState = {
  config: ConfigView;
  currentEpoch: EpochView;
  previousEpoch: EpochView | null;
  potLamports: number;
  burn: { totalHubBurned: number; burnPendingLamports: number };
  treasury: { desksOwned: number; desksConsigned: number; totalExits: number; totalSweeps: number };
};

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
    minPotThresholdLamports: n(c.minPotThresholdLamports),
    burnPctBp: c.burnPctBp,
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
  const [tresKey] = treasuryPda(id);

  const [cur, prev, potInfo, burn, tres] = await Promise.all([
    program.account.epoch.fetch(curKey),
    config.currentEpoch > 0 ? program.account.epoch.fetchNullable(prevKey) : Promise.resolve(null),
    program.provider.connection.getAccountInfo(potKey),
    program.account.burnState.fetch(burnKey),
    program.account.treasuryState.fetch(tresKey),
  ]);

  return {
    config,
    currentEpoch: toEpochView(cur),
    previousEpoch: prev ? toEpochView(prev) : null,
    potLamports: potInfo?.lamports ?? 0,
    burn: {
      totalHubBurned: n(burn.totalHubBurned),
      burnPendingLamports: n(burn.burnPendingLamports),
    },
    treasury: {
      desksOwned: tres.desksOwned,
      desksConsigned: tres.desksConsigned,
      totalExits: tres.totalExits,
      totalSweeps: tres.totalSweeps,
    },
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

/** Projected staker allotment for `tier` if the open round closed with its current inflow and Σw. */
export function projectRoundYield(
  e: EpochView,
  tier: number,
  totalWeightBp: number,
  burnPctBp: number,
) {
  const w = TIER_WEIGHTS_BP[tier - 1] ?? 0;
  if (!w || totalWeightBp === 0) return 0;
  const distributable = e.inflowLamports - Math.floor((e.inflowLamports * burnPctBp) / BPS);
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
