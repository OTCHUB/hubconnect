// §A5.1 — HUB Pot MemeStock basket consolidation. Converts the treasury's per-round 13-stock
// desk-pot claim (source B) into the 4-token basket ($OTC, CRCLx, OpenAI, Anthropic) that funds
// `fund_hub_pot`. Pure decision/math logic only — no RPC/API calls, no signing, no Jupiter
// quoting. The M4/M5 sweeper service wires this to live claim balances + a real Jupiter router
// once it lands, mirroring how `arbitrage.ts`'s `decideAcquisition` is wired to live ME listings.
//
// Mirrors the spec flow exactly (docs/hubconnect-spec.md §A5.1):
//   OTC, CRCLx, ANTHROPIC, OPENAI (4 native basket stocks) → pass straight through, NO SWAP
//   the other 9 stocks → swap each to SOL → sum proceeds → split evenly 25/25/25/25 → swap
//   each 25% share SOL → its bucket token

/** The 4 MemeStock basket buckets `fund_hub_pot` accepts, in on-chain arg order. */
export type Bucket = "otc" | "crclx" | "openai" | "anthropic";
export const BUCKETS: readonly Bucket[] = ["otc", "crclx", "openai", "anthropic"];

/** The 13-stock desk-pot rotation (verified layout, spec §A2): slots 0–9 in `Config`, slots
 *  10–12 (OTC, ANDURIL, OPENAI) in `ConfigExt`. */
export const ROTATION_STOCKS = [
  "AAPLx",
  "MSFTx",
  "NVDAx",
  "AMZNx",
  "CRCLx",
  "SPCXx",
  "ANTHROPIC",
  "POLYMARKET",
  "KALSHI",
  "NEURALINK",
  "OTC",
  "ANDURIL",
  "OPENAI",
] as const;
export type RotationStock = (typeof ROTATION_STOCKS)[number];

/** Maps each of the 4 native basket stocks to its `fund_hub_pot` bucket — these pass straight
 *  through untouched, no swap needed. */
export const NATIVE_BUCKET_STOCK: Record<Bucket, RotationStock> = {
  otc: "OTC",
  crclx: "CRCLx",
  openai: "OPENAI",
  anthropic: "ANTHROPIC",
};
const NATIVE_STOCKS = new Set<RotationStock>(Object.values(NATIVE_BUCKET_STOCK));

/** The other 9 rotation stocks — swapped via a SOL intermediate hop and split evenly across
 *  the 4 buckets. */
export const SWAP_STOCKS: RotationStock[] = ROTATION_STOCKS.filter(
  (s) => !NATIVE_STOCKS.has(s),
);

export type StockBalance = {
  /** Base units claimed this round for this stock (0 is fine — just skipped). */
  units: bigint;
  /** Lamports of SOL value per 1 base unit of this stock (keeper-fed price feed). */
  lamportsPerUnit: number;
};

export type ConsolidationPlan = {
  /** The 4 native basket stocks, passed straight through — no swap instructions needed. */
  passThrough: Record<Bucket, bigint>;
  /** Per-stock swap instructions for the 9 non-basket stocks: stock → SOL. */
  stockToSolSwaps: { stock: RotationStock; unitsIn: bigint; solOutLamports: number }[];
  /** Total SOL raised by `stockToSolSwaps`, before the even 25/25/25/25 split. */
  totalSolLamports: number;
  /** Each bucket's SOL budget (⌊totalSolLamports / 4⌋; remainder dust stays unswapped, carries
   *  to next round rather than being unfairly assigned to one bucket). */
  bucketSolLamports: Record<Bucket, number>;
};

/**
 * Plans one round of §A5.1 consolidation from a per-stock claim snapshot. `balances` need not
 * include every rotation stock — anything missing/zero is treated as nothing claimed. Only pure
 * math: callers are responsible for actually executing `stockToSolSwaps` and the subsequent
 * SOL→bucket-token buys via Jupiter, then calling `fund_hub_pot` with the results.
 */
export function planBasketConsolidation(
  balances: Partial<Record<RotationStock, StockBalance>>,
): ConsolidationPlan {
  const passThrough = { otc: 0n, crclx: 0n, openai: 0n, anthropic: 0n } as Record<Bucket, bigint>;
  for (const bucket of BUCKETS) {
    const stock = NATIVE_BUCKET_STOCK[bucket];
    passThrough[bucket] = balances[stock]?.units ?? 0n;
  }

  const stockToSolSwaps: ConsolidationPlan["stockToSolSwaps"] = [];
  let totalSolLamports = 0;
  for (const stock of SWAP_STOCKS) {
    const b = balances[stock];
    if (!b || b.units <= 0n) continue;
    const solOutLamports = Math.floor(Number(b.units) * b.lamportsPerUnit);
    if (solOutLamports <= 0) continue;
    stockToSolSwaps.push({ stock, unitsIn: b.units, solOutLamports });
    totalSolLamports += solOutLamports;
  }

  const perBucket = Math.floor(totalSolLamports / BUCKETS.length);
  const bucketSolLamports = { otc: perBucket, crclx: perBucket, openai: perBucket, anthropic: perBucket };

  return { passThrough, stockToSolSwaps, totalSolLamports, bucketSolLamports };
}

/** True when a plan has anything at all to fund (pass-through units or swap-derived SOL) —
 *  the keeper should skip calling `fund_hub_pot` on an all-zero round. */
export function hasAnythingToFund(plan: ConsolidationPlan): boolean {
  return (
    BUCKETS.some((b) => plan.passThrough[b] > 0n) || plan.totalSolLamports > 0
  );
}
