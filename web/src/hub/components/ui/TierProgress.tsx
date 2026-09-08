import { TIER_NAMES } from "@hub-sdk";

/** Per-tier accent (border/bg/text) — T1..T4 escalate in visual weight, VOIDED/RAW stay neutral. */
const TIER_TONE = [
  "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
  "border-amber-500/40 bg-amber-500/10 text-amber-300",
];
const TIER_FILL = ["bg-cyan-400", "bg-emerald-400", "bg-fuchsia-400", "bg-amber-400"];

/** Compact status pill: RAW (not activated) / T1..T4 tier name / VOIDED — one glance = status. */
export function TierBadge({
  tier,
  voided = false,
  className = "",
}: {
  tier: number;
  voided?: boolean;
  className?: string;
}) {
  const base = "border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest";
  if (voided) {
    return (
      <span className={`${base} border-red-500/40 bg-red-500/10 text-red-400 ${className}`}>
        VOIDED
      </span>
    );
  }
  if (!tier) {
    return (
      <span className={`${base} border-green-500/20 text-green-700 ${className}`}>
        RAW · NOT ACTIVATED
      </span>
    );
  }
  const tone = TIER_TONE[tier - 1] ?? TIER_TONE[0];
  return (
    <span className={`${base} ${tone} ${className}`}>{TIER_NAMES[tier - 1] ?? `T${tier}`}</span>
  );
}

/** 4-segment ladder (T1..T4): filled up to the current tier, dim beyond it — the path to T4. */
export function TierLadder({
  tier,
  maxTier = 4,
  voided = false,
}: {
  tier: number;
  maxTier?: number;
  voided?: boolean;
}) {
  const fill = TIER_FILL[Math.max(0, tier - 1)] ?? TIER_FILL[0];
  return (
    <div
      className="flex items-center gap-0.5"
      title={
        voided
          ? "tier voided — desk changed hands since activation"
          : tier
            ? `T${tier} of T${maxTier}${tier < maxTier ? " — room to upgrade" : " — max tier"}`
            : `not activated — T${maxTier} max`
      }
    >
      {Array.from({ length: maxTier }, (_, i) => i + 1).map((t) => (
        <span key={t} className={`h-1.5 w-4 ${t <= tier && !voided ? fill : "bg-green-500/10"}`} />
      ))}
    </div>
  );
}
