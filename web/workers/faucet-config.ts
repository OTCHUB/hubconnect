// Tunable faucet policy — kept separate from faucet.ts so the drip sizes / cooldowns can be
// adjusted without touching the request-handling logic.

/** Per-wallet cooldown for POST /api/faucet/drip (tokens + desk NFT, one combined request). */
export const DRIP_COOLDOWN_SECONDS = 8 * 3600;
/** Per-wallet cooldown for POST /api/faucet/mint-desk (standalone extra-desk mint). */
export const DESK_COOLDOWN_SECONDS = 8 * 3600;
/** Per-wallet cooldown for POST /api/faucet/sol (gas top-up) — mirrors DRIP_COOLDOWN_SECONDS so a
 *  tester only has to think about one cooldown window. */
export const SOL_COOLDOWN_SECONDS = DRIP_COOLDOWN_SECONDS;
/** Secondary abuse guard, independent of the wallet cooldowns above. */
export const IP_LIMIT_PER_HOUR = 10;

/** Lamports sent per /api/faucet/sol claim — just enough for a brand-new wallet to exist as a
 *  fee-payer and cover a handful of tx fees (5,000 lamports/sig) plus activate_tier's flat SOL
 *  step fee at T1. Not meant to fully fund testing — point big asks at https://faucet.solana.com. */
export const SOL_DRIP_LAMPORTS = 5_000_000n; // 0.005 SOL
/** Lamports the faucet always keeps for its own tx fees before honoring a /api/faucet/sol claim. */
export const SOL_FAUCET_RESERVE_LAMPORTS = 50_000_000n; // 0.05 SOL

/** Base units per drip (all 5 basket mints run 6 decimals — see devnet-hub-pot-mint.ts). */
export const DRIP_UNITS = {
  hub: 100_000n * 1_000_000n,
  otc: 100_000n * 1_000_000n,
  crclx: 10n * 1_000_000n,
  nvdax: 10n * 1_000_000n,
  spcxx: 10n * 1_000_000n,
} as const;
