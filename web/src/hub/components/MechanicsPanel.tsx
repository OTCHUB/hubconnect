import { TIER_NAMES, type ProtocolState } from "@hub-sdk";
import { fmtBp, fmtSol, fmtWeight } from "../lib/format";
import {
  ACTIVATION_DIAGRAM,
  BUYBACK_LP_DIAGRAM,
  FEE_FLOW_DIAGRAM,
  TREASURY_DIAGRAM,
} from "../lib/mechanicsDiagrams";
import { CollapsibleCard, Panel, Row } from "./ui/Panel";

const p = "text-xs leading-relaxed text-green-400/90";
const li = "ml-4 list-disc text-xs leading-relaxed text-green-400/90";

/** Raw Mermaid.js source, rendered as text (no mermaid runtime bundled) — paste into mermaid.live
 * or any Markdown host that renders Mermaid to view the graphic. */
function MermaidBlock({ source }: { source: string }) {
  return (
    <div className="mt-2">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-green-600">
        mermaid.js source — paste into mermaid.live to render
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre border border-green-500/20 bg-black p-2 text-[10px] leading-snug text-green-500/80">
        {source}
      </pre>
    </div>
  );
}

/** §A4-A7 mechanics explainer — activation, fee split, treasury flywheel, buyback/LP — grounded in
 * ConfigView / EpochView / DeskTierView (sdk/src/reader.ts) and docs/hubconnect-spec.md. */
export function MechanicsPanel({ state }: { state: ProtocolState }) {
  const { config } = state;
  return (
    <div className="space-y-2">
      <Panel title="HOW $HUB WORKS">
        <p className={p}>
          Four mechanics tie every $HUB flow together: activation turns SOL (or $OTC) into a
          weighted claim on the pot; the pot splits into burn + staker yield every round; the
          treasury grows its own desk stack to feed extra yield into that same pot; and burn + LP
          policy keep supply shrinking while depth grows. Nothing here is taken from other OTC
          participants — only added buy pressure and pot funding (spec §A1).
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Row k="burn / round" v={fmtBp(config.burnPctBp)} />
          <Row k="ops / step fee" v={fmtBp(config.opsPctBp)} />
          <Row k="round threshold" v={fmtSol(config.minPotThresholdLamports)} />
          <Row k="consignor share" v={fmtBp(config.consignorShareBp)} />
        </div>
      </Panel>

      <CollapsibleCard title="1. $HUB ACTIVATION LIFECYCLE" defaultOpen>
        <ul className="space-y-1">
          <li className={li}>
            Tiers bind to a specific desk NFT asset id (Metaplex Core), not a wallet — burn-based,
            never lock-based, so it never conflicts with the launcher's per-wallet OTC stream.
            <code className="ml-1 text-green-300">activate_tier</code> /{" "}
            <code className="text-green-300">activate_tier_otc</code> re-verify current desk
            ownership on-chain inside the instruction, then stamp{" "}
            <code className="text-green-300">DeskTier.stamp_acc_per_weight</code> to{" "}
            <code className="text-green-300">Config.acc_per_weight</code> at that instant — only
            rounds closed after the stamp are owed to this desk.
          </li>
          <li className={li}>
            {config.tierWeightsBp.map((w, i) => `${TIER_NAMES[i]} ${fmtWeight(w)}`).join(" · ")} —
            each step costs {fmtSol(config.stepFeeLamports)}, split 90% → pot (source A) / 10% → ops
            wallet.
          </li>
          <li className={li}>
            Steps can instead be paid in $OTC at a fixed 2.00x premium of the SOL value (
            <code className="text-green-300">OTC_PREMIUM_BP</code>, not updatable), using the
            authority-refreshed <code className="text-green-300">OtcPayConfig.otc_per_sol</code>{" "}
            (rejected if stale &gt; 24h). 100% of that $OTC lands in the POL reserve (the{" "}
            <code className="text-green-300">["vault"]</code> PDA's $OTC ATA) — never the pot or ops
            wallet — and can only leave via <code className="text-green-300">build_lp</code>. An
            $OTC-paid step adds weight without adding SOL inflow to the round.
          </li>
          <li className={li}>
            <code className="text-green-300">claim_yield</code> applies <b>lazy revocation</b>: it
            re-checks ownership right now; a transferred desk is voided (no refund) and drops out of
            Σw. Otherwise it pays{" "}
            <code className="text-green-300">floor((acc_per_weight − stamp) × w / 1e12)</code> for
            every round closed since the stamp in one transaction, then resets the stamp.{" "}
            <code className="text-green-300">upgrade_tier(_otc)</code> only charges the step
            difference under the same rules.
          </li>
        </ul>
        <MermaidBlock source={ACTIVATION_DIAGRAM} />
      </CollapsibleCard>

      <CollapsibleCard title="2. FEE DISTRIBUTION FLOW">
        <ul className="space-y-1">
          <li className={li}>
            Six channels feed the open round's <code className="text-green-300">Epoch</code>
            .inflow_lamports: <b>A</b> activation fees (the 90% pot leg of every step payment),{" "}
            <b>B</b> treasury-owned desks' desk-pot claims, <b>C</b> the treasury's OTC-stock
            proceeds from its ≤2%-of-supply $HUB float, <b>D</b> the 50% SOL leg of every discount
            exit, <b>E</b> consigned desks' desk-pot claims, and <b>F</b> harvested LP swap fees.
          </li>
          <li className={li}>
            Distribution is <b>threshold-gated, not clocked</b>:{" "}
            <code className="text-green-300">finalize_epoch</code> reverts until inflow plus whole
            lamports of <code className="text-green-300">dust_scaled</code> carried from earlier
            rounds reaches {fmtSol(config.minPotThresholdLamports)}, and succeeds the instant that's
            true — a round can close in seconds or take days depending on flow.
          </li>
          <li className={li}>
            At finalize:{" "}
            <code className="text-green-300">
              burn = floor({fmtBp(config.burnPctBp, 0)} × inflow)
            </code>{" "}
            is set aside for the buyback-burn keeper; the remainder is spread across every basis
            point of activated weight as{" "}
            <code className="text-green-300">per_weight = floor(distributable × 1e12 / Σw)</code>,
            and <code className="text-green-300">Config.acc_per_weight</code> (lifetime u128) rises
            by that amount. Sub-lamport remainders accumulate in{" "}
            <code className="text-green-300">dust_scaled</code> and re-enter the very next round —
            no lamport is ever silently lost.
          </li>
          <li className={li}>
            Because the accumulator is lifetime and cumulative, one{" "}
            <code className="text-green-300">claim_yield</code> settles every round closed since a
            desk's last claim in a single transaction — there is no per-round claiming to catch up.
          </li>
        </ul>
        <MermaidBlock source={FEE_FLOW_DIAGRAM} />
      </CollapsibleCard>

      <CollapsibleCard title="3. TREASURY DESK ACQUISITION & YIELD BOOST">
        <ul className="space-y-1">
          <li className={li}>
            Acquisition follows a strict <b>sweep, never dilute</b> rule: sweep_cost (Magic Eden
            list price × 1.07 for taker fee + royalty) is compared against mint_cost (100,000 $OTC
            in SOL + 0.5 SOL); the treasury only sweeps when sweep_cost &lt; mint_cost — minting is
            policy-disabled because it burns 100k $OTC and dilutes the desk-pot for everyone. Every
            sweep is capped at ≤10% of treasury SOL per desk and only targets verified non-empty
            vault stock; <code className="text-green-300">TreasuryState.desks_owned</code>{" "}
            increments on success.
          </li>
          <li className={li}>
            Any owner can also volunteer a desk without selling it:{" "}
            <code className="text-green-300">consign_desk</code> moves the NFT into the treasury
            vault PDA and writes a <code className="text-green-300">ConsignedDesk</code> record
            (asset_id → consignor, consigned_epoch, active);{" "}
            <code className="text-green-300">desks_consigned</code> increments and the owner keeps
            the withdrawal right via <code className="text-green-300">unconsign_desk</code> once the
            consignment round finalizes (never double-counted).
          </li>
          <li className={li}>
            The treasury claims OTC desk-pot rounds for every owned + consigned desk, then books the
            SOL via <code className="text-green-300">register_treasury_inflow</code> (source B) or{" "}
            <code className="text-green-300">register_consigned_inflow</code> (source E). Consignor
            share ({fmtBp(config.consignorShareBp)}, default 0%) can route a cut of consigned
            proceeds to the consignor's <code className="text-green-300">StakerAccrual</code>
            (claimable via <code className="text-green-300">claim_accrual</code>); the remainder
            becomes ordinary pot inflow.
          </li>
          <li className={li}>
            <b>The "yield boost"</b>: every treasury or consigned desk's take is folded into the
            same round inflow that feeds <code className="text-green-300">acc_per_weight</code>, so
            it raises per_weight for every activated tier proportional to its fixed weight —{" "}
            {config.tierWeightsBp.map((w, i) => `${TIER_NAMES[i]} ${fmtWeight(w)}`).join(" / ")}.
            The boost is shared pro-rata, not tier-specific: a bigger treasury desk stack means
            larger yield for all activated desks, with zero dilution.
          </li>
          <li className={li}>
            Discount exits are a release valve, not a business model: sale_value = 0.90 × live
            floor, split 50/50 — the HUB leg burns in the sale transaction, the SOL leg becomes pot
            inflow (source D). The treasury claims all accrued vault yield before listing so the
            buyer receives the desk clean; consigned desks are permanently excluded from the exit
            pool — the <code className="text-green-300">ConsignedDesk</code> record blocks any
            transfer/sale attempt at the program level.
          </li>
        </ul>
        <MermaidBlock source={TREASURY_DIAGRAM} />
      </CollapsibleCard>

      <CollapsibleCard title="4. BUYBACK & LP PROVISIONING">
        <ul className="space-y-1">
          <li className={li}>
            Buyback-burn is deterministic on-chain math with an off-chain executor: every{" "}
            <code className="text-green-300">finalize_epoch</code> earmarks{" "}
            {fmtBp(config.burnPctBp, 0)} of round inflow into{" "}
            <code className="text-green-300">BurnState.burn_pending_lamports</code>. A keeper (spec
            M4, not yet deployed) converts that pending balance into a TWAP'd market buy of $HUB and
            executes an spl-token <code className="text-green-300">Burn</code> — the mint's own
            supply drop is the burn proof, cross-checked against{" "}
            <code className="text-green-300">BurnState.total_hub_burned</code> for drift.
          </li>
          <li className={li}>
            A second, immediate sink runs outside that loop: every treasury discount exit burns 50%
            of its sale value directly in the sale transaction, independent of the per-round 10%
            burn.
          </li>
          <li className={li}>
            <b>Phase 1 ($HUB/SOL) is free by construction</b>: launching through the OTC launcher
            means bonding-curve graduation migrates the curve's accumulated SOL + $HUB straight into
            a protocol-owned AMM pool — the treasury seeds nothing on day one. The LP manager stays
            passive (harvesting swap fees into the pot as source F) unless live impact degrades past
            the reference ceiling (~100 SOL-side depth: keep a 5 SOL trade under ~5% impact and the
            hourly 10%-burn chunk under ~1%); any top-up pairs the founding $HUB allocation with
            treasury SOL (ops surplus) only — never a market buy of $HUB for LP.
          </li>
          <li className={li}>
            <b>Phase 2 ($HUB/OTC)</b> opens only once price has held stable ≥14 days post-launch. It
            seeds ~25–50 SOL-equivalent per side by pairing treasury OTC (claimed via source C from
            the treasury's ≤2%-of-supply $HUB float) with treasury HUB float — tightening the
            OTC↔HUB rotation stakers already earn without an extra SOL hop. Every LP position is
            treasury-PDA-custodied and HODL-only; the treasury never sells $HUB out of LP.
          </li>
        </ul>
        <MermaidBlock source={BUYBACK_LP_DIAGRAM} />
      </CollapsibleCard>
    </div>
  );
}
