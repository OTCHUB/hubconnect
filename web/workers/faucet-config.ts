// Tunable faucet policy — kept separate from faucet.ts so the drip sizes / cooldowns can be
// adjusted without touching the request-handling logic.

/** Per-wallet cooldown for POST /api/faucet/drip. */
export const DRIP_COOLDOWN_SECONDS = 24 * 3600;
/** Per-wallet cooldown for POST /api/faucet/mint-desk. */
export const DESK_COOLDOWN_SECONDS = 6 * 3600;
/** Secondary abuse guard, independent of the wallet cooldowns above. */
export const IP_LIMIT_PER_HOUR = 10;

/** Base units per drip (all 5 basket mints run 6 decimals — see devnet-hub-pot-mint.ts). */
export const DRIP_UNITS = {
  hub: 5_000n * 1_000_000n,
  otc: 2_000n * 1_000_000n,
  crclx: 500n * 1_000_000n,
  openai: 500n * 1_000_000n,
  anthropic: 500n * 1_000_000n,
} as const;
