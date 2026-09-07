import { TIER_NAMES, TIER_WEIGHTS_BP, type ProtocolState } from "@hub-sdk";
import type { DeskLookupResult } from "../hooks/useDeskTier";
import { fmtNum, fmtSol, fmtWeight } from "../lib/format";
import { magicEdenItemUrl } from "../lib/marketplace";
import { CONSIGN_WARN_LAMPORTS } from "../lib/yield";
import { AddressLink } from "./ui/AddressLink";
import { Panel, Row } from "./ui/Panel";
import { Notice } from "./ui/StateBox";

type Props = { asset: string; data: DeskLookupResult; state: ProtocolState };

export function DeskCard({ asset, data, state }: Props) {
  const { tier, consignment, pending } = data;

  const meLink = (
    <a
      href={magicEdenItemUrl(asset)}
      target="_blank"
      rel="noreferrer"
      className="text-cyan-400 hover:text-cyan-200"
      title="view this desk on Magic Eden"
    >
      [MAGIC EDEN ↗]
    </a>
  );

  if (!tier) {
    return (
      <Panel title="DESK" right={meLink}>
        <Row k="asset" v={<AddressLink address={asset} full />} />
        <div className="mt-2 text-xs text-green-700">
          <div>No DeskTier account — this desk has not been activated in $HUB.</div>
          <div>It earns the raw desk baseline only.</div>
        </div>
      </Panel>
    );
  }

  const weightBp = TIER_WEIGHTS_BP[tier.tier - 1] ?? 0;
  const warn = pending !== null && pending.lamports >= CONSIGN_WARN_LAMPORTS;
  const roundsSince = pending
    ? pending.rounds === 0
      ? "current — nothing closed since last claim"
      : `${fmtNum(pending.rounds)}${pending.truncated ? "+" : ""} closed round(s), one claim tx`
    : "—";

  return (
    <div className="space-y-2">
      {warn && (
        <Notice tone="amber">
          <div className="tracking-widest">
            [ UNCLAIMED YIELD ≥ {fmtSol(CONSIGN_WARN_LAMPORTS, 2)} ]
          </div>
          <div className="mt-1 text-amber-200/80">
            <div>
              {fmtSol(pending!.lamports)} is claimable by the owner-at-activation in one tx.
            </div>
            <div>Claim before listing or consigning — a transfer voids the tier (§A6.1).</div>
          </div>
        </Notice>
      )}
      <Panel
        title="DESK TIER"
        right={
          <>
            {meLink} · {tier.voided ? "VOIDED" : "ACTIVE"}
          </>
        }
      >
        <Row k="asset" v={<AddressLink address={asset} full />} />
        <Row
          k="tier"
          v={
            <span className={tier.voided ? "line-through text-green-800" : "text-green-200"}>
              {TIER_NAMES[tier.tier - 1] ?? `T${tier.tier}`} · {fmtWeight(weightBp)}
            </span>
          }
        />
        <Row k="owner at activation" v={<AddressLink address={tier.ownerAtActivation} />} />
        <Row k="activated round" v={`#${fmtNum(tier.activatedEpoch)}`} />
        <Row k="open round" v={`#${fmtNum(state.config.currentEpoch)}`} />
        <Row k="unclaimed" v={roundsSince} />
        <Row
          k="pending yield"
          v={
            pending ? (
              <span className={pending.lamports > 0 ? "text-green-200" : undefined}>
                {fmtSol(pending.lamports, 4)}
              </span>
            ) : (
              "—"
            )
          }
        />
        <Row k="lifetime claimed" v={fmtSol(tier.totalClaimedLamports, 4)} />
        <div className="mt-2 text-[10px] text-green-700">
          pending = ⌊(acc − stamp) × w / 10¹²⌋ — exact program math, settles every closed round in a
          single claim_yield.
        </div>
      </Panel>
      <Panel title="CONSIGNMENT">
        {consignment ? (
          <>
            <Row k="status" v={consignment.active ? "ACTIVE (in vault)" : "RETURNED"} />
            <Row k="consignor" v={<AddressLink address={consignment.consignor} />} />
            <Row k="consigned round" v={`#${fmtNum(consignment.consignedEpoch)}`} />
          </>
        ) : (
          <div className="text-xs text-green-700">not consigned to the treasury.</div>
        )}
      </Panel>
    </div>
  );
}
