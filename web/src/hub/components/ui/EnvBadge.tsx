import { useHub } from "../../HubProvider";
import { useRpcCluster } from "../../hooks/useRpcCluster";
import type { HubCluster } from "../../lib/explorer";

const LABEL: Record<HubCluster, string> = {
  "mainnet-beta": "MAINNET",
  devnet: "DEVNET",
  localnet: "LOCALNET",
};

// Mainnet = live money (green, solid); devnet/localnet = test (amber, dashed) — never confusable.
const TONE: Record<HubCluster, string> = {
  "mainnet-beta": "border-emerald-500 bg-emerald-500/10 text-emerald-300",
  devnet: "border-dashed border-amber-500 bg-amber-500/10 text-amber-300",
  localnet: "border-dashed border-slate-500 bg-slate-500/10 text-slate-300",
};

/**
 * Environment badge: configured cluster (VITE_HUB_CLUSTER / HubProvider prop) cross-checked
 * against the RPC's genesis hash. A mismatch turns the badge red — the label would be lying.
 */
export function EnvBadge() {
  const { cluster } = useHub();
  const rpc = useRpcCluster();

  const mismatch = (rpc.kind === "known" || rpc.kind === "custom") && !rpc.matches;
  const dot =
    rpc.kind === "checking"
      ? "animate-pulse text-green-600"
      : mismatch
        ? "text-red-400"
        : rpc.kind === "error"
          ? "text-amber-500"
          : "text-current";
  const title =
    rpc.kind === "checking"
      ? "verifying RPC genesis hash…"
      : rpc.kind === "error"
        ? "could not verify RPC cluster (getGenesisHash failed)"
        : mismatch
          ? `RPC is on ${rpc.kind === "known" ? LABEL[rpc.cluster] : "a custom network"} — configured ${LABEL[cluster]}`
          : `RPC genesis hash confirms ${LABEL[cluster]}`;

  const tone = mismatch ? "border-red-500 bg-red-500/10 text-red-300" : TONE[cluster];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-[10px] font-bold tracking-widest ${tone}`}
    >
      <span className={dot}>●</span>
      {LABEL[cluster]}
      {mismatch && (
        <span className="font-normal">
          ≠ RPC:{rpc.kind === "known" ? LABEL[rpc.cluster] : "CUSTOM"}
        </span>
      )}
    </span>
  );
}
