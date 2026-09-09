// Tunable bonding-curve policy — kept separate from bonding-curve.ts so the curve shape /
// graduation target can be retuned without touching the request-handling logic. Mirrors the
// pump.fun-style "virtual reserves" constant-product design: the curve starts priced as if
// `VIRTUAL_SOL_LAMPORTS` of SOL sat against the full real $HUB float, so price starts low and
// rises smoothly as real SOL comes in — without needing an actual 30 SOL deposit up front.

/** Virtual SOL-side reserve at curve genesis (no real SOL backs this — it only shapes price). */
export const VIRTUAL_SOL_LAMPORTS = 30_000_000_000n; // 30 SOL

/** Real SOL raised that triggers graduation to a real Raydium CP-Swap pool. Kept small relative
 * to pump.fun's 85 SOL mainnet default so a devnet demo can be run through end-to-end without
 * needing a large amount of devnet SOL. */
export const GRADUATION_TARGET_LAMPORTS = 10_000_000_000n; // 10 SOL

/** $HUB decimals (matches HUB_DECIMALS in programs/hub/src/constants.rs). */
export const HUB_DECIMALS = 6;

/** Max age of a deposit signature the Worker will still honor for a buy/sell redemption —
 * bounds how long a client can sit on a confirmed deposit before claiming its curve output. */
export const DEPOSIT_MAX_AGE_SECONDS = 10 * 60;

/** Replay-guard TTL for a consumed deposit signature (KV key `curve:tx:<signature>`). */
export const TX_REPLAY_TTL_SECONDS = 24 * 3600;

/** Number of recent trades kept in the KV-backed live-activity feed. */
export const TRADE_LOG_LIMIT = 50;

/** Rent-exempt floor the curve wallet always keeps back from a `sell` SOL payout, so it never
 * closes its own account trying to pay out its entire balance. */
export const CURVE_WALLET_MIN_LAMPORTS = 5_000_000n; // 0.005 SOL

/** Extra native-SOL safety margin (beyond Raydium CP-Swap's fixed create_pool_fee) reserved from
 * the curve wallet's balance when graduating: covers rent for the ~6 new accounts `initialize`
 * creates (pool_state, lp_mint, both vaults, observation_state, creator_lp_token ATA) plus tx
 * fees. Graduation defers (retried on the next request) rather than risk an underfunded tx. */
export const GRADUATION_RENT_BUFFER_LAMPORTS = 50_000_000n; // 0.05 SOL
