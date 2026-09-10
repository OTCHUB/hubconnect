// Tunable faucet policy — kept separate from faucet.ts so the drip sizes / cooldowns can be
// adjusted without touching the request-handling logic.

/** Per-wallet cooldown for POST /api/faucet/drip (tokens + desk NFT, one combined request). */
export const DRIP_COOLDOWN_SECONDS = 8 * 3600;
/** Per-wallet cooldown for POST /api/faucet/mint-desk (standalone extra-desk mint). */
export const DESK_COOLDOWN_SECONDS = 8 * 3600;
/** Secondary abuse guard, independent of the wallet cooldowns above. */
export const IP_LIMIT_PER_HOUR = 10;

/** Base units per drip (all 5 basket mints run 6 decimals — see devnet-hub-pot-mint.ts). */
export const DRIP_UNITS = {
  hub: 100_000n * 1_000_000n,
  otc: 100_000n * 1_000_000n,
  crclx: 10n * 1_000_000n,
  nvdax: 10n * 1_000_000n,
  spcxx: 10n * 1_000_000n,
} as const;
