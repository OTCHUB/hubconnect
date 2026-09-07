import { BPS, HUB_DECIMALS, LAMPORTS_PER_SOL } from "@hub-sdk";

export const lamportsToSol = (l: number) => l / LAMPORTS_PER_SOL;

export const fmtSol = (lamports: number | null | undefined, d = 3) =>
  lamports == null || Number.isNaN(lamports) ? "—" : `${lamportsToSol(lamports).toFixed(d)} SOL`;

export const fmtNum = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "—" : v.toLocaleString();

export const fmtBp = (bp: number, d = 1) => `${(bp / 100).toFixed(d)}%`;

/** bp → percent with adaptive precision: 12 → "0.12%", 1_234 → "12.34%", 123_456 → "1,234.6%". */
export const fmtBpPct = (bp: number | null | undefined) => {
  if (bp == null || Number.isNaN(bp)) return "—";
  const pct = bp / 100;
  if (pct >= 1000) return `${pct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  if (pct >= 10) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(pct > 0 && pct < 0.01 ? 4 : 2)}%`;
};

/** Compact scale: 1_250_000_000 → "1.25B", 42_000_000 → "42.0M", 9_500 → "9.5K", 812 → "812". */
export const fmtCompact = (v: number | bigint | null | undefined, d = 2) => {
  if (v == null) return "—";
  const x = typeof v === "bigint" ? Number(v) : v;
  if (Number.isNaN(x)) return "—";
  const abs = Math.abs(x);
  const unit =
    abs >= 1e12
      ? ["T", 1e12]
      : abs >= 1e9
        ? ["B", 1e9]
        : abs >= 1e6
          ? ["M", 1e6]
          : abs >= 1e3
            ? ["K", 1e3]
            : null;
  if (!unit) return x.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const [suffix, div] = unit as [string, number];
  const scaled = x / div;
  return `${scaled.toFixed(scaled >= 100 ? Math.max(0, d - 1) : d)}${suffix}`;
};

/** Token base units → whole tokens (Number; $HUB max 1e9 × 1e6 = 1e15 fits safely). */
export const unitsToTokens = (units: bigint | number, decimals = HUB_DECIMALS) =>
  Number(units) / 10 ** decimals;

/** Whole-token count with thousands separators, e.g. "1,000,000,000". */
export const fmtTokens = (units: bigint | number | null | undefined, decimals = HUB_DECIMALS) =>
  units == null
    ? "—"
    : unitsToTokens(units, decimals).toLocaleString(undefined, { maximumFractionDigits: 0 });

/** Compact whole-token count with ticker, e.g. "998.75M $HUB". */
export const fmtHub = (
  units: bigint | number | null | undefined,
  decimals = HUB_DECIMALS,
  d = 2,
) => (units == null ? "—" : `${fmtCompact(unitsToTokens(units, decimals), d)} $HUB`);

/** Tier weight (bp) as a multiplier, e.g. 12_500 → "1.25x". */
export const fmtWeight = (bp: number) => `${(bp / BPS).toFixed(2)}x`;

export const shortKey = (k: string, n = 4) =>
  k.length > n * 2 + 1 ? `${k.slice(0, n)}…${k.slice(-n)}` : k;

/** Host only — RPC URLs may carry provider API keys in the query string. */
export const rpcHost = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url.split("?")[0];
  }
};

export const fmtUtc = (ts: number) =>
  new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16) + "Z";

/** Compact elapsed time, e.g. "3d 4h", "2h 05m", "7m 12s". */
export const fmtDuration = (secs: number) => {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
};
