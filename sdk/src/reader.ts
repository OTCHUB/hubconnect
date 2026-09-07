// Read-only program state access for the web dashboard, keepers, and the otchub Part C panel.
// No wallet required: decodes accounts via the IDL and returns plain JS numbers (lamports fit
// safely in Number up to 9e15 ≈ 9M SOL).
import { AnchorProvider, BorshAccountsCoder, Idl, Program } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../idl/hub.json";
import type { Hub } from "../idl/hub";
import { burnPda, configPda, epochPda, potPda, tierPda, treasuryPda, consignPda } from "./pda";
import { BPS, TIER_WEIGHTS_BP } from "./constants";

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
  epochDurationSecs: number;
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
};

export type EpochView = {
  index: number;
  startTs: number;
  endTs: number;
  inflowLamports: number;
  distributedLamports: number;
  burnPendingLamports: number;
  rolledForwardLamports: number;
  totalWeightBp: number;
  claimedLamports: number;
  claimedWeightBp: number;
  finalized: boolean;
};

export type DeskTierView = {
  assetId: string;
  ownerAtActivation: string;
  tier: number;
  activatedEpoch: number;
  nextClaimEpoch: number;
  voided: boolean;
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
    epochDurationSecs: n(c.epochDurationSecs),
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
  };
}

export function toEpochView(
  e: Awaited<ReturnType<HubProgram["account"]["epoch"]["fetch"]>>,
): EpochView {
  return {
    index: n(e.index),
    startTs: n(e.startTs),
    endTs: n(e.endTs),
    inflowLamports: n(e.inflowLamports),
    distributedLamports: n(e.distributedLamports),
    burnPendingLamports: n(e.burnPendingLamports),
    rolledForwardLamports: n(e.rolledForwardLamports),
    totalWeightBp: n(e.totalWeightBp),
    claimedLamports: n(e.claimedLamports),
    claimedWeightBp: n(e.claimedWeightBp),
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
    nextClaimEpoch: n(t.nextClaimEpoch),
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

/** 0..1 progress of an epoch at `nowTs` (unix seconds). */
export function epochProgress(e: EpochView, nowTs = Math.floor(Date.now() / 1000)) {
  const len = Math.max(1, e.endTs - e.startTs);
  return Math.min(1, Math.max(0, (nowTs - e.startTs) / len));
}

/** Projected staker allotment for `tier` if the open epoch closed with its current inflow and Σw. */
export function projectEpochYield(
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

/** Exact payout owed to `tier` for a finalized epoch (ignores last-claimer remainder). */
export function owedForEpoch(e: EpochView, tier: number) {
  const w = TIER_WEIGHTS_BP[tier - 1] ?? 0;
  if (!e.finalized || !w || e.totalWeightBp === 0) return 0;
  return Math.floor((e.distributedLamports * w) / e.totalWeightBp);
}
