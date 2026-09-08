// §A6 — treasury acquisition priority: sweep the floor vs mint fresh, whichever is
// cheaper right now, while treating treasury SOL as a reserve asset that is never
// drained to fund an acquisition. Pure decision logic only — no RPC/API calls, no
// signing. The M4 sweeper service (`index.ts`) wires this to live ME listings, an
// OTC/SOL price feed, and the treasury's on-chain balances once it lands.
//
// Mirrors the spec formula exactly:
//   sweep_cost = list_price × (1 + TAKER_FEE + ROYALTY_FEE)
//   mint_cost  = MINT_OTC_UNITS × p_OTC_SOL + MINT_SOL_LAMPORTS
//   SWEEP if sweep_cost < mint_cost                                   (common case)
//   MINT  if sweep_cost ≥ mint_cost AND treasury holds the mint cost outright
//   otherwise HOLD (no viable listing and can't afford to mint without touching SOL)

/** Magic Eden buyer-cost multiplier over list price (§A2: 2% taker + 5% royalty). */
export const ME_BUYER_COST_MULTIPLIER = 1 + 0.02 + 0.05;
/** §A2 — $OTC base units burned per fresh desk mint (100,000 OTC, 6 decimals). */
export const MINT_OTC_UNITS = 100_000n * 1_000_000n;
/** §A2 — flat SOL surcharge per fresh desk mint (0.45 pot / 0.05 protocol). */
export const MINT_SOL_LAMPORTS = 500_000_000;

export type AcquisitionInputs = {
  /** Cheapest verified-stocked floor listing right now, lamports; null = nothing listed. */
  floorListingLamports: number | null;
  /** Lamports of value per 1 base $OTC unit (i.e. `p_OTC_SOL` scaled to base units). */
  otcLamportsPerUnit: number;
  /** Treasury multisig's current free SOL, lamports. */
  treasurySolLamports: number;
  /** Treasury multisig's current $OTC holdings, base units. */
  treasuryOtcUnits: bigint;
  /** Minimum SOL the treasury must always retain — the reserve floor, never swapped away. */
  solReserveFloorLamports: number;
  mintOtcUnits?: bigint;
  mintSolLamports?: number;
  buyerCostMultiplier?: number;
};

export type AcquisitionPlan =
  | {
      action: "sweep";
      costLamports: number;
      /** SOL drawn from the free balance above the reserve floor. */
      solFromReserveLamports: number;
      /** $OTC that must be swapped to SOL first to cover the rest of `costLamports`. */
      otcToSwapUnits: bigint;
      reason: string;
    }
  | { action: "mint"; costOtcUnits: bigint; costSolLamports: number; reason: string }
  | { action: "hold"; reason: string };

/**
 * One acquisition decision for the current cycle. Never recommends spending below
 * `solReserveFloorLamports` — a shortfall is covered by swapping the minimum $OTC
 * needed, and if even that isn't enough the sweep is deferred (HOLD) rather than
 * forcing the reserve floor to be breached.
 */
export function decideAcquisition(inputs: AcquisitionInputs): AcquisitionPlan {
  const {
    floorListingLamports,
    otcLamportsPerUnit,
    treasurySolLamports,
    treasuryOtcUnits,
    solReserveFloorLamports,
    mintOtcUnits = MINT_OTC_UNITS,
    mintSolLamports = MINT_SOL_LAMPORTS,
    buyerCostMultiplier = ME_BUYER_COST_MULTIPLIER,
  } = inputs;

  const sweepCost =
    floorListingLamports != null ? Math.ceil(floorListingLamports * buyerCostMultiplier) : null;
  const mintCostLamports = Number(mintOtcUnits) * otcLamportsPerUnit + mintSolLamports;
  const solAvailable = Math.max(0, treasurySolLamports - solReserveFloorLamports);

  const canMintOutright =
    treasuryOtcUnits >= mintOtcUnits &&
    treasurySolLamports - mintSolLamports >= solReserveFloorLamports;

  const sweepWins = sweepCost != null && (sweepCost < mintCostLamports || !canMintOutright);

  if (sweepWins && sweepCost != null) {
    if (solAvailable >= sweepCost) {
      return {
        action: "sweep",
        costLamports: sweepCost,
        solFromReserveLamports: sweepCost,
        otcToSwapUnits: 0n,
        reason: "cheapest option; fully covered by free SOL above the reserve floor",
      };
    }
    const shortfallLamports = sweepCost - solAvailable;
    const otcToSwapUnits = BigInt(Math.ceil(shortfallLamports / otcLamportsPerUnit));
    if (treasuryOtcUnits < otcToSwapUnits) {
      return {
        action: "hold",
        reason:
          "sweep is cheaper but free SOL + available $OTC can't cover it without breaching the reserve floor — deferring to next cycle",
      };
    }
    return {
      action: "sweep",
      costLamports: sweepCost,
      solFromReserveLamports: solAvailable,
      otcToSwapUnits,
      reason: `cheapest option; ${shortfallLamports} lamport shortfall covered by swapping $OTC, reserve floor left intact`,
    };
  }

  if (canMintOutright) {
    return {
      action: "mint",
      costOtcUnits: mintOtcUnits,
      costSolLamports: mintSolLamports,
      reason:
        sweepCost == null
          ? "no viable stocked listing right now; treasury holds the mint cost outright"
          : "spread inverted (mint cheaper than sweep); treasury holds the mint cost outright",
    };
  }

  return {
    action: "hold",
    reason:
      sweepCost == null
        ? "no viable stocked listing and treasury can't afford to mint without touching the SOL reserve"
        : "mint would be cheaper but the treasury can't afford it without touching the SOL reserve, and the sweep price didn't win",
  };
}
