import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  ataPda,
  fetchDeskTier,
  fetchOwnedDesks,
  fetchTokenomics,
  pendingYieldLamports,
  vaultPda,
  type DeskTierView,
  type ProtocolState,
} from "@hub-sdk";
import { useHub } from "../HubProvider";
import { baseInputs, roundsPerDay, tierPayoutLamports } from "../lib/yield";

export type TreasuryDesk = {
  asset: string;
  tier: DeskTierView | null;
  pendingLamports: number;
  /** Projected SOL/round for this desk's tier under current inputs (0 when not activated). */
  roundLamports: number;
};

export type TreasuryPortfolio = {
  treasury: string;
  vault: string;
  solLamports: number;
  /** Base units in the treasury's standard ATAs (null = no token account). */
  otcUnits: bigint | null;
  otcDecimals: number | null;
  hubUnits: bigint;
  desks: TreasuryDesk[];
  /** Lifetime $HUB paid out to active desk holders network-wide (mirrors the `distributed_hub`
   * column the ingest script writes — see scripts/hub-snapshot-ingest.ts), used as the live "NOW"
   * point for `HubEarningsChart`. 0n if `TokenomicsConfig` hasn't been recorded yet. */
  rewardDistributedUnits: bigint;
  /** Σ claimed + Σ pending across activated treasury desks — yield accrued to date. */
  lifetimeEarningsLamports: number;
  /** Σ pending (`claim_yield` would pay this now). */
  earnToClaimLamports: number;
  /** Σ tier payout × rounds/day; null before the first closed round fixes a cadence. */
  earningsPerDayLamports: number | null;
  roundsPerDay: number | null;
};

/** Treasury showcase: desks the protocol holds (multisig + vault), balances, and yield metrics. */
export function useTreasuryPortfolio(state: ProtocolState | null) {
  const { connection, program, programId } = useHub();
  return useQuery({
    queryKey: [
      "hub",
      "treasury-portfolio",
      programId.toBase58(),
      connection.rpcEndpoint,
      state?.config.treasury,
      state?.config.accPerWeight.toString(),
    ],
    enabled: state !== null,
    queryFn: async (): Promise<TreasuryPortfolio> => {
      const { config } = state!;
      const treasury = new PublicKey(config.treasury);
      const [vault] = vaultPda(programId);
      const collection = new PublicKey(config.deskCollection);
      const otcMint = new PublicKey(config.otcMint);
      const [otcAta] = ataPda(treasury, otcMint);

      const [owned, solLamports, otc, tokenomics] = await Promise.all([
        fetchOwnedDesks(connection, treasury, collection),
        connection.getBalance(treasury, "confirmed"),
        connection.getTokenAccountBalance(otcAta, "confirmed").catch(() => null),
        fetchTokenomics(program),
      ]);
      const all = owned.map((a) => ({ asset: a }));
      const tiers = await Promise.all(all.map((d) => fetchDeskTier(program, d.asset)));

      const inputs = baseInputs(state!.currentEpoch, config);
      const perDay = roundsPerDay(state!.previousEpoch);
      const desks: TreasuryDesk[] = all.map((d, i) => {
        const tier = tiers[i];
        const active = tier && !tier.voided;
        return {
          asset: d.asset.toBase58(),
          tier,
          pendingLamports: active ? pendingYieldLamports(tier, config) : 0,
          roundLamports: active ? tierPayoutLamports(tier.tier, inputs) : 0,
        };
      });
      const claimed = desks.reduce(
        (s, d) => s + (d.tier && !d.tier.voided ? d.tier.totalClaimedLamports : 0),
        0,
      );
      const pending = desks.reduce((s, d) => s + d.pendingLamports, 0);
      const perRound = desks.reduce((s, d) => s + d.roundLamports, 0);
      const hubUnits = state!.token.holdings
        .filter((h) => h.owner === config.treasury)
        .reduce((s, h) => s + h.units, 0n);

      return {
        treasury: config.treasury,
        vault: vault.toBase58(),
        solLamports,
        otcUnits: otc ? BigInt(otc.value.amount) : null,
        otcDecimals: otc?.value.decimals ?? null,
        hubUnits,
        desks,
        rewardDistributedUnits: tokenomics?.rewardDistributedUnits ?? 0n,
        lifetimeEarningsLamports: claimed + pending,
        earnToClaimLamports: pending,
        earningsPerDayLamports: perDay === null ? null : perRound * perDay,
        roundsPerDay: perDay,
      };
    },
  });
}
