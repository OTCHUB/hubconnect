import { TIER_NAMES, TIER_WEIGHTS_BP, type ProtocolState } from "@hub-sdk";
import type { DeskLookupResult } from "../hooks/useDeskTier";
import { fmtNum, fmtSol, fmtWeight } from "../lib/format";
import { CONSIGN_WARN_LAMPORTS } from "../lib/yield";
import { AddressLink } from "./ui/AddressLink";
import { Panel, Row } from "./ui/Panel";
import { Notice } from "./ui/StateBox";

type Props = { asset: string; data: DeskLookupResult; state: ProtocolState };

export function DeskCard({ asset, data, state }: Props) {
  const { tier, consignment, unclaimed } = data;

  if (!tier) {
    return (
      <Panel title="DESK">
        <Row k="asset" v={<AddressLink address={asset} full />} />
        <div className="mt-2 text-xs text-green-700">
          <div>No DeskTier account — this desk has not been activated in $HUB.</div>
          <div>It earns the raw desk baseline only.</div>
        </div>
      </Panel>
    );
  }

  const weightBp = TIER_WEIGHTS_BP[tier.tier - 1] ?? 0;
  const warn = unclaimed !== null && unclaimed.lamports >= CONSIGN_WARN_LAMPORTS;
  const range =
    unclaimed && unclaimed.count > 0
      ? `#${fmtNum(unclaimed.fromEpoch)} → #${fmtNum(unclaimed.toEpoch)} (${unclaimed.count} ep)`
      : "none";

  return (
    <div className="space-y-2">
      {warn && (
        <Notice tone="amber">
          <div className="tracking-widest">
            [ UNCLAIMED YIELD ≥ {fmtSol(CONSIGN_WARN_LAMPORTS, 2)} ]
          </div>
          <div className="mt-1 text-amber-200/80">
            <div>~{fmtSol(unclaimed!.lamports)} is still claimable by the owner-at-activation.</div>
            <div>Claim before listing or consigning — a transfer voids the tier (§A6.1).</div>
          </div>
        </Notice>
      )}
      <Panel title="DESK TIER" right={tier.voided ? "VOIDED" : "ACTIVE"}>
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
        <Row k="activated epoch" v={`#${fmtNum(tier.activatedEpoch)}`} />
        <Row k="next claim epoch" v={`#${fmtNum(tier.nextClaimEpoch)}`} />
        <Row k="current epoch" v={`#${fmtNum(state.config.currentEpoch)}`} />
        <Row k="unclaimed range" v={range} />
        <Row
          k="unclaimed est."
          v={unclaimed ? `${fmtSol(unclaimed.lamports, 4)}${unclaimed.truncated ? "+" : ""}` : "—"}
        />
      </Panel>
      <Panel title="CONSIGNMENT">
        {consignment ? (
          <>
            <Row k="status" v={consignment.active ? "ACTIVE (in vault)" : "RETURNED"} />
            <Row k="consignor" v={<AddressLink address={consignment.consignor} />} />
            <Row k="consigned epoch" v={`#${fmtNum(consignment.consignedEpoch)}`} />
          </>
        ) : (
          <div className="text-xs text-green-700">not consigned to the treasury.</div>
        )}
      </Panel>
    </div>
  );
}
