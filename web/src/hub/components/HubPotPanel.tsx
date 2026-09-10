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
  crclx: "CRCLX",
  openai: "OPENAI",
  anthropic: "ANTHROPIC",
} as const;
type BucketKey = keyof typeof BUCKET_LABELS;
const BUCKET_KEYS = Object.keys(BUCKET_LABELS) as BucketKey[];
const RETRO_BTN = "border px-2.5 py-1 text-[12px] disabled:opacity-30";
const PRIMARY_BTN = `${RETRO_BTN} border-emerald-500/60 font-bold text-emerald-300 hover:bg-emerald-500/10`;
const GHOST_BTN = `${RETRO_BTN} border-green-500/30 text-green-500/70`;

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
      <Panel title="M.I.M ETF">
        <div className="text-xs text-green-700">loading…</div>
      </Panel>
    );
  }

  if (!pot || !decimals) {
    return (
      <Panel title="M.I.M ETF">
        <div className="text-xs text-green-700">
          Not live yet on this cluster — the pot hasn't been initialized.
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

  const potAddress = hubPotPda(programId)[0].toBase58();

  const mutedCls = "text-green-700";
  const sectionLabelCls = "mb-1.5 text-[10px] uppercase tracking-widest text-green-600";
  const pillCls =
    "inline-flex items-center gap-1.5 rounded-none border border-green-500 bg-green-500/10 px-2 py-1 text-[10px] font-bold tracking-widest text-green-300";
  const listContainerCls =
    "max-h-52 divide-y divide-green-500/10 overflow-y-auto rounded-none border border-green-500/20";
  const footerCls =
    "mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-green-500/20 pt-3 text-[10px] text-green-800";
  const disclaimerCls = "mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-green-800";

  return (
    <Panel title="M.I.M ETF">
      <p className="text-[10px] uppercase tracking-widest text-green-600">
        Magic Internet Money Basket
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-green-400/90">
        A tier-weighted basket of $OTC, CRCLx, OPENAI, and ANTHROPIC. Funded by treasury yield
        rebalancing: 13 stocks consolidated into 4 native tickers. Pure yield, zero cost.
      </p>

      <div className="mt-3">
        <span className={pillCls}>
          Round {fmtNum(pot.roundCount)} · {round ? "Live" : "Pending Fund"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {BUCKET_KEYS.map((b) => (
          <Stat
            key={b}
            label={BUCKET_LABELS[b]}
            value={fmtUnits(pot[`${b}PendingUnits` as const], decimals[b])}
            sub={`Lifetime ${fmtUnits(pot[`${b}DepositedUnits` as const], decimals[b])}`}
          />
        ))}
      </div>

      {round ? (
        <div className="mt-4">
          <div className={sectionLabelCls}>Round #{fmtNum(round.index)}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BUCKET_KEYS.map((b) => (
              <Stat
                key={b}
                label={BUCKET_LABELS[b]}
                value={fmtUnits(round[`${b}Units` as const], decimals[b])}
                sub={`Paid ${fmtUnits(round[`${b}DistributedUnits` as const], decimals[b])} · ${fmtNum(round.claims)} claims`}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className={`mt-4 text-xs ${mutedCls}`}>No active round — snapshots pending.</div>
      )}

      {myShare && round && (
        <div className="mt-4">
          <div className={sectionLabelCls}>
            Your share · round #{fmtNum(round.index)} ({fmtNum(activeDesks.length)} desk
            {activeDesks.length === 1 ? "" : "s"})
          </div>
          {BUCKET_KEYS.map((b) => (
            <Row key={b} k={BUCKET_LABELS[b]} v={fmtUnits(myShare[b], decimals[b])} />
          ))}
        </div>
      )}

      {address && round && (
        <div className="mt-4">
          <div className={sectionLabelCls}>Claim · {fmtNum(claimRows.length)} unclaimed</div>
          {claimRows.length === 0 ? (
            <div className={`text-xs ${mutedCls}`}>
              Nothing unclaimed this round — no active desk has a share yet, or it's already been
              paid.
            </div>
          ) : (
            <div className={listContainerCls}>
              {claimRows.map((r) => (
                <label
                  key={r.asset}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-xs transition ${
                    selected.has(r.asset) ? "bg-green-500/10" : "hover:bg-green-500/5"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(r.asset)}
                    disabled={busy}
                    onChange={() => toggle(r.asset)}
                    className="accent-green-500"
                  />
                  <span className="min-w-0 flex-1">
                    <AddressLink address={r.asset} />
                  </span>
                  <span className="text-right text-green-300">
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
              className={PRIMARY_BTN}
            >
              {busy
                ? `${phase ?? "prep"}…`
                : selected.size
                  ? `Claim selected (${selected.size})`
                  : "Claim all"}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={busy || !selected.size}
              className={GHOST_BTN}
            >
              Clear
            </button>
          </div>
          {!signer && (
            <div className="mt-1 text-[10px] text-amber-300/80">
              Read-only address — connect the wallet itself (Wallet Connect) to sign claims.
            </div>
          )}
          {err && <div className="mt-2 text-xs text-amber-300">{err}</div>}
          <TxLogView logs={logs} />
        </div>
      )}

      <div className={footerCls}>
        <span>
          pot config <AddressLink address={potAddress} />
        </span>
        <span aria-hidden>·</span>
        <span>claim_hub_pot_reward / distribute_hub_pot_reward</span>
      </div>

      <div className={disclaimerCls}>
        <span aria-hidden>ⓘ</span>
        <span>
          OPENAI and ANTHROPIC are Pre-IPO tickers native to the OTC Desks ecosystem — not equity,
          shares, or any claim on the real companies OpenAI or Anthropic.
        </span>
      </div>
    </Panel>
  );
}
