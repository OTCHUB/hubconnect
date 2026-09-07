import type { TxLog } from "../../lib/swap";
import { AddressLink } from "./AddressLink";

const tone: Record<TxLog["type"], string> = {
  ok: "text-emerald-400",
  err: "text-red-400",
  sim: "text-cyan-400",
  info: "text-green-500/60",
};

/** Scrolling tx log shared by the swap + claim panels; sigs link to the explorer. */
export function TxLogView({ logs }: { logs: TxLog[] }) {
  if (!logs.length) return null;
  return (
    <div className="mt-2 max-h-40 overflow-y-auto border border-green-500/20 bg-black p-2">
      {logs.map((l, i) => (
        <div key={i} className={`break-all text-[11px] leading-snug ${tone[l.type]}`}>
          {l.msg}
          {l.sig && (
            <span className="ml-1">
              <AddressLink address={l.sig} kind="tx" label="[SCAN]" />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
