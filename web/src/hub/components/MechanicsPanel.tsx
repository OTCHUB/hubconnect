import {
  HUB_DECIMALS,
  TIER_HUB_COST_UNITS,
  TIER_NAMES,
  cumulativeFeeLamports,
  type ProtocolState,
} from "@hub-sdk";
import { fmtBp, fmtSol, fmtUnits, fmtWeight } from "../lib/format";
import { yieldBoostPctOverBase } from "../lib/yield";
import {
  ACTIVATION_DIAGRAM,
  BUYBACK_LP_DIAGRAM,
  FEE_FLOW_DIAGRAM,
  TREASURY_DIAGRAM,
} from "../lib/mechanicsDiagrams";
import { CollapsibleCard, Panel, Row } from "./ui/Panel";
import { FlywheelDiagram } from "./ui/FlywheelDiagram";

const p = "text-xs leading-relaxed text-green-400/90";
const li = "ml-4 list-disc text-xs leading-relaxed text-green-400/90";

/** Raw Mermaid.js source, rendered as text (no mermaid runtime bundled) — paste into mermaid.live
 * or any Markdown host that renders Mermaid to view the graphic. */
function MermaidBlock({ source, title }: { source: string; title?: string }) {
  return (
    <div className="mt-2">
      <div className="mb-1 text-[10px] uppercase tracking-widest text-green-600">
        {title ?? "diagram"} — paste into mermaid.live to view
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre border border-green-500/20 bg-black p-2 text-[10px] leading-snug text-green-500/80">
        {source}
      </pre>
    </div>
  );
}

/** Investor-facing mechanics explainer — the Buy → Activate → Earn → Burn cycle, activation
 * costs, and reward flow — in plain terms, grounded in ConfigView (sdk/src/reader.ts). Full
 * technical detail (instructions, PDAs, accumulator math) is intentionally left out here; see
 * docs/hubconnect-spec.md §A4-A7 for that level of detail. */
export function MechanicsPanel({ state }: { state: ProtocolState }) {
  const { config } = state;
  return (
    <div className="space-y-2">
      <Panel title="HOW $HUB WORKS">
        <p className={p}>
          $HUB turns every OTC desk NFT into a yield-earning position. Activate a desk and it starts
          collecting a share of Protocol Revenue every reward round — funded entirely by protocol
          activity, never taken from other holders. A slice of that same revenue buys back and burns
          $HUB every round, permanently shrinking the supply that's left.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Row k="burn rate / round" v={fmtBp(config.burnPctBp)} />
          <Row k="protocol fee" v={fmtBp(config.opsPctBp)} />
          <Row k="reward round trigger" v={fmtSol(config.minPotThresholdLamports)} />
        </div>
        <FlywheelDiagram />
      </Panel>

      <CollapsibleCard title="1. ACTIVATE YOUR DESK" defaultOpen>
        <ul className="space-y-1">
          <li className={li}>
            <span className="text-green-300">Initial buy</span> comes first and is separate from
            activation: get a desk NFT either by minting through the OTC launch curve on
            otcdesks.cash or by buying one on a secondary market (e.g. Magic Eden). This is a
            one-time purchase of the NFT itself — it doesn't start yield and isn't the Activation
            Cost below.
          </li>
          <li className={li}>
            Every desk NFT can be activated into one of four tiers. Activation is tied to the desk
            itself, not your wallet — sell the desk and the new owner keeps earning immediately, no
            re-activation needed.
          </li>
          <li className={li}>
            Pay the Activation Cost in SOL, or in $OTC at a fixed 2.00x premium — $OTC payments go
            straight into the protocol's liquidity reserve rather than the reward pool. Either way
            you also burn $HUB for the target tier — permanently destroyed, not sent to the pool.
          </li>
          <li className={li}>
            Rewards start accruing the instant you activate — only reward rounds closed after that
            moment count, so there's no way to backdate earnings or dilute existing holders.
          </li>
          <li className={li}>
            One call reaches any tier directly — a fresh desk can activate straight into MARKET
            MAKER for the same flat SOL fee as a TRADER activation, paid once. Upgrading later pays
            that flat SOL fee again (once per call, regardless of the size of the jump), plus only
            the $HUB difference between your current and target tier — you never burn the same $HUB
            twice.
          </li>
        </ul>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-green-500/30 text-left text-green-500/60">
                <th className="py-1 pr-3 font-normal">TIER</th>
                <th className="py-1 pr-3 font-normal">SOL FEE</th>
                <th className="py-1 pr-3 font-normal">$HUB BURN</th>
                <th className="py-1 pr-3 font-normal">YIELD BOOST</th>
              </tr>
            </thead>
            <tbody>
              {config.tierWeightsBp.map((w, i) => {
                const tier = i + 1;
                return (
                  <tr key={tier} className="border-b border-green-500/10 last:border-0">
                    <td className="py-1 pr-3 text-green-300">{TIER_NAMES[i]}</td>
                    <td className="py-1 pr-3">{fmtSol(cumulativeFeeLamports(tier))}</td>
                    <td className="py-1 pr-3 text-cyan-300">
                      {fmtUnits(BigInt(TIER_HUB_COST_UNITS[i]), HUB_DECIMALS, 0)} HUB
                    </td>
                    <td className="py-1 pr-3 text-emerald-300">
                      {tier === 1 ? "base rate" : `+${yieldBoostPctOverBase(tier)}%`}
                      <span className="ml-1 text-green-500/50">({fmtWeight(w)})</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-1 text-[10px] text-green-700">
            SOL fee is flat — paid once per activate/upgrade call, the same whether it's a fresh T1
            or a fresh T4. $HUB burn is cumulative — an upgrade only burns the difference from the
            tier you're already at.
          </div>
        </div>
        <MermaidBlock source={ACTIVATION_DIAGRAM} title="activation flow (technical detail)" />
      </CollapsibleCard>

      <CollapsibleCard title="2. HOW DAILY REWARDS ARE PAID">
        <ul className="space-y-1">
          <li className={li}>
            Protocol Revenue comes from six sources: desk activation fees, earnings from the
            treasury's own desks, the treasury's OTC trading profits, half of every discounted
            treasury desk sale, earnings from desks donated to the treasury, and trading fees from
            the $HUB liquidity pool.
          </li>
          <li className={li}>
            Revenue collects continuously until it crosses the reward-round trigger (
            {fmtSol(config.minPotThresholdLamports)}) — rounds close purely on activity, never a
            fixed schedule, so a round can settle in seconds or take days.
          </li>
          <li className={li}>
            When a round closes, {fmtBp(config.burnPctBp, 0)} of it is set aside for buyback & burn,
            and the rest is split across every active desk in proportion to its tier — Market Makers
            earn the largest share, Traders the base share. No revenue is ever lost to rounding —
            any leftover simply rolls into the next round.
          </li>
          <li className={li}>
            Claiming pays out every reward round you've earned since your last claim in a single
            transaction — there's no need to claim round by round.
          </li>
        </ul>
        <MermaidBlock source={FEE_FLOW_DIAGRAM} title="revenue distribution (technical detail)" />
      </CollapsibleCard>

      <CollapsibleCard title="3. TREASURY-BOOSTED YIELD">
        <ul className="space-y-1">
          <li className={li}>
            The protocol treasury buys desks on the open market whenever that's cheaper than minting
            a new one — so a growing treasury desk stack never dilutes existing holders. Purchases
            are capped at 10% of treasury SOL per desk and only target verified sellers.
          </li>
          <li className={li}>
            Every desk the treasury owns earns rewards exactly like any other desk, and that income
            feeds straight back into the same reward pool everyone shares from. A bigger treasury
            desk stack means a bigger reward pool for every activated desk —{" "}
            {config.tierWeightsBp.map((w, i) => `${TIER_NAMES[i]} ${fmtWeight(w)}`).join(" / ")}—
            with zero dilution to any holder.
          </li>
          <li className={li}>
            Occasionally the treasury sells a desk back to the market at a 10% discount to manage
            its holdings: half the sale burns $HUB immediately, the other half tops up the reward
            pool.
          </li>
        </ul>
        <MermaidBlock source={TREASURY_DIAGRAM} title="treasury yield boost (technical detail)" />
      </CollapsibleCard>

      <CollapsibleCard title="4. BUYBACK, BURN & LIQUIDITY">
        <ul className="space-y-1">
          <li className={li}>
            Every reward round automatically earmarks {fmtBp(config.burnPctBp, 0)} of its revenue
            for buyback & burn — an automated process that market-buys $HUB and destroys it forever,
            permanently shrinking what's left. The token's own on-chain supply drop is the proof —
            nothing to take on faith.
          </li>
          <li className={li}>
            A second burn happens immediately whenever the treasury sells a desk at a discount: half
            of that sale is burned on the spot, independent of the round-based burn above.
          </li>
          <li className={li}>
            The first liquidity pool ($HUB/SOL) costs the protocol nothing to launch — it's seeded
            automatically the moment a desk graduates through the OTC launch curve, and its trading
            fees flow back into the reward pool too.
          </li>
          <li className={li}>
            A second pool ($HUB/$OTC) opens once price has held steady for at least 14 days —
            deepened using treasury OTC and $HUB holdings, never a market buy. Every dollar the
            treasury puts into liquidity stays locked there; it's never sold.
          </li>
        </ul>
        <MermaidBlock source={BUYBACK_LP_DIAGRAM} title="buyback & liquidity (technical detail)" />
      </CollapsibleCard>
    </div>
  );
}
