import { SCENARIOS, type Scenario } from "../lib/yield";

type Props = { value: Scenario; onChange: (s: Scenario) => void };

/** §C5 — three-way scenario toggle rendered as DOS radio buttons. */
export function ScenarioToggle({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-1 text-[10px]" role="radiogroup" aria-label="scenario">
      {SCENARIOS.map((s) => {
        const on = s.id === value;
        const tone = on
          ? "border-green-400 bg-green-500/10 text-green-200"
          : "border-green-500/30 text-green-600 hover:text-green-300";
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={s.hint}
            onClick={() => onChange(s.id)}
            className={`border px-2 py-0.5 tracking-widest ${tone}`}
          >
            ({on ? "●" : " "}) {s.label}
          </button>
        );
      })}
    </div>
  );
}
