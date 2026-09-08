import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { otcDueForLamports, pendingYieldLamports, TIER_NAMES, type ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";
import type { OwnedDesk } from "../hooks/useWalletPortfolio";
import { executeClaimYield, type ClaimPhase } from "../lib/claim";
import { fmtNum, fmtSol, fmtUnits } from "../lib/format";
import { magicEdenItemUrl } from "../lib/marketplace";
import type { TxLog } from "../lib/swap";
import { AddressLink } from "./ui/AddressLink";
import { Panel } from "./ui/Panel";
import { TxLogView } from "./ui/TxLogView";

type Props = { address: string; state: ProtocolState; desks: OwnedDesk[]; onClaimed?: () => void };

/** $OTC mint decimals fallback when no ATA balance has been fetched to read the real value from. */
const OTC_DECIMALS = 6;

const btn = "border px-2.5 py-1 text-[12px] disabled:opacity-30";

/** CLAIM_PORTAL — `claim_yield` for the wallet's activated desks, paid in $OTC (§A5 90% leg). */
export function ClaimPanel({ address, state, desks, onClaimed }: Props) {
  const { connection, program, resolveSigner } = useHub();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<ClaimPhase | null>(null);
  const [logs, setLogs] = useState<TxLog[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const otcPot = state.otcPot;
  const otcReady = !!otcPot && otcPot.totalLamportsSpent > 0;
  const rows = desks
    .filter((d) => d.tier && !d.tier.voided)
    .map((d) => ({ ...d, pending: pendingYieldLamports(d.tier!, state.config) }))
    .sort((a, b) => b.pending - a.pending);
  const claimable = rows.filter((r) => r.pending > 0);
  const totalPending = claimable.reduce((s, r) => s + r.pending, 0);
  const totalOtcDue = otcDueForLamports(totalPending, otcPot);
  const signer = resolveSigner(address);

  const toggle = (a: string) =>
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });

  const run = async () => {
    setErr(null);
    if (!signer) return setErr("read-only address — connect the wallet itself to sign claims");
    if (!otcReady)
      return setErr(
        !otcPot
          ? "$OTC yield vault not provisioned yet — nothing to claim into"
          : "keeper hasn't recorded an $OTC buy yet — try again shortly",
      );
    const targets = (
      selected.size ? claimable.filter((r) => selected.has(r.asset)) : claimable
    ).map((r) => r.asset);
    if (!targets.length) return setErr("nothing to claim — no activated desk has pending yield");
    setBusy(true);
    setLogs([]);
    const res = await executeClaimYield({
      connection,
      program,
      signer,
      assets: targets,
      config: state.config,
      otcPot,
      onLog: (l) => setLogs((p) => [...p, l]),
      onPhase: setPhase,
    });
    setBusy(false);
    setPhase(null);
    if (res.some((r) => r.ok)) {
      setSelected(new Set());
      // Stamps moved on-chain: refresh protocol + wallet reads so pending drops to 0.
      await qc.invalidateQueries({ queryKey: ["hub"] });
      onClaimed?.();
    }
  };

  return (
    <Panel title="CLAIM_PORTAL :: YIELD → WALLET" right={`${fmtNum(claimable.length)} claimable`}>
      {rows.length === 0 ? (
        <div className="text-xs text-green-700">
          no activated desks in this wallet — activate a desk to start accruing pot yield.
        </div>
      ) : (
        <div className="max-h-52 overflow-y-auto border border-green-500/20">
          {rows.map((r) => (
            <label
              key={r.asset}
              className={`flex cursor-pointer items-center gap-2 border-b border-green-500/10 px-2 py-1.5 text-xs last:border-0 ${
                selected.has(r.asset) ? "bg-emerald-500/10" : "hover:bg-green-500/5"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(r.asset)}
                disabled={busy || r.pending === 0}
                onChange={() => toggle(r.asset)}
                className="accent-emerald-500"
              />
              <span className="min-w-0 flex-1">
                <AddressLink address={r.asset} />
                <span className="ml-2 text-cyan-300">
                  {TIER_NAMES[r.tier!.tier - 1] ?? `T${r.tier!.tier}`}
                </span>
              </span>
              <a
                href={magicEdenItemUrl(r.asset)}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-green-600 hover:text-green-300"
                title="view this desk on Magic Eden"
              >
                [ME ↗]
              </a>
              <span
                className={`w-28 text-right ${r.pending > 0 ? "text-emerald-300" : "text-green-700"}`}
              >
                {fmtSol(r.pending, 4)}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={busy || !claimable.length || !otcReady}
          className={`${btn} border-emerald-500/60 font-bold text-emerald-300 hover:bg-emerald-500/10`}
        >
          {busy
            ? `${(phase ?? "prep").toUpperCase()}…`
            : selected.size
              ? `[CLAIM_SELECTED (${selected.size})]`
              : "[CLAIM_ALL]"}
        </button>
        <button
          type="button"
          onClick={() => setSelected(new Set())}
          disabled={busy || !selected.size}
          className={`${btn} border-green-500/30 text-green-500/70`}
        >
          [CLEAR]
        </button>
        <span className="text-[11px] text-green-600">
          pending total {fmtSol(totalPending, 4)}
          {totalOtcDue != null ? ` ≈ ${fmtUnits(totalOtcDue, OTC_DECIMALS)} $OTC` : ""} · 1 wallet
          prompt · ~{Math.ceil(claimable.length / 3) || 0} tx
        </span>
      </div>
      {!signer && (
        <div className="mt-1 text-[10px] text-amber-400/80">
          read-only address — connect the wallet itself (WALLET_CONNECT) to sign claims.
        </div>
      )}
      {signer && !otcReady && (
        <div className="mt-1 text-[10px] text-amber-400/80">
          {!otcPot
            ? "$OTC yield vault not provisioned yet — claim_yield will revert until it is."
            : "keeper hasn't recorded an $OTC buy yet — claim_yield will revert until it does."}
        </div>
      )}
      {err && <div className="mt-2 text-[11px] text-amber-400">ERR: {err}</div>}
      <TxLogView logs={logs} />
      <div className="mt-2 text-[10px] text-green-700">
        pending = ⌊(acc − stamp) × w / 10¹²⌋ lamport-equivalent, paid in $OTC from the keeper-fed
        vault at the pot's lifetime average buy rate. Each tx is simulated unsigned first; a failing
        sim is dropped with no fee spent.
      </div>
    </Panel>
  );
}
