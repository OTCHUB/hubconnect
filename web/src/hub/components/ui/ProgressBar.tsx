const ASCII_CELLS = 32;

// red (0%) -> orange -> yellow (~50-80%) -> neon green (100%), interpolated per filled cell so
// the bar itself reads as a heat gradient climbing toward the target.
function cellColor(t: number): string {
  if (t < 0.5) return t < 0.25 ? "text-red-500" : "text-orange-400";
  return t < 0.8 ? "text-yellow-500" : "text-green-400";
}

type ProgressBarProps = {
  /** 0..1 progress toward the target. */
  frac: number;
  /** Caption shown after the percentage, e.g. "to graduation" or "to threshold". */
  suffix?: string;
  /** Fraction at/above which the bar pulses and the caption bolds to flag urgency. */
  imminentAt?: number;
};

/**
 * The app's one progress-bar primitive — the ASCII block heat-gradient loader (red → yellow →
 * neon green climbing left→right, `flex-wrap` so it never overflows narrow viewports). Pulses
 * once `frac` clears `imminentAt` to signal the final stretch. Shared by `EpochTracker`
 * (round-close threshold) and the bonding curve panel (graduation progress).
 */
export function ProgressBar({
  frac,
  suffix = "to graduation",
  imminentAt = 0.8,
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, frac * 100));
  const imminent = pct / 100 >= imminentAt;

  const filled = Math.round((pct / 100) * ASCII_CELLS);
  return (
    <div className="mt-1 font-mono">
      <div
        className={`flex flex-wrap text-sm leading-none tracking-tighter ${imminent ? "animate-pulse" : ""}`}
      >
        <span className="text-green-700">[</span>
        {Array.from({ length: ASCII_CELLS }, (_, i) => (
          <span key={i} className={i < filled ? cellColor(i / ASCII_CELLS) : "text-green-900"}>
            {i < filled ? "█" : "░"}
          </span>
        ))}
        <span className="text-green-700">]</span>
      </div>
      <div
        className={`mt-0.5 text-right text-[10px] ${imminent ? "font-bold text-green-400" : "text-green-600"}`}
      >
        {pct.toFixed(2)}% {suffix}
        {imminent ? " — IMMINENT" : ""}
      </div>
    </div>
  );
}
