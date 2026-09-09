import {
  HUB_DECIMALS,
  TIER_HUB_COST_UNITS,
  TIER_NAMES,
  cumulativeFeeLamports,
  type ProtocolState,
} from "@hub-sdk";
import { useHub } from "../HubProvider";
import { fmtBp, fmtSol, fmtUnits, fmtWeight } from "../lib/format";
import { yieldBoostPctOverBase } from "../lib/yield";
import {
  ACTIVATION_DIAGRAM,
  BUYBACK_LP_DIAGRAM,
  ETF_FLOW_DIAGRAM,
  FEE_FLOW_DIAGRAM,
  TREASURY_DIAGRAM,
} from "../lib/mechanicsDiagrams";
import { AddressLink } from "./ui/AddressLink";
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
  const { programId, marketplaceCollectionUrl } = useHub();
  return (
    <div className="space-y-2">
      <Panel title="HOW $HUB WORKS">
        <p className={p}>
          $HUB turns every OTC desk NFT into a yield-earning position. Activate a desk and it starts
          collecting a share of Protocol Revenue every reward round — funded entirely by protocol
          activity, never taken from other holders. A slice of that same revenue buys back and burns
          $HUB every round, permanently shrinking the supply that's left.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-green-600">
          <span>
            $HUB MINT :: <AddressLink address={config.hubMint} />
          </span>
          <span>
            PROGRAM :: <AddressLink address={programId.toBase58()} />
          </span>
          <a
            href={marketplaceCollectionUrl}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-400 hover:text-cyan-200"
          >
            [MAGIC EDEN COLLECTION ↗]
          </a>
        </div>
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
            Every activation or upgrade pays the same flat SOL fee into the reward pool either way.
            The $HUB burn leg for your target tier can instead be paid in $OTC: the app quotes a
            live Jupiter route, swaps half of it to $HUB and burns it, and sends an equal amount of
            $OTC straight into the desk-pot vault — a dynamic ~2.00x premium priced fresh every
            call, never a stored rate. Either way the $HUB burned is permanently destroyed, not
            sent to the pool.
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
            Protocol Revenue comes from five sources: desk activation fees, earnings from the
            treasury's own desks (bought via market sweeps — never donated or consigned for free),
            the treasury's OTC trading profits, half of every discounted treasury desk sale, and
            trading fees from the $HUB liquidity pool.
          </li>
          <li className={li}>
            Revenue collects continuously until it crosses the reward-round trigger (
            {fmtSol(config.minPotThresholdLamports)}) — rounds close purely on activity, never a
            fixed schedule, so a round can settle in seconds or take days.
          </li>
          <li className={li}>
            When a round closes, 10% of it is swapped SOL→$HUB in one on-chain transaction and split
            three ways — {fmtBp(config.burnPctBp, 0)} bought back and burned, and the rest earmarked
            evenly for the future $HUB/$OTC liquidity pool and the treasury's buy-and-hold float. The
            remaining 90% is split across every active desk in proportion to its tier — Market Makers
            earn the largest share, Traders the base share. No revenue is ever lost to rounding — any
            leftover simply rolls into the next round.
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
            Every reward round automatically swaps 10% of its revenue SOL→$HUB in a single
            synchronous transaction — {fmtBp(config.burnPctBp, 0)} is burned forever, and the
            remaining half is split evenly between the future $HUB/$OTC liquidity pool and the
            treasury's buy-and-hold float (itself capped as a share of supply; anything over the cap
            is burned too). The token's own on-chain supply drop is the burn proof — nothing to take
            on faith.
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
            A second pool ($HUB/$OTC) opens once price has held steady for at least 24 hours post
            launch — seeded from the $HUB earmarked in every round's swap above plus treasury OTC
            holdings, never a market buy. The LP mint is burned outright the moment it's seeded, so
            every dollar the treasury puts into liquidity stays locked there forever; it's never
            sold, only its trading fees are ever claimed.
          </li>
        </ul>
        <MermaidBlock source={BUYBACK_LP_DIAGRAM} title="buyback & liquidity (technical detail)" />
      </CollapsibleCard>

      <CollapsibleCard title="5. M.I.M ETF — MEMESTOCK BASKET YIELD">
        <ul className="space-y-1">
          <li className={li}>
            Alongside the SOL reward round above, every activated desk also earns a tier-weighted
            share of the <span className="text-green-300">M.I.M ETF</span> — a fixed 4-token basket:
            $OTC, CRCLx, and two on-chain "MemeStock" tickers branded OPENAI and ANTHROPIC. These
            four are tokenized tickers native to the OTC Desks ecosystem —{" "}
            <span className="text-amber-300">not</span> shares, equity, or any claim on the real
            companies OpenAI or Anthropic.
          </li>
          <li className={li}>
            The basket is funded entirely by the treasury's own 13-stock desk-pot yield (the same
            treasury desks described in section 3), never taken from other holders. Each round, the
            4 native basket stocks pass straight through untouched — no swap needed since they're
            already the reward asset.
          </li>
          <li className={li}>
            The other 9 treasury stocks are swapped to SOL and the proceeds split evenly 25/25/25/25
            back into the 4 basket tokens — this rebalancing step is what consolidates a diversified
            treasury yield into one claimable basket every round.
          </li>
          <li className={li}>
            Value capture happens on claim: an active desk's tier weight determines its share of all
            four buckets for a round, payable to whoever owns the desk at claim time — per desk, or
            in bulk across every desk a wallet owns, in the same self-serve pull pattern as the SOL
            reward claim.
          </li>
        </ul>
        <MermaidBlock source={ETF_FLOW_DIAGRAM} title="M.I.M ETF basket flow (technical detail)" />
      </CollapsibleCard>
    </div>
  );
}
