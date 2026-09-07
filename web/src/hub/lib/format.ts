import { BPS, LAMPORTS_PER_SOL } from "@hub-sdk";

export const lamportsToSol = (l: number) => l / LAMPORTS_PER_SOL;

export const fmtSol = (lamports: number | null | undefined, d = 3) =>
  lamports == null || Number.isNaN(lamports) ? "—" : `${lamportsToSol(lamports).toFixed(d)} SOL`;

export const fmtNum = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? "—" : v.toLocaleString();

export const fmtBp = (bp: number, d = 1) => `${(bp / 100).toFixed(d)}%`;

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
