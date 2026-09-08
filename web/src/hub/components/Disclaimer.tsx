import { ESTIMATE_LABEL } from "./EarningPreview";

/** §C7 rules — always visible under the panel. */
export function Disclaimer() {
  return (
    <div className="border border-green-500/20 p-3 text-[10px] leading-relaxed text-green-700">
      <div>* {ESTIMATE_LABEL}. Live on-chain reads; no yield is guaranteed.</div>
      <div>* Tier weights are program constants; per-desk payouts fall as Σw grows.</div>
      <div>* Community tooling for the $HUB protocol — not affiliated with OTC Desks.</div>
    </div>
  );
}
