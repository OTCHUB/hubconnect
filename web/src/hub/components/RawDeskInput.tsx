type Props = { valueSol: string; onChange: (v: string) => void };

/** Baseline row input — what a plain (un-activated) desk earns per day, entered in SOL. */
export function RawDeskInput({ valueSol, onChange }: Props) {
  return (
    <label className="flex items-center gap-2 text-[10px] text-green-600">
      raw desk / day
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.001"
        value={valueSol}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 border border-green-500/30 bg-black px-1 py-0.5 text-right text-xs text-green-300 outline-none focus:border-green-400"
      />
      SOL
    </label>
  );
}
