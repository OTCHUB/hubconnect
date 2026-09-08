import { useState } from "react";
import { tokenomicsPda, type ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { useTokenomics } from "../hooks/useTokenomics";
import { fmtBpPct, fmtHub, fmtNum, fmtTokens, fmtUtc } from "../lib/format";
import {
  MAX_DESK_SUPPLY,
  NEXT_DESK_SUPPLY_MILESTONE,
  deskMilestoneProgressPct,
} from "../lib/yield";
import { AddressLink } from "./ui/AddressLink";
import { PieChart, type PieSlice } from "./ui/PieChart";
import { CollapsibleCard, Flag, Panel, Row, Stat } from "./ui/Panel";

const COLORS: Record<string, string> = {
  public: "#22c55e",
  treasury: "#f59e0b",
  airdrop: "#38bdf8",
  team: "#6b7280",
};

/** §A7.1 — supply allocation, airdrop status, and the Dexscreener token-info payload. */
export function TokenomicsPanel({ state }: { state: ProtocolState }) {
  const { programId } = useHub();
  const q = useTokenomics(state);
  const [copied, setCopied] = useState(false);
  const d = state.supply.decimals;

  if (q.isPending) return <Panel title="TOKENOMICS">loading allocation plan…</Panel>;
  if (q.error) {
    return (
      <Panel title="TOKENOMICS">
        <span className="text-red-400">{(q.error as Error).message}</span>
      </Panel>
    );
  }
  const { onChain, collection, deskCount, deskCountSource, plan, dexscreener } = q.data!;
  const slices: PieSlice[] = plan.slices.map((s) => ({
    id: s.id,
    label: s.label,
    value: Number(s.units / 10n ** BigInt(d)),
    color: COLORS[s.id] ?? "#4ade80",
    amount: fmtHub(s.units, d),
    share: fmtBpPct(s.bp),
  }));
  const source = onChain ? "on-chain · TokenomicsConfig" : "preview · init_tokenomics not run";
  const claimedPct =
    onChain && onChain.airdropUnits > 0n
      ? Number((onChain.airdropClaimedUnits * 10_000n) / onChain.airdropUnits)
      : null;

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(dexscreener, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-2">
      <Panel title="TOKENOMICS" right={source}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="max supply"
            value={fmtHub(plan.maxUnits, d, 0)}
            sub="minted once · authority revoked"
          />
          <Stat
            label="desks"
            value={fmtNum(deskCount)}
            sub={
              deskCountSource === "snapshot"
                ? `snapshot ${onChain ? fmtUtc(onChain.snapshotTs) : ""}`
                : deskCountSource === "live"
                  ? `live · ${fmtNum(collection?.numMinted ?? 0)} minted lifetime`
                  : "collection unreadable"
            }
          />
          <Stat
            label="supply milestone"
            value={`${deskMilestoneProgressPct(deskCount)}%`}
            sub={`${fmtNum(deskCount)} → ${fmtNum(NEXT_DESK_SUPPLY_MILESTONE)} next · ${fmtNum(MAX_DESK_SUPPLY)} max`}
          />
          <Stat
            label="airdrop pool"
            value={fmtHub(plan.airdropUnits, d)}
            sub={`${fmtTokens(plan.airdropPerDeskUnits, d)} $HUB × ${fmtNum(deskCount)} desks`}
          />
          <Stat
            label="treasury lock"
            value={fmtHub(plan.treasuryLockUnits, d)}
            sub="held for creator-fee collection · never sold"
          />
        </div>
        <div className="mt-3">
          <PieChart slices={slices} centerLabel={fmtBpPct(plan.slices[0].bp)} centerSub="public" />
        </div>
        {plan.overAllocated && (
          <div className="mt-2 text-xs text-red-400">
            airdrop + treasury lock exceed max supply — the program rejects this snapshot
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Flag on={!!onChain} label="PLAN RECORDED" />
          <Flag on={!!onChain?.airdropRootSet} label="SNAPSHOT" />
          <Flag on={!!onChain?.airdropOpen} label="CLAIMS OPEN" />
          <Flag on={plan.teamUnits === 0n} label="0% TEAM" />
        </div>
      </Panel>

      <Panel title="AIRDROP">
        <Row
          k="mechanism"
          v="Merkle claim · one claim per desk asset · paid to the desk's current owner"
        />
        <Row k="per desk" v={`${fmtTokens(plan.airdropPerDeskUnits, d)} $HUB`} />
        <Row k="pool" v={fmtHub(plan.airdropUnits, d)} />
        <Row
          k="claimed"
          v={
            onChain
              ? `${fmtHub(onChain.airdropClaimedUnits, d)} · ${fmtNum(onChain.airdropClaims)} claims${claimedPct != null ? ` · ${fmtBpPct(claimedPct)}` : ""}`
              : "—"
          }
        />
        <Row
          k="root"
          v={
            onChain?.airdropRootSet ? (
              <span className="break-all">{onChain.airdropRoot}</span>
            ) : (
              "not published"
            )
          }
        />
        <Row
          k="funding account"
          v={onChain ? <AddressLink address={onChain.airdropVault} /> : "—"}
        />
        <Row
          k="tokenomics PDA"
          v={<AddressLink address={tokenomicsPda(programId)[0].toBase58()} />}
        />
      </Panel>

      <CollapsibleCard
        title="DEXSCREENER · TOKEN INFO"
        right={
          <button type="button" onClick={copy} className="text-green-500 hover:text-green-300">
            {copied ? "copied" : "[copy json]"}
          </button>
        }
      >
        <div className="mb-2 text-[10px] text-green-700">
          Payload for the Enhanced Token Info submission: supply facts with proof accounts,
          allocation split, airdrop status. Amounts are whole $HUB.
        </div>
        <pre className="max-h-96 overflow-auto text-[10px] text-green-300">
          {JSON.stringify(dexscreener, null, 2)}
        </pre>
      </CollapsibleCard>
    </div>
  );
}
