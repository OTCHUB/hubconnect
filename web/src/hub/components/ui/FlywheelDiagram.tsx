import { useState } from "react";

type Tone = "green" | "cyan" | "amber" | "red" | "fuchsia" | "violet";
type EdgeKind = "instruction" | "keeper";

interface DNode {
  id: string;
  label: string;
  sub: string;
  tone: Tone;
  angle: number;
  ring: boolean;
  title: string;
  body: string[];
}

interface DEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  tone: Tone;
}

// Grounded in README §A4-A7 / docs/hubconnect-spec.md — same facts as mechanicsDiagrams.ts,
// no invented numbers. Ring = the primary reinforcing loop; satellites = the two burn/LP sinks
// plus the two flywheels (treasury, creator-fee) that feed extra value into the loop.
const NODES: DNode[] = [
  {
    id: "desk",
    label: "DESK NFT",
    sub: "mint or buy",
    tone: "green",
    angle: -90,
    ring: true,
    title: "1 · Get a Desk",
    body: [
      "Mint through the OTC launch curve on otcdesks.cash, or buy one on a secondary market.",
      "One-time NFT purchase — it doesn't start yield by itself.",
    ],
  },
  {
    id: "activate",
    label: "ACTIVATE",
    sub: "burn $HUB + pay fee",
    tone: "green",
    angle: -18,
    ring: true,
    title: "2 · Activate a Tier",
    body: [
      "Pick a tier (Trader → Market Maker), pay a flat SOL fee once (or 2x in $OTC), and burn $HUB for the target tier.",
      "on-chain: activate_tier / activate_tier_otc / upgrade_tier",
    ],
  },
  {
    id: "pot",
    label: "POT",
    sub: "3 revenue sources",
    tone: "cyan",
    angle: 54,
    ring: true,
    title: "3 · Protocol Revenue Fills the Pot",
    body: [
      "Activation fees, discount-exit SOL proceeds, and harvested LP swap fees all register here.",
      "The pot is just SOL held in a program PDA — Config.pot_liability_lamports tracks what's owed.",
      "The treasury's own desk-pot yield and its launcher holder-leg $OTC claim are separate flywheels (right) — they never touch this SOL pot.",
    ],
  },
  {
    id: "split",
    label: "ROUND SPLIT",
    sub: "90 / 5 / 2.5 / 2.5",
    tone: "amber",
    angle: 126,
    ring: true,
    title: "4 · finalize_epoch — 90 / 5 / 2.5 / 2.5",
    body: [
      "The instant the open round crosses 0.1 SOL, anyone can finalize it — no clock, no keeper required.",
      "90% → desk-staker yield · 5% → buy & burn $HUB · 2.5% → $HUB Treasury float · 2.5% → $HUB/$OTC LP.",
    ],
  },
  {
    id: "yield",
    label: "YOUR YIELD",
    sub: "pro-rata by tier",
    tone: "green",
    angle: 198,
    ring: true,
    title: "5 · claim_yield",
    body: [
      "Every activated desk earns pro-rata by tier weight (1.00x–2.00x) from every round closed since its last claim.",
      "Ownership is re-checked live — sell the desk and the new owner keeps earning, no re-activation.",
    ],
  },
  {
    id: "burn",
    label: "BURN",
    sub: "5% every round",
    tone: "red",
    angle: 100,
    ring: false,
    title: "Deflationary sink #1 — round burn",
    body: [
      "5% of every round's inflow buys $HUB on the open market and burns it — supply drops immediately, no vesting.",
      "BurnState.total_hub_burned must equal MAX_SUPPLY − Mint.supply, or dashboards flag drift.",
    ],
  },
  {
    id: "lp",
    label: "LP LOCK",
    sub: "phase-2 $HUB/$OTC",
    tone: "fuchsia",
    angle: 155,
    ring: false,
    title: "Locked liquidity (phase 2)",
    body: [
      "2.5% of every round funds a Raydium CP-Swap $HUB/$OTC pool once price has held stable ≥24h post-launch.",
      "lock_cp_liquidity burns the LP mint outright — principal is never withdrawable by anyone; only trading fees return to the pot.",
    ],
  },
  {
    id: "treasury",
    label: "TREASURY FLYWHEEL",
    sub: "sweep · exit",
    tone: "cyan",
    angle: 10,
    ring: false,
    title: "Treasury desk flywheel",
    body: [
      "The treasury sweeps listed desks whenever that's cheaper than minting (zero dilution).",
      "Every treasury-owned desk's 13-stock desk-pot claim is consolidated straight into the M.I.M ETF basket (fund_hub_pot) — a bigger treasury means a bigger basket for everyone, but it never re-enters this SOL pot.",
      "Discount exits resell treasury desks at a 10% floor discount: 50% of the sale burns $HUB, 50% returns to the pot.",
    ],
  },
  {
    id: "creatorfee",
    label: "CREATOR-FEE FLYWHEEL",
    sub: "80 / 5 / 5 / 5 / 5",
    tone: "amber",
    angle: 245,
    ring: false,
    title: "Second flywheel — creator-fee clear",
    body: [
      "A separate $OTC stream: the treasury's ≤2% $HUB float earns its pro-rata share of the OTC launcher's own holder-leg creator fees.",
      "80% funds desk yield directly (no swap) · 5% burns $HUB · 5% locks into $HUB/$OTC LP · 5% grows the treasury float · 5% funds ops SOL.",
      "clear_creator_fees is permissionless once its threshold clears; draw_creator_fee_leg reimburses the keeper that fronted the swap.",
    ],
  },
  {
    id: "mimetf",
    label: "M.I.M ETF",
    sub: "4-token basket",
    tone: "violet",
    angle: 320,
    ring: false,
    title: "Third flywheel — M.I.M ETF MemeStock basket",
    body: [
      'A fixed 4-token basket — $OTC, CRCLx, and on-chain "MemeStock" tickers branded NVDAx/SPCXx (tokenized tickers native to the OTC Desks ecosystem, not shares or equity in the real companies NVIDIA or SpaceX) — funded entirely by the treasury\'s own 13-stock desk-pot yield.',
      "Every round: the 4 native basket stocks pass straight through untouched, while the other 9 (AAPLx/MSFTx/AMZNx/ANTHROPIC/POLYMARKET/KALSHI/NEURALINK/ANDURIL/OPENAI) are swapped to SOL and split evenly 25/25/25/25 back into the basket.",
      "claim_hub_pot_reward (self-serve pull, per desk or in bulk) or distribute_hub_pot_reward (authority push) then pays each active desk its tier-weighted share of all four buckets — on top of, and independent of, the SOL yield above.",
    ],
  },
];

const EDGES: DEdge[] = [
  { from: "desk", to: "activate", kind: "instruction", tone: "green" },
  { from: "activate", to: "pot", kind: "instruction", tone: "green" },
  { from: "pot", to: "split", kind: "instruction", tone: "cyan" },
  { from: "split", to: "yield", kind: "instruction", tone: "amber" },
  { from: "yield", to: "desk", kind: "keeper", tone: "green" },
  { from: "split", to: "burn", kind: "instruction", tone: "red" },
  { from: "split", to: "lp", kind: "instruction", tone: "fuchsia" },
  { from: "treasury", to: "pot", kind: "keeper", tone: "cyan" },
  { from: "creatorfee", to: "yield", kind: "keeper", tone: "amber" },
  { from: "treasury", to: "mimetf", kind: "keeper", tone: "violet" },
  { from: "mimetf", to: "yield", kind: "keeper", tone: "violet" },
];

const TONE_HEX: Record<Tone, string> = {
  green: "#4ade80",
  cyan: "#22d3ee",
  amber: "#fbbf24",
  red: "#f87171",
  fuchsia: "#e879f9",
  violet: "#a78bfa",
};

const TONE_BTN: Record<Tone, string> = {
  green: "border-green-500 text-green-300",
  cyan: "border-cyan-500 text-cyan-300",
  amber: "border-amber-500 text-amber-300",
  red: "border-red-500 text-red-300",
  fuchsia: "border-fuchsia-500 text-fuchsia-300",
  violet: "border-violet-500 text-violet-300",
};

const VB_W = 380;
const VB_H = 320;
const CX = 190;
const CY = 160;
const R1 = 92; // ring radius
const R2 = 148; // satellite radius

function pos(n: DNode) {
  const r = n.ring ? R1 : R2;
  const rad = (n.angle * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function DetailBox({ node }: { node: DNode | null }) {
  if (!node) {
    return (
      <div className="border border-green-500/20 bg-black p-3 text-xs text-green-700">
        click / tap any node above to see how it works
      </div>
    );
  }
  return (
    <div className={`border bg-black p-3 text-xs ${TONE_BTN[node.tone]}`}>
      <div className="mb-1.5 tracking-widest">{node.title}</div>
      <ul className="space-y-1">
        {node.body.map((line, i) => (
          <li key={i} className="text-green-400/90">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * OTCHUB-styled, dependency-free interactive flywheel: the primary reinforcing loop
 * (Desk → Activate → Pot → Split → Yield) plus the four satellites that feed it
 * (Burn, LP Lock, Treasury Flywheel, Creator-Fee Flywheel). Desktop renders the full
 * graph; mobile collapses to a plain-language 5-step vertical loop with tappable
 * "boost" chips for the satellites. No invented facts — mirrors README / §A4-A7.
 */
export function FlywheelDiagram() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const selected = NODES.find((n) => n.id === selectedId) ?? null;
  const activeId = hoverId ?? selectedId;
  const byId = Object.fromEntries(NODES.map((n) => [n.id, pos(n)]));

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest text-green-600">
        <span>the $HUB flywheel</span>
        <span className="hidden gap-3 sm:flex">
          <span className="flex items-center gap-1">
            <span className="inline-block h-px w-4 bg-green-400" /> instruction
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-px w-4 border-t border-dashed border-green-400" />
            keeper trigger
          </span>
        </span>
      </div>

      {/* Desktop / tablet — full graph */}
      <div className="hidden md:block">
        <div
          className="relative mx-auto w-full max-w-[560px] p-6"
          style={{ aspectRatio: `${VB_W}/${VB_H}` }}
        >
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            {EDGES.map((e, i) => {
              const a = byId[e.from];
              const b = byId[e.to];
              const on = activeId === e.from || activeId === e.to;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={TONE_HEX[e.tone]}
                  strokeOpacity={on ? 0.95 : 0.35}
                  strokeWidth={on ? 1.75 : 1}
                  strokeDasharray={e.kind === "keeper" ? "5 4" : undefined}
                  className={e.kind === "keeper" ? "dash-flow" : undefined}
                />
              );
            })}
          </svg>
          {NODES.map((n) => {
            const p = pos(n);
            const on = activeId === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedId((cur) => (cur === n.id ? null : n.id))}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId(null)}
                className={`absolute w-[104px] -translate-x-1/2 -translate-y-1/2 border bg-black px-1.5 py-1 text-center transition-shadow ${TONE_BTN[n.tone]} ${on ? "shadow-[0_0_8px_currentColor]" : "opacity-80"}`}
                style={{ left: `${(p.x / VB_W) * 100}%`, top: `${(p.y / VB_H) * 100}%` }}
              >
                <div className="text-[9px] font-bold leading-tight tracking-wide">{n.label}</div>
                <div className="text-[8px] leading-tight text-green-600">{n.sub}</div>
              </button>
            );
          })}
        </div>
        <div className="mt-2">
          <DetailBox node={selected} />
        </div>
      </div>

      {/* Mobile — plain-language linear loop */}
      <div className="md:hidden">
        <ol className="space-y-1.5">
          {NODES.filter((n) => n.ring).map((n, i) => {
            const on = selectedId === n.id;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId((cur) => (cur === n.id ? null : n.id))}
                  className={`flex w-full items-center gap-2 border bg-black px-2 py-1.5 text-left ${TONE_BTN[n.tone]} ${on ? "shadow-[0_0_6px_currentColor]" : "opacity-90"}`}
                >
                  <span className="text-[10px] text-green-600">{i + 1}</span>
                  <span className="flex-1">
                    <div className="text-[11px] font-bold tracking-wide">{n.label}</div>
                    <div className="text-[9px] text-green-600">{n.sub}</div>
                  </span>
                  <span className="text-[9px] text-green-700">{on ? "[-]" : "[+]"}</span>
                </button>
                {on && (
                  <div className="mt-1">
                    <DetailBox node={n} />
                  </div>
                )}
              </li>
            );
          })}
          <li className="pl-1 text-[10px] text-green-700">↻ loops — yield compounds every round</li>
        </ol>

        <div className="mt-3 text-[10px] uppercase tracking-widest text-green-600">
          burn/LP sinks + three more flywheels reinforce the loop, no dilution
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {NODES.filter((n) => !n.ring).map((n) => {
            const on = selectedId === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedId((cur) => (cur === n.id ? null : n.id))}
                className={`border bg-black px-2 py-1 text-[10px] ${TONE_BTN[n.tone]} ${on ? "shadow-[0_0_6px_currentColor]" : "opacity-90"}`}
              >
                {n.label}
              </button>
            );
          })}
        </div>
        {selected && !selected.ring && (
          <div className="mt-1.5">
            <DetailBox node={selected} />
          </div>
        )}
      </div>
    </div>
  );
}
