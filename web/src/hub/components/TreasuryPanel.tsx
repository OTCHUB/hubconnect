import { burnPda, potPda, treasuryPda, vaultPda, type ProtocolState } from "@hub-sdk";
import { useHub } from "../HubProvider";
import { fmtBp, fmtBpPct, fmtHub, fmtNum, fmtSol, fmtUtc } from "../lib/format";
import { TREASURY_DESK_TARGET, treasuryDeskProgressPct } from "../lib/yield";
import { AddressLink } from "./ui/AddressLink";
import { CollapsibleCard, Flag, Panel, Row, Stat } from "./ui/Panel";
import { TreasuryPortfolio } from "./TreasuryPortfolio";
import { VerificationPanel } from "./VerificationPanel";

/** Identity-based (not positional) label so the breakdown stays correct regardless of the
 * order `fetchHubTokenState`'s `lockedOwners` array was built in, and degrades gracefully
 * before `init_tokenomics` has run (treasuryLockVault/airdropVault not yet known). */
function lockedHoldingLabel(owner: string, state: ProtocolState): string {
  if (owner === state.config.treasury) return "multisig";
  if (state.tokenomics?.treasuryLockVault === owner) return "treasury-lock";
  if (state.tokenomics?.airdropVault === owner) return "airdrop";
  return "vault";
}

/** §C6 — treasury transparency: what the protocol holds, has swept, and has burned. */
export function TreasuryPanel({ state }: { state: ProtocolState }) {
  const { programId } = useHub();
  const { config, treasury, burn, potLamports, supply, token, tierFee } = state;
  const d = supply.decimals;
  const pdas = {
    pot: potPda(programId)[0].toBase58(),
    burn: burnPda(programId)[0].toBase58(),
    treasury: treasuryPda(programId)[0].toBase58(),
    vault: vaultPda(programId)[0].toBase58(),
  };
  // Two distinct, unrelated skims — never the same pie: `opsPctBp` is the ops cut of the desk-
  // holder's own activation/upgrade SOL fee (§A4); `protocolFeeBp` is skimmed off
  // *treasury-controlled* revenue (sweeps/exits/misc inflows, HUB-Pot basket deposits) before it
  // becomes staker/desk-holder yield (§A5 revenue-model extension) — see `PROTOCOL_FEE_BP`.
  const opsSplit = `${fmtBp(config.opsPctBp, 0)} activation / ${fmtBp(config.protocolFeeBp, 0)} treasury`;
  const potVsLiability = `${fmtSol(potLamports)} / ${fmtSol(config.potLiabilityLamports)}`;
  const tierStepFee = tierFee
    ? tierFee.tierStepFeeLamports.map((v) => fmtSol(v, 2)).join(" · ")
    : `${fmtSol(config.stepFeeLamports, 2)} (legacy default)`;

  return (
    <div className="space-y-2">
      <Panel title="TREASURY">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="desks owned"
            value={fmtNum(treasury.desksOwned)}
            sub={`bought via sweeps · ${treasuryDeskProgressPct(treasury.desksOwned)}% of ${fmtNum(TREASURY_DESK_TARGET)} target`}
          />
          <Stat label="sweeps" value={fmtNum(treasury.totalSweeps)} sub="floor buys executed" />
          <Stat label="exits" value={fmtNum(treasury.totalExits)} sub="desks sold back" />
          <Stat
            label="$HUB burned"
            value={fmtHub(supply.burnedUnits, d)}
            sub={`ledger ${fmtNum(burn.totalHubBurned)} units${supply.ledgerDrift ? " · drift" : ""}`}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Flag on={!config.paused} label="LIVE" />
          <Flag on={config.lpEnabled} label="LP" />
        </div>
      </Panel>

      <Panel title="TREASURY LOCKS" right="what the treasury's holdings are earmarked for">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Stat
            label="LP provisioning"
            value={config.lpEnabled ? "ACTIVE" : "PENDING"}
            sub="liquidity for the $HUB / $OTC pair — seeded from treasury OTC + $HUB once price holds ≥24h post-launch"
          />
          <Stat
            label="yield buffer"
            value={fmtHub(supply.lockedUnits, d)}
            sub="treasury-held $HUB + swept desks that keep tier payouts sustainable as Σw grows"
          />
        </div>
      </Panel>

      <Panel title="$HUB SUPPLY" right={`max ${fmtHub(supply.maxUnits, d, 0)}`}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="burn % of circulating"
            value={
              <span className="text-orange-300">{fmtBpPct(supply.burnPctOfCirculatingBp)}</span>
            }
            sub="burned ÷ circulating"
          />
          <Stat
            label="burn % of max"
            value={fmtBpPct(supply.burnPctOfMaxBp)}
            sub={`${fmtHub(supply.burnedUnits, d)} destroyed`}
          />
          <Stat
            label="circulating"
            value={fmtHub(supply.circulatingUnits, d)}
            sub="max − burned − locked"
          />
          <Stat
            label="treasury / locked"
            value={fmtHub(supply.lockedUnits, d)}
            sub={token.holdings
              .map((h) => `${lockedHoldingLabel(h.owner, state)} ${fmtHub(h.units, d)}`)
              .join(" · ")}
          />
          <Stat
            label="mint supply (live)"
            value={fmtHub(supply.mintSupplyUnits, d)}
            sub={
              token.mint
                ? token.mint.mintAuthority
                  ? "⚠ mint authority set"
                  : "mint authority revoked"
                : "mint not found"
            }
          />
        </div>
      </Panel>

      <TreasuryPortfolio state={state} />

      <VerificationPanel state={state} />

      <div className="grid gap-2 lg:grid-cols-2">
        <CollapsibleCard title="ADDRESSES" defaultOpen>
          <Row k="program" v={<AddressLink address={programId.toBase58()} />} />
          <Row k="$HUB mint" v={<AddressLink address={config.hubMint} />} />
          <Row k="pot (system PDA)" v={<AddressLink address={pdas.pot} />} />
          <Row k="burn state" v={<AddressLink address={pdas.burn} />} />
          <Row k="treasury state" v={<AddressLink address={pdas.treasury} />} />
          <Row k="vault (LP custody)" v={<AddressLink address={pdas.vault} />} />
          <Row k="treasury multisig" v={<AddressLink address={config.treasury} />} />
          {state.tokenomics && (
            <>
              <Row
                k="treasury-lock vault (2% floor)"
                v={<AddressLink address={state.tokenomics.treasuryLockVault} />}
              />
              <Row
                k="airdrop vault"
                v={<AddressLink address={state.tokenomics.airdropVault} />}
              />
            </>
          )}
          <Row k="ops wallet" v={<AddressLink address={config.opsWallet} />} />
          <Row k="authority" v={<AddressLink address={config.authority} />} />
          <Row k="desk collection" v={<AddressLink address={config.deskCollection} />} />
        </CollapsibleCard>

        <CollapsibleCard title="PARAMETERS" defaultOpen>
          <Row k="tier step fee (T1-T4)" v={tierStepFee} />
          <Row k="ops fees" v={opsSplit} />
          <Row k="round burn cut" v={fmtBp(config.burnPctBp, 0)} />
          <Row k="tier weights" v={config.tierWeightsBp.map((w) => `${w / 100}%`).join(" · ")} />
          <Row k="round threshold" v={fmtSol(config.minPotThresholdLamports, 2)} />
          <Row k="genesis" v={fmtUtc(config.genesisTs)} />
          <Row k="pot balance / liability" v={potVsLiability} />
        </CollapsibleCard>
      </div>
    </div>
  );
}
