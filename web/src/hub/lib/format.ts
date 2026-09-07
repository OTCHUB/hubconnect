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

/** "HH:MM:SS" remaining until `endTs`; clamps at zero. */
export const fmtCountdown = (endTs: number, nowTs: number) => {
  const s = Math.max(0, endTs - nowTs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((x) => String(x).padStart(2, "0")).join(":");
};

export const fmtDuration = (secs: number) => {
  if (secs % 86400 === 0) return `${secs / 86400}d`;
  if (secs % 3600 === 0) return `${secs / 3600}h`;
  return `${Math.floor(secs / 60)}m`;
};
