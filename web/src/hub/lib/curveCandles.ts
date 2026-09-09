// OHLC candle building for the post-graduation "finalized curve" chart (PriceCandles.tsx).
// Mirrors otchub's dexCandles.js bucketing heuristic, but the source data is different: the
// $HUB bonding curve never trades against a real DEX feed (GeckoTerminal/DexScreener don't index
// devnet pools), so there's no OHLCV API to bootstrap from. Instead this derives candles straight
// from the curve's own trade log (workers/bonding-curve.ts's `pushTrade`), which GET
// /api/curve/trades keeps returning after graduation — the dataset is frozen the instant the curve
// graduates (no further curve trades are possible once `graduated: true`), so "live tick" handling
// isn't needed: every candle here is genuinely historical.
import type { CurveTrade } from "./curve";

export type Candle = { t: number; o: number; h: number; l: number; c: number };

/** Fixed-size timeframe buckets, sized for a bonding curve that typically fills in minutes-to-hours
 *  rather than the days/weeks a real token chart spans. */
export const CANDLE_TFS = { "1M": 60_000, "5M": 5 * 60_000, "15M": 15 * 60_000, "1H": 3_600_000 };
export type CandleTf = keyof typeof CANDLE_TFS | "ALL";

/** SOL price per whole $HUB implied by a single curve trade (solLamports / hubUnits, decimal- and
 *  lamport-scaled). Returns 0 for degenerate trades (shouldn't occur, but keeps callers total). */
export function tradePriceSol(t: CurveTrade, dec: number): number {
  const sol = Number(t.solLamports) / 1e9;
  const hub = Number(t.hubUnits) / 10 ** dec;
  return hub > 0 ? sol / hub : 0;
}

/** Buckets ascending (ts, price) points into OHLC candles at a fixed bucket size in ms. */
function bucketPoints(points: { t: number; v: number }[], ms: number): Candle[] {
  const map = new Map<number, Candle>();
  for (const p of points) {
    const b = Math.floor(p.t / ms) * ms;
    const c = map.get(b);
    if (!c) map.set(b, { t: b, o: p.v, h: p.v, l: p.v, c: p.v });
    else {
      if (p.v > c.h) c.h = p.v;
      if (p.v < c.l) c.l = p.v;
      c.c = p.v;
    }
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

/** Builds the full OHLC series for a timeframe from the curve's (frozen) trade history. "ALL"
 *  adaptively doubles the 1-minute bucket until the whole history fits in ~96 candles — same
 *  heuristic otchub's own "ALL" fallback view uses. `unit` "USD" scales every candle by `solUsd`
 *  (a single present-day reference rate — there's no historical SOL/USD series to draw on, so this
 *  is a linear unit conversion of the real SOL-denominated history, not an independently-sourced
 *  historical USD price). */
export function buildCurveCandles(
  trades: CurveTrade[],
  dec: number,
  tf: CandleTf,
  unit: "SOL" | "USD",
  solUsd: number | null,
): Candle[] {
  const scale = unit === "USD" && solUsd != null ? solUsd : 1;
  const points = trades
    .map((t) => ({ t: t.ts, v: tradePriceSol(t, dec) * scale }))
    .filter((p) => p.v > 0)
    .sort((a, b) => a.t - b.t);
  if (!points.length) return [];
  if (tf !== "ALL") return bucketPoints(points, CANDLE_TFS[tf]);
  let ms = CANDLE_TFS["1M"];
  const span = points[points.length - 1].t - points[0].t;
  while (span / ms > 96) ms *= 2;
  return bucketPoints(points, ms);
}
