# Mechanics

How a desk NFT turns into yield. Full protocol reference: [`hubconnect-spec.md`](hubconnect-spec.md).
Tokenomics (supply, burn sinks, allocation): [`tokenomics.md`](tokenomics.md).

## 1. Tier activation & upgrade

Tiers bind to a desk NFT **asset id**, not a wallet. `activate_tier` / `upgrade_tier`
target `target_tier` (1..4) directly and pay two things every call:

| Tier | Weight | SOL fee (flat, per call) | $HUB burn (cumulative) |
|---|---|---|---|
| T1 TRADER | 1.00x | 0.5 SOL (90% pot / 10% ops) | 100,000 |
| T2 BROKER | 1.25x | 0.5 SOL | 125,000 |
| T3 DEALER | 1.60x | 0.5 SOL | 150,000 |
| T4 MARKET MAKER | 2.00x | 0.5 SOL | 200,000 |

1. **A flat SOL fee** — `STEP_FEE_LAMPORTS = 0.5 SOL`, paid once per call regardless of
   how many tiers it crosses. A fresh T4 activation costs the same 0.5 SOL as a fresh
   T1; a later upgrade to any higher tier pays 0.5 SOL again, once — never
   `(to − from) × fee`.
2. **A $HUB burn** — the cumulative tier-cost table above; a fresh activation burns the
   full target cost, an upgrade burns only the delta from the tier already held.
   `BurnChecked`, permanent, independent of the round-based buyback burn.

Ownership is **lazily re-verified on-chain** at every `claim_yield` / `upgrade_tier`
call: if the caller no longer owns the desk asset, the tier is voided (no refund)
instead of paying out to a stale owner.

## 2. Paying the $HUB-burn leg in $OTC (dynamic swap-burn)

Either instruction can be called as `activate_tier_otc` / `upgrade_tier_otc` instead,
which pays the **same flat 0.5 SOL fee** (90% pot / 10% ops) but replaces the direct
$HUB debit with a real, synchronous on-chain **Jupiter $OTC→$HUB swap**:

- The caller supplies `otcSwapAmount` — an $OTC input sized off-chain from a live
  Jupiter quote so the swap clears at least the tier's `hubCostDelta`. The program
  enforces this on-chain via balance-delta (`min_out`), so the swap can never
  under-deliver. The $HUB received lands in the payer's own ATA and is burned there
  in full immediately.
- An **equal-scaled** $OTC amount is charged again and injected straight into the
  desk-pot vault (no swap) — it only raises the pot's lifetime average buy rate.
- Because the desk-pot leg mirrors the swap leg 1:1, the **total $OTC spent is
  always ~2× the swap leg's live-priced cost** — a dynamic 2× premium, not a stored
  rate. There is nothing to refresh: every call prices itself off a fresh quote.

The $OTC path must be enabled by governance (`OtcPayConfig.enabled`); absent or
disabled, only the direct-burn SOL path is available.

## 3. Rounds & the 4-way yield split

Pot inflow (activation fees, treasury desk yield, discount-exit proceeds, LP swap
fees) accumulates in an open round (`Epoch`). `finalize_epoch` is **permissionless**
and threshold-gated, not clocked: it can be called the instant the round's inflow
reaches `MIN_POT_THRESHOLD = 0.1 SOL`, and is rejected below it. A round can be
seconds or days long depending on flow.

At finalize, every round inflow splits four ways:

```text
90.0%  → desk-staker $OTC yield, pro-rata by tier weight (Config.acc_per_weight)
 5.0%  → $HUB buyback, burned
 2.5%  → $HUB earmarked for the future $HUB/$OTC LP
 2.5%  → $HUB deposited into the treasury's buy-and-hold float (capped, see tokenomics.md)
```

The 10% swap leg (burn + LP + float) is executed as a **single synchronous Jupiter
CPI inside `finalize_epoch` itself** — no keeper round-trip, no off-chain-attested
buyback. The caller assembles the Jupiter route (quote + swap instructions) off-chain
and supplies it as call data; the program enforces a minimum $HUB output via
balance-delta. The resulting $HUB is split 50/25/25 in the same transaction: burned,
earmarked for LP, and deposited into the float — any float deposit that would push
past the live cap is burned instead of left un-swapped.

Desks are paid their 90% share in **$OTC**, not SOL: the yield leg is credited to a
lamport-equivalent accumulator (`acc_per_weight`) and converted to $OTC at the pot's
lifetime average buy rate when a desk calls `claim_yield`. One `claim_yield` call
settles every round closed since the desk's last claim — there is no per-round
claiming.

## 4. Lazy revocation

A desk's tier is only checked against its current NFT owner when money moves —
`claim_yield` or `upgrade_tier(_otc)`. If the caller no longer owns the asset at that
moment, the tier is voided in place (no refund, no partial payout to the old owner)
and the desk drops out of the weight total until re-activated. This keeps every
other instruction cheap (no owner lookups on the hot path) while guaranteeing yield
never silently accrues to a stale wallet indefinitely.

## 5. Full reference

Every constant above (fee, burn table, split percentages, threshold, float cap) is
a live `Config` / `TreasuryState` field, never hardcoded client-side — see
[`hubconnect-spec.md`](hubconnect-spec.md) for the account layout, instruction
table, and PDA seeds.
