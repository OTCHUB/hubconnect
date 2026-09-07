import { burnPda, potPda, treasuryPda, vaultPda, type ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { fmtBp, fmtDuration, fmtNum, fmtSol, fmtUtc } from "../lib/format";
import { AddressLink } from "./ui/AddressLink";
import { CollapsibleCard, Flag, Panel, Row, Stat } from "./ui/Panel";

/** §C6 — treasury transparency: what the protocol holds, has swept, and has burned. */
export function TreasuryPanel({ state }: { state: ProtocolState }) {
  const { programId } = useHub();
  const { config, treasury, burn, potLamports } = state;
  const pdas = {
    pot: potPda(programId)[0].toBase58(),
    burn: burnPda(programId)[0].toBase58(),
    treasury: treasuryPda(programId)[0].toBase58(),
    vault: vaultPda(programId)[0].toBase58(),
  };
  const split = `${fmtBp(config.opsPctBp, 0)} / ${fmtBp(config.burnPctBp, 0)}`;
  const potVsLiability = `${fmtSol(potLamports)} / ${fmtSol(config.potLiabilityLamports)}`;

  return (
    <div className="space-y-2">
      <Panel title="TREASURY">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
          <Stat label="desks owned" value={fmtNum(treasury.desksOwned)} sub="bought via sweeps" />
          <Stat label="desks consigned" value={fmtNum(treasury.desksConsigned)} sub="in vault" />
          <Stat label="sweeps" value={fmtNum(treasury.totalSweeps)} sub="floor buys executed" />
          <Stat label="exits" value={fmtNum(treasury.totalExits)} sub="desks sold back" />
          <Stat label="$HUB burned" value={fmtNum(burn.totalHubBurned)} sub="base units, total" />
          <Stat label="burn pending" value={fmtSol(burn.burnPendingLamports)} sub="awaiting swap" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Flag on={!config.paused} label="LIVE" />
          <Flag on={config.consignmentEnabled} label="CONSIGNMENT" />
          <Flag on={config.lpEnabled} label="LP" />
        </div>
      </Panel>

      <div className="grid gap-2 lg:grid-cols-2">
        <CollapsibleCard title="ADDRESSES" defaultOpen>
          <Row k="program" v={<AddressLink address={programId.toBase58()} />} />
          <Row k="pot (system PDA)" v={<AddressLink address={pdas.pot} />} />
          <Row k="burn state" v={<AddressLink address={pdas.burn} />} />
          <Row k="treasury state" v={<AddressLink address={pdas.treasury} />} />
          <Row k="vault (consigned custody)" v={<AddressLink address={pdas.vault} />} />
          <Row k="treasury multisig" v={<AddressLink address={config.treasury} />} />
          <Row k="ops wallet" v={<AddressLink address={config.opsWallet} />} />
          <Row k="authority" v={<AddressLink address={config.authority} />} />
          <Row k="desk collection" v={<AddressLink address={config.deskCollection} />} />
        </CollapsibleCard>

        <CollapsibleCard title="PARAMETERS" defaultOpen>
          <Row k="step fee" v={fmtSol(config.stepFeeLamports, 2)} />
          <Row k="ops / burn slice" v={split} />
          <Row k="tier weights" v={config.tierWeightsBp.map((w) => `${w / 100}%`).join(" · ")} />
          <Row k="epoch length" v={fmtDuration(config.epochDurationSecs)} />
          <Row k="genesis" v={fmtUtc(config.genesisTs)} />
          <Row k="consignor share" v={fmtBp(config.consignorShareBp, 0)} />
          <Row k="pot balance / liability" v={potVsLiability} />
        </CollapsibleCard>
      </div>
    </div>
  );
}
