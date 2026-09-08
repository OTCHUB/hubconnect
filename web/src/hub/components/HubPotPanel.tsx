import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { hubPotClaimPda, hubPotPda, hubPotShareUnits, type HubPotRoundView } from "@hub-sdk";
import { useHub } from "../HubProvider";
import type { OwnedDesk } from "../hooks/useWalletPortfolio";
import { useHubPot, type HubPotDecimals } from "../hooks/useHubPot";
import { executeClaimHubPotReward, type HubPotClaimPhase } from "../lib/hubPotClaim";
import { fmtNum, fmtUnits } from "../lib/format";
import type { TxLog } from "../lib/swap";
import { AddressLink } from "./ui/AddressLink";
import { Panel, Row, Stat } from "./ui/Panel";
import { TxLogView } from "./ui/TxLogView";

const BUCKET_LABELS = {
  otc: "$OTC",
  crclx: "CRCLx",
  openai: "OpenAI",
  anthropic: "Anthropic",
} as const;
type BucketKey = keyof typeof BUCKET_LABELS;
const BUCKET_KEYS = Object.keys(BUCKET_LABELS) as BucketKey[];
const btn = "border px-2.5 py-1 text-[12px] disabled:opacity-30";

/** Sums an active desk's `hubPotShareUnits` estimate across every bucket, for every desk owned
 *  by the wallet — mirrors the on-chain per-desk `reward_share` floor-division exactly. */
function estimateWalletShare(round: HubPotRoundView, desks: OwnedDesk[]) {
  const total: Record<BucketKey, bigint> = { otc: 0n, crclx: 0n, openai: 0n, anthropic: 0n };
  for (const d of desks) {
    if (!d.tier || d.tier.voided) continue;
    const share = hubPotShareUnits(round, d.tier.tier);
    total.otc += share.otc;
    total.crclx += share.crclx;
    total.openai += share.openai;
    total.anthropic += share.anthropic;
  }
  return total;
}

type Props = { desks?: OwnedDesk[]; address?: string | null };

/** §A5.1 — the "M.I.M ETF" (Magic Internet Money ETF): the 4-bucket MemeStock basket ($OTC /
 *  CRCLx / OpenAI / Anthropic) an activated desk owner can claim — one desk at a time or in bulk
 *  across every desk they own (client-batched `claim_hub_pot_reward` ixs, pro-rata to each desk's
 *  tier weight), the same self-serve pull `claim_airdrop` uses. `distribute_hub_pot_reward`
 *  remains as an authority-run fallback push for desks whose owners don't self-claim — both share
 *  one `HubPotClaim` receipt per (round, desk), so a desk is paid at most once per round. */
export function HubPotPanel({ desks, address }: Props) {
  const { connection, program, programId, resolveSigner } = useHub();
  const qc = useQueryClient();
  const q = useHubPot();
  const pot = q.data?.pot ?? null;
  const decimals = q.data?.decimals ?? null;
  const round = q.data?.latestRound ?? null;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<HubPotClaimPhase | null>(null);
  const [logs, setLogs] = useState<TxLog[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const activeDesks = (desks ?? []).filter((d) => d.tier && !d.tier.voided);
  const claimStatus = useQuery({
    queryKey: [
      "hub",
      "hubPotClaims",
      programId.toBase58(),
      round?.index,
      activeDesks.map((d) => d.asset).join(","),
    ],
    enabled: round != null && activeDesks.length > 0,
    queryFn: async () => {
      const keys = activeDesks.map(
        (d) => hubPotClaimPda(programId, round!.index, new PublicKey(d.asset))[0],
      );
      const infos = await connection.getMultipleAccountsInfo(keys, "confirmed");
      return new Set(activeDesks.filter((_, i) => infos[i]).map((d) => d.asset));
    },
  });

  if (q.isPending) {
    return (
      <Panel title="M.I.M ETF :: MEMESTOCK BASKET">
        <div className="text-xs text-green-700">loading…</div>
      </Panel>
    );
  }

  if (!pot || !decimals) {
    return (
      <Panel title="M.I.M ETF :: MEMESTOCK BASKET">
        <div className="text-xs text-green-700">
          not provisioned yet — {`init_hub_pot`} has not been called on this cluster.
        </div>
      </Panel>
    );
  }

  const myShare = round && activeDesks.length ? estimateWalletShare(round, activeDesks) : null;
  const claimedAssets = claimStatus.data ?? new Set<string>();
  const claimRows = (round ? activeDesks : [])
    .filter((d) => !claimedAssets.has(d.asset))
    .map((d) => ({ ...d, share: hubPotShareUnits(round!, d.tier!.tier) }))
    .filter(
      (d) =>
        d.share.otc > 0n || d.share.crclx > 0n || d.share.openai > 0n || d.share.anthropic > 0n,
    );
  const signer = address ? resolveSigner(address) : null;

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
    if (!round || !pot) return;
    const targets = (
      selected.size ? claimRows.filter((r) => selected.has(r.asset)) : claimRows
    ).map((r) => r.asset);
    if (!targets.length) return setErr("nothing to claim — no active desk has an unclaimed share");
    setBusy(true);
    setLogs([]);
    const res = await executeClaimHubPotReward({
      connection,
      program,
      signer,
      assets: targets,
      roundIndex: round.index,
      pot,
      onLog: (l) => setLogs((p) => [...p, l]),
      onPhase: setPhase,
    });
    setBusy(false);
    setPhase(null);
    if (res.some((r) => r.ok)) {
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ["hub"] });
    }
  };

  return (
    <Panel
      title="M.I.M ETF :: MEMESTOCK BASKET"
      right={`round ${fmtNum(pot.roundCount)} · pending fund`}
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {BUCKET_KEYS.map((b) => (
          <Stat
            key={b}
            label={BUCKET_LABELS[b]}
            value={fmtUnits(pot[`${b}PendingUnits` as const], decimals[b])}
            sub={`lifetime ${fmtUnits(pot[`${b}DepositedUnits` as const], decimals[b])}`}
          />
        ))}
      </div>

      {round ? (
        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-green-600">
            latest round #{fmtNum(round.index)}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {BUCKET_KEYS.map((b) => (
              <Stat
                key={b}
                label={BUCKET_LABELS[b]}
                value={fmtUnits(round[`${b}Units` as const], decimals[b])}
                sub={`paid ${fmtUnits(round[`${b}DistributedUnits` as const], decimals[b])} · ${fmtNum(round.claims)} claims`}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 text-[11px] text-green-700">
          no round opened yet — {`open_hub_pot_round`} snapshots pending balances once funded.
        </div>
      )}

      {myShare && round && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-green-600">
            your total share — round #{fmtNum(round.index)} ({fmtNum(activeDesks.length)} active
            desk{activeDesks.length === 1 ? "" : "s"})
          </div>
          {BUCKET_KEYS.map((b) => (
            <Row key={b} k={BUCKET_LABELS[b]} v={fmtUnits(myShare[b], decimals[b])} />
          ))}
        </div>
      )}

      {address && round && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-green-600">
            claim per desk or in bulk — {fmtNum(claimRows.length)} unclaimed this round
          </div>
          {claimRows.length === 0 ? (
            <div className="text-xs text-green-700">
              nothing unclaimed for round #{fmtNum(round.index)} — either no active desk has a share
              yet, or it's already been paid (self-claim or authority push).
            </div>
          ) : (
            <div className="max-h-52 overflow-y-auto border border-green-500/20">
              {claimRows.map((r) => (
                <label
                  key={r.asset}
                  className={`flex cursor-pointer items-center gap-2 border-b border-green-500/10 px-2 py-1.5 text-xs last:border-0 ${
                    selected.has(r.asset) ? "bg-emerald-500/10" : "hover:bg-green-500/5"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(r.asset)}
                    disabled={busy}
                    onChange={() => toggle(r.asset)}
                    className="accent-emerald-500"
                  />
                  <span className="min-w-0 flex-1">
                    <AddressLink address={r.asset} />
                  </span>
                  <span className="text-right text-emerald-300">
                    {BUCKET_KEYS.filter((b) => r.share[b] > 0n)
                      .map((b) => `${fmtUnits(r.share[b], decimals[b])} ${BUCKET_LABELS[b]}`)
                      .join(" · ")}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy || !claimRows.length}
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
          </div>
          {!signer && (
            <div className="mt-1 text-[10px] text-amber-400/80">
              read-only address — connect the wallet itself (WALLET_CONNECT) to sign claims.
            </div>
          )}
          {err && <div className="mt-2 text-[11px] text-amber-400">ERR: {err}</div>}
          <TxLogView logs={logs} />
        </div>
      )}

      <div className="mt-3 text-[10px] text-green-700">
        pot config <AddressLink address={hubPotPda(programId)[0].toBase58()} /> · self-claim via{" "}
        {`claim_hub_pot_reward`}, or wait for the authority-run {`distribute_hub_pot_reward`} push —
        same one-payout-per-desk-per-round guard either way.
      </div>
    </Panel>
  );
}
