// Shared keeper SOL gas-float watermarks + pure gate logic. Every keeper signs its own
// txs (fees, and for the creator-fee/LP keepers, priority fees on Jupiter/Raydium CPI
// txs) from its own hot-wallet balance — separate from any SOL a keeper transiently
// holds mid-cycle as pass-through (e.g. `record_creator_fee_ops`'s post-swap SOL, which
// lands in `Config.ops_wallet` in the same instruction it's booked, never idling in the
// keeper's own balance). No program-level `fund_keeper` instruction exists by design:
// topping up a keeper hot wallet is an ordinary wallet-to-wallet transfer, same trust
// model as any other bot funding, performed manually by the multisig from `ops_wallet`
// (which already accumulates the 5% ops-SOL leg every creator-fee clear cycle).
//
// Pure decision logic only — no RPC/signing. Mirrors `sweeper/src/arbitrage.ts`'s shape.

/** Hard floor: below this, refuse to start a new cycle — risk of dying mid-sequence
 *  with partial on-chain state (e.g. mid-way through the four creator-fee leg draws). */
export const KEEPER_HARD_MIN_LAMPORTS = 20_000_000; // 0.02 SOL

/** Drip trigger: pre-flight check before starting a cycle. Leaves roughly one full
 *  cycle of headroom (~0.03 SOL) above the hard min so a cycle never starts only to
 *  run dry partway through. */
export const KEEPER_DRIP_TRIGGER_LAMPORTS = 50_000_000; // 0.05 SOL

/** Target ceiling: a drip refills the balance back up to here — enough for roughly
 *  6–10 unattended cycles, small enough that idle SOL in a hot wallet isn't a
 *  meaningful custody risk. */
export const KEEPER_TARGET_CEILING_LAMPORTS = 300_000_000; // 0.3 SOL

export type GasFloatCheck =
  { ok: true; requestDripLamports: number } | { ok: false; reason: string };

/**
 * Pre-flight gate for any keeper cycle. `ok: false` means don't even attempt the
 * cycle — log/alert instead. `ok: true` carries `requestDripLamports`, which is > 0
 * once the balance has fallen below the drip trigger (refill-to-ceiling, not a fixed
 * bump, so it self-corrects regardless of how fast the float drained); the caller
 * still proceeds with the cycle in that case since the hard min hasn't been breached.
 */
export function checkGasFloat(
  balanceLamports: number,
  hardMinLamports: number = KEEPER_HARD_MIN_LAMPORTS,
  dripTriggerLamports: number = KEEPER_DRIP_TRIGGER_LAMPORTS,
  targetCeilingLamports: number = KEEPER_TARGET_CEILING_LAMPORTS,
): GasFloatCheck {
  if (balanceLamports < hardMinLamports) {
    return {
      ok: false,
      reason: `balance ${balanceLamports} lamports below hard min ${hardMinLamports} — refusing to start a cycle; needs a manual drip from ops_wallet`,
    };
  }
  const requestDripLamports =
    balanceLamports < dripTriggerLamports
      ? Math.max(0, targetCeilingLamports - balanceLamports)
      : 0;
  return { ok: true, requestDripLamports };
}
