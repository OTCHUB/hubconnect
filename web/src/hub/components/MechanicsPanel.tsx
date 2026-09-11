import { useState } from "react";
import { Link } from "react-router-dom";
import {
  HUB_DECIMALS,
  TIER_NAMES,
  cumulativeFeeLamports,
  liveHubCostUnits,
  type ProtocolState,
} from "@hub-sdk";
import { useHub } from "../HubProvider";
import { useWallet } from "../WalletProvider";
import { fmtBp, fmtSol, fmtUnits, fmtWeight, shortKey } from "../lib/format";
import { yieldBoostPctOverBase } from "../lib/yield";
import {
  FaucetHttpError,
  mintMockDesk,
  TURNSTILE_SITE_KEY,
  type MintDeskResult,
} from "../lib/faucet";
import { Turnstile } from "./ui/Turnstile";
import { OFFICIAL_MINT_URL } from "../lib/marketplace";
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
const btn =
  "border px-3 py-1.5 text-xs font-bold disabled:opacity-30 border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/10";

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

/** Devnet-only: mints an unactivated Mock OTC Desk straight to the connected wallet via the
 * faucet Worker backing otchub.dev/drip — same button DripPage.tsx exposes, inlined here so "own
 * a desk" and "how to own a desk" live on the same card. Never rendered on mainnet-beta. */
function MintMockDeskButton() {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<MintDeskResult | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const requireTurnstile = !!TURNSTILE_SITE_KEY;

  const run = async () => {
    if (!wallet.address) return setErr("connect a wallet first");
    if (requireTurnstile && !turnstileToken) {
      return setErr("complete the verification challenge below first");
    }
    setBusy(true);
    setErr(null);
    try {
      setResult(await mintMockDesk(wallet.address, turnstileToken ?? undefined));
    } catch (e) {
      setErr(e instanceof FaucetHttpError ? e.message : "mint failed — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 border border-amber-500/30 bg-amber-500/5 p-2">
      <div className="mb-2 text-[11px] text-amber-300">
        Devnet has no secondary market — mint a free Mock OTC Desk NFT (Metaplex Core, real
        collection PDA) straight to your wallet instead.
      </div>
      <Turnstile
        siteKey={TURNSTILE_SITE_KEY}
        onVerify={setTurnstileToken}
        onExpire={() => setTurnstileToken(null)}
        className="mb-2"
      />
      <button
        type="button"
        onClick={run}
        disabled={busy || !wallet.address || (requireTurnstile && !turnstileToken)}
        className={btn}
      >
        {busy ? "[MINTING…]" : "[MINT MOCK OTC DESK]"}
      </button>
      {!wallet.address && (
        <span className="ml-2 text-[10px] text-green-600">connect a wallet to mint</span>
      )}
      {err && <div className="mt-2 text-[11px] text-amber-400">ERR: {err}</div>}
      {result && (
        <div className="mt-2 space-y-1 text-[11px] text-green-400/90">
          <div>
            Desk #{result.deskNumber} — <AddressLink address={result.asset} />
          </div>
          <a
            href={result.explorer}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-300 underline hover:text-cyan-100"
          >
            {shortKey(result.signature, 8)} ↗
          </a>
          <div>
            Now activate it below (section 2) with the $HUB{" "}
            <Link to="/drip" className="underline hover:text-green-200">
              /drip
            </Link>{" "}
            gave you.
          </div>
        </div>
      )}
    </div>
  );
}

/** Investor-facing mechanics explainer — the Buy → Activate → Earn → Burn cycle, activation
 * costs, and reward flow — in plain terms, grounded in ConfigView (sdk/src/reader.ts). Full
 * technical detail (instructions, PDAs, accumulator math) is intentionally left out here; see
 * docs/hubconnect-spec.md §A4-A7 for that level of detail. */
export function MechanicsPanel({ state }: { state: ProtocolState }) {
  const { config } = state;
  const { programId, marketplaceCollectionUrl, cluster } = useHub();
  return (
    <div className="space-y-2">
      <Panel title="HOW $HUB WORKS" collapsible>
        <p className={p}>
          $HUB turns every OTC desk NFT into a yield-earning position: own a desk → activate it into
          a tier → every round splits 90 / 5 / 2.5 / 2.5 between stakers, a $HUB burn, the treasury,
          and $HUB/$OTC liquidity → you claim, pro-rata by tier. The treasury's own desk stack boosts
          a second, independent yield basket (the M.I.M ETF, section 4) on the same pro-rata
          schedule. Every leg is funded by protocol activity — never taken from other holders — and
          the burn leg permanently shrinks supply, round after round.
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

      <CollapsibleCard title="1. OWN AN OTC DESK" defaultOpen>
        <ul className="space-y-1">
          <li className={li}>
            Owning the NFT and activating it are two separate steps — buying a desk doesn't start
            yield by itself; it's the ticket that lets you activate a tier in section 2 below.
          </li>
          {cluster === "devnet" ? (
            <li className={li}>
              <MintMockDeskButton />
            </li>
          ) : (
            <>
              <li className={li}>
                <span className="text-green-300">Official mint</span> — mint fresh on the OTC launch
                curve at{" "}
                <a
                  href={OFFICIAL_MINT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-300 underline hover:text-cyan-100"
                >
                  otcdesks.cash/mint ↗
                </a>
                . <span className="text-green-300">Buy secondary</span> — pick one up on{" "}
                <a
                  href={marketplaceCollectionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-300 underline hover:text-cyan-100"
                >
                  Magic Eden ↗
                </a>{" "}
                instead. Neither route is inherently better — check both before you buy: mint price
                comes straight from the launch curve, while the Magic Eden floor moves with
                secondary demand, so the cheaper route (the arbitrage) flips depending on which side
                is hotter. Both pages show live pricing.
              </li>
              <li className={li}>
                Either way, activating what you bought costs a flat 0.5 SOL on top — see section 2.
              </li>
            </>
          )}
          <li className={li}>
            Once activated, a desk starts accruing weight in every reward round from that moment on
            — no backdating, no waiting period. But activation is a promise tied to the{" "}
            <span className="text-amber-300">current owner</span>, not the NFT alone: transfer or
            sell it out of the activating wallet and HUB activation is revoked the instant the new
            owner (or you) next tries to claim. The buyer inherits an NFT, not a live yield position
            — they'd need to activate it themselves to start earning again.
          </li>
        </ul>
      </CollapsibleCard>

      <CollapsibleCard title="2. ACTIVATE INTO A TIER">
        <ul className="space-y-1">
          <li className={li}>
            Every desk NFT can be activated into one of four tiers. Activation is tied to the desk
            itself, not your wallet — sell an already-activated desk and the new owner would keep
            earning immediately, if not for the ownership check in section 1 above, which is why
            most transfers reset it.
          </li>
          <li className={li}>
            Every activation or upgrade pays the same flat SOL fee into the reward pool either way.
            The $HUB burn leg for your target tier can instead be paid in $OTC: the app quotes a
            live Jupiter route, swaps half of it to $HUB and burns it, and sends an equal amount of
            $OTC straight into the desk-pot vault — a dynamic ~2.00x premium priced fresh every
            call, never a stored rate. Either way the $HUB burned is permanently destroyed, not sent
            to the pool.
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
                      {fmtUnits(
                        BigInt(liveHubCostUnits(tier, Math.floor(Date.now() / 1000), config)),
                        HUB_DECIMALS,
                        0,
                      )}{" "}
                      HUB
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
            tier you're already at — and targets a fixed USD price per tier, so the token amount
            shown here tracks $HUB's live market price; only {(config.tierCostBurnBp / 100).toFixed(0)}
            % of it is destroyed, the rest funds the active-desk reward pool.
          </div>
        </div>
        <MermaidBlock source={ACTIVATION_DIAGRAM} title="activation flow (technical detail)" />
      </CollapsibleCard>

      <CollapsibleCard title="3. TREASURY-BOOSTED YIELD">
        <ul className="space-y-1">
          <li className={li}>
            The protocol treasury buys desks on the open market whenever that's cheaper than minting
            a new one — so a growing treasury desk stack never dilutes existing holders. Purchases
            are capped at 10% of treasury SOL per desk and only target verified sellers.
          </li>
          <li className={li}>
            Every desk the treasury owns earns rewards exactly like any other desk — but that income
            doesn't feed the SOL round pool from section 5; it's consolidated straight into the
            M.I.M ETF basket instead (section 4), a second yield stream every activated desk shares
            in pro-rata by tier —{" "}
            {config.tierWeightsBp.map((w, i) => `${TIER_NAMES[i]} ${fmtWeight(w)}`).join(" / ")}—
            on top of the SOL round yield, with zero dilution to any holder.
          </li>
          <li className={li}>
            Occasionally the treasury sells a desk back to the market at a 10% discount to manage
            its holdings: half the sale burns $HUB immediately, the other half tops up the reward
            pool.
          </li>
        </ul>
        <MermaidBlock source={TREASURY_DIAGRAM} title="treasury yield boost (technical detail)" />
      </CollapsibleCard>

      <CollapsibleCard title="4. HUB POT — BOOSTED MULTI-SOURCE YIELD">
        <ul className="space-y-1">
          <li className={li}>
            On-chain this is the <code>hub_pot</code> account, better known as the{" "}
            <span className="text-green-300">M.I.M ETF</span>: a second, independent yield stream
            every activated desk earns <span className="text-amber-300">in addition to</span> the
            native SOL round yield from sections 3/5 — never a replacement for it, never taken from
            other holders.
          </li>
          <li className={li}>
            It pays out a fixed 4-token basket — $OTC, CRCLx, and two on-chain xStock tickers
            branded NVDAx and SPCXx — tokenized tickers native to the OTC Desks ecosystem,{" "}
            <span className="text-amber-300">not</span> shares, equity, or any claim on the real
            companies NVIDIA or SpaceX.
          </li>
          <li className={li}>
            The boost comes from consolidating the treasury's desk stack (section 3) into one
            basket: those desks actually hold 13 stocks, not 4. Each round the 4 native basket
            stocks pass straight through untouched, while the other 9 are swapped to SOL and split
            evenly 25/25/25/25 back into the 4 basket tokens — multi-source treasury revenue,
            rebalanced into a single claimable basket every round.
          </li>
          <li className={li}>
            Same pro-rata-by-tier claim pattern as the SOL round (section 6) — pull per desk, or in
            bulk across every desk a wallet owns, in a single self-serve transaction.
          </li>
        </ul>
        <MermaidBlock
          source={ETF_FLOW_DIAGRAM}
          title="HUB Pot / M.I.M ETF flow (technical detail)"
        />
      </CollapsibleCard>

      <CollapsibleCard title="5. HUB ROUND SPLIT — 90 / 5 / 2.5 / 2.5">
        <ul className="space-y-1">
          <li className={li}>
            Revenue — activation fees, discount-exit proceeds, and LP trading fees — collects
            continuously until it crosses the reward-round trigger (
            {fmtSol(config.minPotThresholdLamports)}). The treasury's own desk-pot yield and its
            launcher holder-leg $OTC claim are separate flywheels (sections 3/4) that never enter
            this pool. Rounds close purely on activity,
            never a fixed schedule, so a round can settle in seconds or take days, and anyone can
            trigger the close — no keeper required.
          </li>
          <li className={li}>
            Every round then splits four ways, all in one on-chain transaction:{" "}
            <span className="text-emerald-300">
              {fmtBp(10000 - config.burnPctBp - config.lpPctBp - config.treasuryFloatPctBp, 0)} →
              desk-staker yield
            </span>{" "}
            (paid pro-rata by tier, section 6) ·{" "}
            <span className="text-amber-300">
              {fmtBp(config.burnPctBp, 0)} → buy &amp; burn $HUB
            </span>{" "}
            (permanently destroyed) ·{" "}
            <span className="text-cyan-300">
              {fmtBp(config.treasuryFloatPctBp, 0)} → $HUB Treasury
            </span>{" "}
            (buy-and-hold float, capped as a share of supply — anything over the cap is burned too)
            · <span className="text-cyan-300">{fmtBp(config.lpPctBp, 0)} → $HUB/$OTC LP</span>{" "}
            (seeds the phase-2 liquidity pool). The burn/treasury/LP legs come off first via a
            synchronous SOL→$HUB Jupiter swap; the remaining{" "}
            {fmtBp(10000 - config.burnPctBp - config.lpPctBp - config.treasuryFloatPctBp, 0)} never
            touches $HUB at all. No revenue is ever lost to rounding — any sub-lamport leftover
            simply rolls into the next round.
          </li>
          <li className={li}>
            A second, independent burn fires whenever the treasury exits a desk at a discount: half
            of that sale burns $HUB on the spot, outside this round-based split entirely.
          </li>
          <li className={li}>
            The first liquidity pool ($HUB/SOL) costs the protocol nothing to launch — it seeds
            automatically the moment a desk graduates through the OTC launch curve, and its trading
            fees flow back into the pot too (another of the multi-source inflows above). The second
            pool ($HUB/$OTC) opens once price has held steady for 24h post-launch, seeded from the
            LP leg above plus treasury OTC holdings — never a market buy — and its LP mint is burned
            outright the moment it's seeded, so that liquidity is locked forever; only its fees are
            ever claimed.
          </li>
        </ul>
        <MermaidBlock source={FEE_FLOW_DIAGRAM} title="revenue → round split (technical detail)" />
        <MermaidBlock
          source={BUYBACK_LP_DIAGRAM}
          title="burn & liquidity legs (technical detail)"
        />
      </CollapsibleCard>

      <CollapsibleCard title="6. YOUR YIELD — PRO-RATA BY TIER">
        <ul className="space-y-1">
          <li className={li}>
            Every active desk earns a share of both the SOL round (section 5) and the HUB Pot
            (section 4) in exact proportion to its tier weight —{" "}
            {config.tierWeightsBp.map((w, i) => `${TIER_NAMES[i]} ${fmtWeight(w)}`).join(" / ")} — a
            Market Maker earns {yieldBoostPctOverBase(4)}% more than a Trader from the very same
            pool, no separate allocation, no lottery.
          </li>
          <li className={li}>
            Both streams use the same lifetime-accumulator pattern: every closed round bumps a
            single running total, and your claim pays floor((accumulator − your last-claim stamp) ×
            your weight) — so claiming pays out everything you've earned since your last claim in
            one transaction, whether that's one round or a hundred.
          </li>
          <li className={li}>
            The claim is always a pull, always self-serve, and always goes to whoever owns the desk{" "}
            <span className="text-amber-300">right now</span> — which is exactly why section 1's
            revocation-on-transfer rule exists: without it, buying an already-activated desk on
            secondary would let a buyer claim yield the seller's wallet accrued before they ever
            activated it themselves.
          </li>
        </ul>
        <MermaidBlock
          source={ACTIVATION_DIAGRAM}
          title="activation → claim lifecycle (technical detail)"
        />
      </CollapsibleCard>
    </div>
  );
}
