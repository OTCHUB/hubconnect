# hubconnect — $HUB Protocol Full Specification

**Repo:** `hubconnect` · **Version:** 1.2 (implementation spec) · **Date:** 2026-09-07
**Purpose:** Self-contained spec for an AI agent to scaffold, implement, and test the $HUB
protocol end-to-end. Everything needed is in this document — no external conversation
context required.

> **DISCLAIMER — COMMUNITY TOOLING.** $HUB and hubconnect are community-built and
> **not affiliated with, endorsed by, or built by the OTC protocol team**. All OTC
> protocol mechanics described here were verified by public on-chain inspection and
> public web pages (2026-09-07) and may change without notice. Nothing here is
> financial advice. **Never hardcode OTC-side addresses — resolve every OTC constant
> from on-chain protocol config at runtime and re-verify before launch.**

---

## PART A — PRODUCT & TOKENOMICS

### A1. What hubconnect is

A stake-to-earn layer for existing OTC desk NFTs, plus a treasury desk flywheel:

- **$HUB** launches **via the OTC launcher** with reward stock = **OTC**. Every $HUB
  trade's creator fees buy OTC for $HUB holders (70%), fund the OTC desk pot (10%),
  OTC buybacks (5%), and the OTC protocol (15%). The launcher takes 0%.
- **Desk owners activate tiers** on their desk NFT (burn-based, lazy-verified) and
  earn pro-rata yield from the $HUB pot: activation fees + treasury desk-sweep yield
  + treasury OTC-stock proceeds.
- **A deflationary sink**: 10% of every pot inflow buys $HUB on the market and burns
  it; every treasury desk exit burns 50% of the consideration in HUB.
- **Treasury flywheel**: sweep existing listed desks when cheaper than minting
  (zero dilution to the desk pot), harvest their desk-pot yield for $HUB stakers,
  and sell them back to the community at a 10% floor discount.

Design principles, in priority order: (1) not greedy — nothing taken from other OTC
participants, only added buy pressure and pot funding; (2) better yield for desk
owners; (3) deflationary by construction; (4) evidence-first — every constant
parameterized and re-verified on-chain.

### A2. Verified foundations (facts as of 2026-09-07)

**Launcher fee engine** (source: https://otcdesks.cash/launcher launch form):
- "Launch a coin whose creator fees buy tokenised stock for the people holding it."
- Fixed fee split of a launched coin's creator fees: **Holders-in-stock 70% ·
  OTC protocol 15% · OTC desk pot 10% · OTC buybacks 5% · launcher 0%**.
- The reward stock is **chosen at launch**; creator fees of the launched coin buy
  that stock and distribute it to the launched coin's **holders, pro-rata per
  wallet**.
- Launched coins join the selectable reward-stock rotation (verified precedent:
  $PONS, a launcher coin, appears in the stock list) → once $HUB is launched, other
  launches can select $HUB and **their** fees buy $HUB from the market.

**Desk pot** (source: otcdesks.cash stats + on-chain pot account):
- Distributes a 13-stock desk rotation per desk, per round. Lifetime desk-channel
  distribution ≈ 2,570 SOL over 2,487 rounds.
- **OTC is itself one of the 13 rotation stocks** (slot 10, verified on-chain
  2026-09-07: OTC mint `MukLD…pump` sits in `ConfigExt` slot 10; lifetime OTC
  distributed to desks 98.1 SOL ≈ 0.044 SOL/desk, 6th of 13 by volume). So a
  treasury-owned desk accrues OTC directly (source B), independent of the
  launcher's reward-stock channel (source C).
- Rotation layout (verified by scanning the OTC `Config` / `ConfigExt` PDAs):
  `Config["config"]` = `9b5V…REU4` holds slots 0–9 as 32-byte mints from offset
  216 (AAPLx, MSFTx, NVDAx, AMZNx, CRCLx, SPCXx, ANTHROPIC, POLYMARKET, KALSHI,
  NEURALINK); `ConfigExt["config_ext"]` = `78rNUh8esjSWLhH8zPB5UNsx7uKbRygKQg1G2XgeqFUz`
  holds slots 10–12 (OTC, ANDURIL, OPENAI). `claim(index)` / `distribute(index)`
  for slots 10–12 additionally require `config_ext` + the desk's
  `["vault_ext", vault]` PDA. 12 of 13 mints are Token-2022 (OTC is classic SPL);
  stock ATAs use the custom seed order `[owner, tokenProgram, mint]`.
- Pot inflow channels reported by the OTC_HUB snapshot (`pot_sources`): `mint`,
  `royalty`, `launchpad`, `other`. The `launchpad` leg (launched coins' 10% →
  desk pot) is live and material — e.g. 272.8 SOL on 2026-09-07 vs 23.0 mint /
  28.8 royalty — so desk-pot yield now scales with launcher volume.
- Latest closed day take: **0.1443 SOL/desk/day**; 7-day average 0.1464.
- Desk mint surcharge: 0.5 SOL (0.45 to pot, 0.05 to protocol) + 100,000 OTC burned.
- Magic Eden buyer cost model: list price × (1 + 2% taker fee + 5% creator royalty).

**Desk market** (live snapshot 2026-09-07 05:40 UTC — worked example only, recompute):
- Desks minted 2,221 · listed 56 · floor 6.41 SOL · true buyer cost 6.86 SOL ·
  mint cost 14.98 SOL → **sweep-vs-mint spread 8.12 SOL (sweep ~54% cheaper)**.
- OTC at $0.01529 (+100% 24h), $7.44M 24h volume, $547k liquidity, ≈$10.9M mcap,
  SOL ≈ $105.48.

**OTC-side constants** (resolve dynamically; reference values for tests):
- OTC program: `AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW`
- Desk pot: `BZcvtxDy4WihU24k3pezzajuiqYtTUHPfH7b5m26BucR`
- NFT collection & desk stock rotation list: resolve from OTC program config /
  IDL (reference implementation exists in the OTC Hub dashboard's shared sources).
- Read-only mainnet data feed for keepers/dashboard: **OTC_HUB MCP**
  `https://otchub.dev/api/mcp` (tools `query_otcsnapshot` — 5-min snapshots with
  `by_stock`, `per_desk`, `pot_sources`, `buybacks`; `query_nftholding` —
  per-desk owner/listing/accrued value; `query_claimlog`; `query_contractmap`).
  Sort `-created_date`, `limit ≤ 500`; response shape `{count, records[]}`.

### A3. $HUB launch configuration

| Parameter | Value |
|---|---|
| Ticker | $HUB |
| **Reward stock** | **OTC** (fixed at launch; every $HUB trade buys OTC for holders) |
| Launcher's own share | None (0%) |
| Treasury launch buy | Announced, from the multisig wallet, **capped at ≤2% of supply** — tranched in 2–3 buys, verify the on-chain % after each, stop at cap. Float funds source C (OTC rewards → pot) and LP pairing only; standing no-sell policy |
| Post-launch | Confirm $HUB appears in the reward-stock rotation (inbound channel) |

**Treasury HUB float policy (§A3.1).** The float exists for one purpose: the
launcher's 70% leg pays OTC **pro-rata on HUB held**, so a zero-HUB treasury earns
zero OTC rewards (source C). The cap is a **share of supply, never a fixed SOL
amount** — a fixed 10–20 SOL buy early on the curve could be 10%+ of supply and
reads as a dev wallet. At ≤2%:

- The treasury captures ~2% of the daily OTC bought by the 70% leg — meaningful
  pot funding without starving community rewards or concentrating optics.
- The float is custodied with the treasury multisig (program vault once the
  program is live), published with its on-chain balance, and covered by a
  standing **no-sell policy**: it is used only to claim source-C OTC (sold → pot)
  and to pair LP positions (HODL both legs). Any excess beyond the cap is burned.
- Size in 2–3 announced tranches; re-verify the actual on-chain supply % after
  each tranche before continuing (curve pricing makes pre-computation unreliable).

**§A3.2 Config propagation checklist — going live on mainnet.** `hub_mint`,
`otc_mint`, `desk_collection`, `otc_desk_pot`, `ops_wallet` and `authority` are
**not hardcoded anywhere in the frontend** — every consumer (`sdk/src/reader.ts`,
both dashboards' hooks/panels) reads them live off the on-chain `Config`
singleton each poll. Once `initialize_config` runs on mainnet with the real
values from the OTC launcher (https://otcdesks.cash/launcher) mint, both
dashboards pick them up automatically — **no source change required**. What
does need a manual, one-time flip per deploy target:

| Knob | File | Value at launch |
|---|---|---|
| `VITE_HUB_CLUSTER` | `web/.env.production.local` (hubconnect) and `otchub/.env.production.local` | `mainnet-beta` |
| `VITE_HUB_RPC_URL` | same two files | mainnet RPC (Helius, allowlisted to each origin) |
| `VITE_HUB_PROGRAM_ID` | same two files | mainnet program id (omit if the mainnet deploy reuses the devnet program keypair, since the SDK falls back to the address baked into the IDL) |
| `VITE_HUB_ENABLED` | `otchub/.env.production.local` only | `true` (otchub hides `/hub` behind this flag pre-launch; see `src/lib/hubFlag.js`) |

`web/src/hub/lib/deployments.ts`'s `HUB_MAINNET` constant (Deployments page
registry) is cosmetic only — that page self-detects a live mainnet program via
a real `Config` read the moment one succeeds, so it can't go stale even if this
constant is never hand-updated. Update it anyway for the static/offline view.

### A4. Tier system

Tiers bind to a desk NFT asset id, not to a wallet. Every `activate_tier` /
`upgrade_tier` call targets a tier directly (`target_tier`, 1..4) and pays two
things at once:

1. **A flat SOL fee** (`STEP_FEE_LAMPORTS = 0.5 SOL`) — paid once per call,
   independent of how many tiers the call crosses. A fresh activation straight
   into T4 costs the same 0.5 SOL as a fresh T1 activation; a later upgrade to
   any higher tier pays this 0.5 SOL again, once, regardless of the size of the
   jump — never `(to − from) × fee`.
2. **A $HUB burn** — the tier's $HUB cost is a cumulative table looked up from
   `Config.tier_hub_cost_units`; a fresh activation burns the full cost of the
   target tier, an upgrade burns only the difference from the tier already
   held (`hub_cost_delta`, never the same $HUB twice). Burned via spl-token
   `BurnChecked` at the moment of activation/upgrade — permanent, independent
   of the round-based buyback burn (§A7 below).

**Non-custodial activation ("wallet-native yield")** — `activate_tier` /
`activate_tier_otc` / `upgrade_tier` / `upgrade_tier_otc` never move, freeze,
or delegate the desk NFT. The instruction reads the caller's ownership of the
Metaplex Core asset via the Core plugin/DAS check baked into the instruction
itself (see instruction #2 in the table below), then writes tier state to a
`DeskTier` PDA keyed off the asset id — the NFT stays exactly where it was,
in the activating wallet, for the entire lifetime of the tier. There is no
protocol-owned escrow, vault, or custody account that ever holds a user's
desk (contrast `Vault` / `TreasuryState.vault`, §A6.2 below, which only ever
custody *treasury*-owned positions, never a user's). Only the $HUB burn leg
(point 2 above) moves tokens out of the wallet, and it is destroyed
(`BurnChecked`), not deposited anywhere. This is also why the desk stays
freely transferable and listable on secondary at any time — see §A4's
revocation-on-transfer note in the UI (`MechanicsPanel.tsx`) for what happens
to the tier when it is.

**Burn-based, never lock-based** — the launcher's 70% leg pays per-wallet
pro-rata on HUB held, so locked HUB would miss it; burned tiers never conflict.

| Tier | Weight | SOL fee (flat, per call) | To pot (90%) | To ops (10%) | $HUB burn (cumulative) |
|---|---|---|---|---|---|
| T1 TRADER | 1.00x | 0.5 SOL | 0.45 | 0.05 | 100,000 $HUB |
| T2 BROKER | 1.25x | 0.5 SOL | 0.45 | 0.05 | 125,000 $HUB |
| T3 DEALER | 1.60x | 0.5 SOL | 0.45 | 0.05 | 150,000 $HUB |
| T4 MARKET MAKER | 2.00x | 0.5 SOL | 0.45 | 0.05 | 200,000 $HUB |

Example: a fresh activation straight into T4 pays 0.5 SOL + burns 200,000
$HUB — one call, same SOL fee as a fresh T1. A holder who instead activates T1
(0.5 SOL + 100,000 $HUB burned) and later upgrades to T4 pays another 0.5 SOL
plus burns only the 100,000 $HUB difference (200,000 − 100,000) — never the
same $HUB twice, but the flat SOL fee is paid again on every call.

Display names are UI-only (`sdk/src/constants.ts` `TIER_NAMES`); the program
stores tier indices 1–4 and weights in basis points.

### A4.1 Paying the $HUB-burn leg in $OTC (dynamic swap-burn, ~2× premium)

Every call may alternatively pay its **$HUB-burn leg** in $OTC via
`activate_tier_otc` / `upgrade_tier_otc` (same `target_tier` argument). The
**flat SOL fee is unchanged** — 0.5 SOL, 90% pot / 10% ops, booked as round
inflow exactly like the SOL path (§A4) on both instructions. Only the tier's
$HUB-burn leg differs, and it is no longer priced off a static
authority-refreshed rate — it's a real, synchronous on-chain Jupiter
$OTC→$HUB swap, so it floats with $HUB's live market price:

| | Direct burn (`activate_tier` / `upgrade_tier`) | $OTC swap-burn (`activate_tier_otc` / `upgrade_tier_otc`) |
|---|---|---|
| Flat SOL fee | 0.5 SOL (90% pot / 10% ops) | same 0.5 SOL (90% pot / 10% ops) — identical, booked as round inflow either way |
| $HUB-burn leg | `BurnChecked` the tier's $HUB cost straight from the payer's ATA | caller supplies `otc_swap_amount` ($OTC input, sized off-chain via a live Jupiter quote); swapped $OTC→$HUB via `jupiter_swap::swap_exact_in` with `min_out = hub_cost_delta` — enforced on-chain via balance-delta, so it can never under-deliver the tier's own $HUB requirement; the $HUB received lands in the payer's own ATA and is `BurnChecked` there in full immediately (any amount cleared above the floor is a bonus burn) |
| Desk-pot leg | — | an **equal-scaled** $OTC amount (`OTC_PAY_SWAP_BURN_PCT_BP = 5_000`, i.e. an even 50/50 split) is charged again and injected straight into `OtcPotState.otc_vault` — no swap, it only raises `total_otc_bought_units`, lifting the lifetime average buy rate `claim_yield` prices every desk's yield at (mirrors `clear_creator_fees`'s 80% desk-pot leg) |
| Total $OTC cost | n/a | dynamic, priced at Jupiter's live rate — but because the desk-pot leg mirrors the swap leg 1:1, the total $OTC charged is always **~2× the swap leg's cost** ("2× premium" is now a pricing *outcome* of the 50/50 split, not a stored rate) |

Example: a fresh T4 activation pays 0.5 SOL + burns 200,000 $HUB either way —
one call. On the $OTC path the caller sizes `otc_swap_amount` off a live
Jupiter quote so the swap clears ≥200,000 $HUB; an equal-scaled $OTC amount
lands in the desk pot on top of the swap leg, so the total $OTC spent is ~2×
what the swap alone would have cost at that quote.

`OtcPayConfig` is a separate PDA created by the authority after
`initialize_config` (`init_otc_payments`, starts disabled), so the path can be
added to a live deployment without migrating `Config`. `enabled` is now its
only mutable field (`set_otc_payments_enabled`) — there is no rate to
refresh, since every call prices itself off a fresh Jupiter quote. Absent or
disabled ⇒ direct-$HUB-burn only.

### A5. Yield engine

Pot inflow sources:
- **A — Activation fees**: 0.45 SOL per tier step (front-loaded at launch).
- **B — Treasury desk yield (redirected to the HUB Pot, §A5.1)**: treasury-owned
  desks claim desk-pot rounds across the 13-stock rotation; the 4
  MemeStock-basket stocks pass straight into the HUB Pot untouched, the other 9
  are swapped and split evenly across the same 4 buckets. **No longer a SOL
  pot-inflow source** — see §A5.1 for the full flow. ≈0.144 SOL/desk/day
  equivalent value at current take.
- **C — Treasury OTC-stock claims**: treasury HUB float (§A3.1, ≤2% of supply)
  claims its pro-rata launcher 70% leg (paid in OTC) like any holder; OTC sold → pot.
- **D — Discount-exit SOL leg**: 50% SOL half of every treasury desk sale → pot.
- **F — LP swap fees**: $HUB/SOL and $HUB/OTC LP positions held by the treasury
  (§A6.2); harvested swap fees → pot.

Distribution is **threshold-gated, not clocked** — the same mechanic as the OTC desk
pot ("the moment the pot clears 0.1 SOL it is spent"). Inflow accumulates in the
open *round* (`Epoch` account); `finalize_epoch` is rejected until the round's
inflow (plus whole lamports of dust carried from earlier rounds) reaches
`MIN_POT_THRESHOLD = 0.1 SOL`, and succeeds the moment it does. A round can be
seconds or days long depending on flow.

```text
burn           = ⌊0.05  × round_inflow⌋                 [BURN_PCT_BP]
lp             = ⌊0.025 × round_inflow⌋                 [LP_PCT_BP]
treasury_float = ⌊0.025 × round_inflow⌋                 [TREASURY_FLOAT_PCT_BP]
swap_total     = burn + lp + treasury_float             [10% of inflow]
distributable  = round_inflow − swap_total               [the 90% $OTC leg, unchanged mechanic]
per_weight     = ⌊distributable × 10¹² / Σ w_j⌋          [scaled, u128, lamport-equivalent]
acc_per_weight += per_weight                            [Config, lifetime]
yield_i        = ⌊(acc_per_weight − stamp_i) × w_i / 10¹²⌋   [owed, lamport-equivalent]
otc_due_i      = ⌊owed_i × OtcPotState.total_otc_bought_units / OtcPotState.total_lamports_spent⌋

# swap_total lamports are spent immediately, in the same finalize_epoch call:
hub_received   = jupiter_swap::swap_exact_in(swap_total SOL → $HUB, min_hub_out)
hub_burn       = ⌊hub_received × burn / swap_total⌋
hub_lp         = ⌊hub_received × lp   / swap_total⌋
hub_float_req  = hub_received − hub_burn − hub_lp        [absorbs the floor-rounding remainder]
hub_float_dep  = min(hub_float_req, float_cap_units − TreasuryState.treasury_float_units)
hub_burn_total = hub_burn + (hub_float_req − hub_float_dep)   [cap excess folds into burn]
```

`acc_per_weight` still accrues in **lamport-equivalent** units (unchanged accounting) —
only `claim_yield`'s payout leg changed. Desks are paid in **$OTC**, not SOL: the pot
never buys $OTC itself, a keeper does. `init_otc_pot` (authority, one-time) creates
`OtcPotState` (`["otc_pot"]`) + its vault-owned `otc_vault` token account. Every
`finalize_epoch` adds its distributable amount to `OtcPotState.otc_pending_lamports`
(pot liability, tracked in `Config.pot_liability_lamports` like every other pot leg).
The keeper then calls `record_otc_buy(otc_bought, lamports_spent, buy_tx)`: it fronts
SOL, buys $OTC on the market, deposits it into `otc_vault` in the **same transaction**
(`TransferChecked`, enforced on-chain — not merely attested), then is reimbursed from
the pot up to `otc_pending_lamports` (a replay can never over-draw it). This produces a
running **lifetime average buy rate** — `total_otc_bought_units / total_lamports_spent`
— that `claim_yield` uses to convert each desk's lamport-equivalent `owed` into $OTC
(`otc_due` above), paid straight from `otc_vault` to the claimer's ATA. `claim_yield`
reverts with `NoOtcPurchased` until the first buy is recorded — there is nothing to
convert into until then.

The other 10% (`swap_total`) never sits as a pot liability waiting on a keeper —
`finalize_epoch` itself pulls it out of the pot, wraps it into the vault-owned
`vault_wsol` ATA (`SyncNative`), and routes it through a single **synchronous**
Jupiter CPI (the caller assembles the route's `jupiter_data` + `remaining_accounts`
off-chain from a live quote; the swap enforces `min_hub_out` via balance-delta). The
$HUB that comes back splits 50/25/25 (of that 10%, i.e. 5%/2.5%/2.5% of total
inflow) in the **same transaction**: `hub_burn_total` is `BurnChecked` from
`vault_hub` immediately (`BurnState.total_hub_burned` ledger bump); `hub_lp` is
earmarked in `TreasuryState.lp_pending_hub_units`, physically custodied in
`vault_hub` until the phase-2 `build_lp(HubOtc)` adapter draws it down; `hub_float_dep`
is `TransferChecked` into `TreasuryState.treasury_float_vault` (buy-and-hold),
capped at `hub_float_cap_bp` of supply — any amount that would push past the live
cap folds into the burn leg instead of being left un-swapped. No off-chain
keeper round-trip, no `record_burn` draw, for this leg.

Each `DeskTier` stores `stamp_acc_per_weight` (set at activation and on every
claim), so one `claim_yield` pays everything a desk earned across **every round
closed since its stamp** in a single transaction — there is no per-round claiming
and nothing to catch up. Sub-lamport fractions (from the ⌊⌋ floors) accumulate in
`Config.dust_scaled`; whole lamports of dust re-enter the next round as inflow,
so the accounting is exactly zero-sum. Desks activated after a round closed do
not share in it (their stamp is already past it).

Direct-to-holder stream (no tier needed, per wallet, pro-rata on HUB held):
`0.70 × f × V_HUB_volume` of OTC bought daily, where `f` = creator-fee rate
(verify at launch).

### A5.1 HUB Pot — "M.I.M ETF" MemeStock basket yield (source B redirect)

$HUB's primary holder reward is a fixed 4-token basket — **$OTC, CRCLx,
NVDAx, SPCXx** (the "MemeStock basket"), branded to holders as the
**M.I.M ETF ("Magic Internet Money" ETF)** — funded entirely by the
treasury's own desk-pot yield (source B: the 13-stock rotation claimed by the
treasury-owned desks, §A2/A6). "HUB Pot" is the on-chain/SDK name
(`HubPotConfig`/`HubPotRound`/`HubPotClaim`, `init_hub_pot` etc.) — both names
refer to the same mechanism; M.I.M ETF is purely the front-end/marketing
label, kept separate from account/instruction identifiers to avoid
re-auditing already-tested code for a rename. This **replaces** source B's
old routing into the SOL round-inflow pot (§A5) — the 13-stock claim is
consolidated straight into the basket instead of being sold to SOL:

```text
13-stock claim (treasury-owned desks, per round)
 ├─ OTC, CRCLx, NVDAx, SPCXx (4 native basket stocks) → pass straight through, NO SWAP
 └─ AAPLx, MSFTx, AMZNx, ANTHROPIC, POLYMARKET, KALSHI, NEURALINK, ANDURIL, OPENAI (9 stocks)
     → swap each to SOL (Jupiter, slippage-capped) → sum the SOL proceeds
     → split the total evenly 25/25/25/25 across the 4 buckets
     → swap each 25% share SOL → its bucket token
                                                        ↓
                              fund_hub_pot (enforced 4× TransferChecked)
                                                        ↓
                        HubPotConfig (["hub_pot"]) — 4 vault-owned token accounts
                                                        ↓
               open_hub_pot_round — snapshots all 4 pending balances × Σw (tier-weighted)
                                                        ↓
                              claim_hub_pot_reward (owner pulls, per desk)
                                        or
                        distribute_hub_pot_reward (authority pushes, per desk)
     — either path pays an active desk's tier-weighted share of all 4 buckets to its
     current owner in one instruction (4 transfer_checked CPIs); both share one
     HubPotClaim PDA per (round, desk), so a desk is paid at most once per round
```

- No swap is needed for the 4 basket stocks — they are already the reward
  asset, so consolidating them here (rather than selling all 13 to SOL like
  source B did before this feature) is strictly more efficient: fewer swap
  hops, no slippage paid on assets that don't need to move.
- **`HubPotConfig`** (`["hub_pot"]`, one-time via `init_hub_pot`) records the
  4 mints (otc, crclx, nvdax, spcxx — resolved at init, never
  hardcoded) and their vault-owned token accounts, plus pending /
  lifetime-deposited totals per bucket (mirrors `TokenomicsConfig`'s
  reward-pending bookkeeping).
- **`fund_hub_pot`**: the treasury deposits the four already-converted
  amounts (swapped off-chain by the keeper, per the diagram above) in one
  instruction — four enforced `TransferChecked` CPIs, not merely attested
  (mirrors `fund_treasury_reward`). Adds to each bucket's pending balance.
- **`open_hub_pot_round`** (permissionless, mirrors `open_reward_round`):
  snapshots all four pending balances against the live Σw of active desks
  into a new `HubPotRound`, then zeroes the pending balances.
- **`distribute_hub_pot_reward`** (authority push, mirrors
  `distribute_treasury_reward` exactly, ×4 mints) and **`claim_hub_pot_reward`**
  (owner-signed pull, mirrors `claim_airdrop`) both pay an active desk's
  tier-weighted share of all four buckets —
  `⌊round.<bucket>_units × weight_bp(tier) / round.total_weight_bp⌋` per
  bucket — to the desk's current owner in a single transaction, and both
  share the **same `HubPotClaim` PDA** per `(round_index, desk_asset)`, so a
  desk is paid at most once per round regardless of which path is used
  (exactly how `claim_airdrop`/`distribute_airdrop` share `AirdropClaim`).
  Desk owners are expected to self-serve via `claim_hub_pot_reward` — **per
  desk, or in bulk across every desk they own** (one instruction per desk,
  client-batched into as few transactions as fit, the same pattern
  `claim_yield` already uses for multi-desk claims) — with `distribute_hub_pot_reward`
  as an authority fallback for desks whose owners don't self-claim. The owner
  needs an ATA per bucket token; a desk already receiving `claim_yield` $OTC
  already has the $OTC one, and an activated otcdesks.cash desk implies a
  wallet already used to holding SPL/Token-2022 stock ATAs — for
  `claim_hub_pot_reward` specifically, the claimant pays to open any missing
  ATA (rent) plus the `HubPotClaim` rent and the tx fee, same self-funding
  pattern as `claim_airdrop`. Capped per-bucket so `<bucket>_distributed_units`
  can never exceed `round.<bucket>_units` (`HubPotRoundExceeded`) — the same
  over-draw guard on both paths.
- This is **independent of, and in addition to**, the existing single-asset
  $HUB `fund_treasury_reward` / `open_reward_round` / `distribute_treasury_reward`
  path (§A6.3/§A7.1 bridge) — that mechanism's funding source (the OTC
  launcher's holders-in-stock "Stack" leg from $HUB's own creator fees,
  §A6.3) is unrelated to the treasury's desk-pot yield and is unaffected by
  this feature. A desk holder may receive both on independent cadences: $HUB
  from `distribute_treasury_reward` and the M.I.M ETF basket, claimed
  (`claim_hub_pot_reward`) or pushed (`distribute_hub_pot_reward`).

### A6. Treasury desk flywheel

**Acquisition rule — sweep, never dilute:**

```text
sweep_cost = list_price × (1 + 0.02 + 0.05)     # taker + royalty
mint_cost  = 100_000 × p_OTC_SOL + 0.5
SWEEP if sweep_cost < mint_cost                  # current: 6.86 < 14.98 ✓
MINT  if sweep_cost ≥ mint_cost AND treasury holds ≥100k OTC + 0.5 SOL free
```

- Only sweep desks with **verified non-empty vault stock** (on-chain ATA read).
- Sweep budget cap: ≤10% of treasury SOL per desk; payback cap ≤60 desk-days at
  D = 0.07 (max sweep cost ≈ 4.2 SOL/desk at that take) — pause sweeps above it.
- **SOL is the reserve asset — never drained to fund an acquisition.** Before every
  sweep the keeper computes `sol_available = max(0, treasury_sol − SOL_RESERVE_FLOOR)`.
  If `sol_available ≥ sweep_cost`, pay entirely from free SOL. Otherwise swap only the
  shortfall (`sweep_cost − sol_available`) worth of $OTC into SOL — never more, and
  never below the floor — then sweep; if the treasury doesn't hold enough $OTC to cover
  even the shortfall, the sweep is deferred (not forced) until the next cycle. Reference
  implementation: `keeper/sweeper/src/arbitrage.ts::decideAcquisition`.

**Discount exit (community-first):**

```text
sale_value = 0.90 × floor_live                   # verified ME floor at tx build
HUB leg    = 0.50 × sale_value / p_HUB  → BURNED in the sale tx
SOL leg    = 0.50 × sale_value           → pot, in the sale tx
```

- Treasury claims all accrued vault yield before listing the desk (buyer gets it clean).
- Exits announced; wallet-restricted to non-treasury addresses; one desk per wallet
  per exit window; tx reverts if floor moved > 5% since build.
- Exit economics (live example): buy 6.86, exit 5.77 → break-even after ≈ 8
  desk-days of yield. Exits are optional liquidity, not the business model.

### A6.2 LP building — $HUB/SOL first, $HUB/OTC as we grow

**Bootstrap LP is free**: launching via the OTC launcher means the $HUB bonding
curve seeds the $HUB/SOL pool automatically at launch — the treasury does not
hand-seed day-one liquidity. The LP program then deepens beyond the curve:

- **Phase 1 — $HUB/SOL: graduation IS the bootstrap.** When the bonding curve
  graduates, the curve's accumulated SOL + $HUB migrate into the AMM pool —
  day-one LP already exists at market depth and the treasury seeds **nothing**.
  The LP manager only tops up if measured live impact degrades (reference
  ceiling `LP_TARGET_SOL_DEPTH = 100–200 SOL-side`: keep a 5-SOL trade under
  ~5% impact and the hourly-TWAP'd 10% buyback-burn chunk under ~1%). If
  graduation depth already clears those bars — likely — the LP manager stays
  passive: harvest fees (source F) and monitor. Any top-up pairs **founding
  $HUB allocation + treasury SOL (ops surplus)** — never market-buy HUB for LP.
- **Phase 2 — $HUB/OTC**: opens only after $HUB price has been stable ≥ 24
  hours post-launch. Seed ≈ **25–50 SOL-equivalent per side**, pairing treasury
  OTC (from source C claims) with treasury HUB float. Rationale: OTC is the
  reward stock — stakers rotate OTC ↔ HUB without two SOL hops, tightening the
  flywheel.
- **Funding**: ops surplus (the 10% ops share beyond running costs) + explicit
  treasury allocations; harvested **swap fees → pot (source F)**, compounding
  staker yield.
- **Guardrails — phase 1 ($HUB/SOL)**: graduation-created AMM pool is
  protocol-owned (pump-style) — there is no withdrawable LP authority for the
  treasury or anyone to pull, which is itself a trust signal worth publishing.
  Any top-up position stays custodied in the treasury PDA vault; one position
  per pair; every deposit/withdrawal announced; depth + collected fees
  published daily.
- **Guardrails — phase 2 ($HUB/OTC, lock + burn, no rug)**: rather than custody
  the LP token, `build_lp_otc_locked` deposits into the Raydium CP-Swap
  HUB/OTC pool and, in the **same transaction**, calls Raydium's
  `lock_cp_liquidity` CPI — this **burns the LP mint outright** (principal can
  never be withdrawn by anyone, ever) while creating a `LockedLiquidity`
  record that lets the treasury PDA keep claiming the pool's trading fees
  forever (source F). Net effect: permanent, un-ruggable depth that still
  compounds staker yield through harvested fees. HODL both legs — the
  treasury never sells HUB out of LP; one locked position per pair; every
  deposit + lock announced on-chain.
- **No LP authority to hold**: neither phase leaves the treasury (or anyone)
  a live LP-withdraw path — phase 1 because graduation never mints one,
  phase 2 because the lock instruction burns it in the same tx it's created.

### A6.3 Creator fee flywheel — the treasury's launcher holder-leg claim

A **second**, independent $OTC stream feeds the same desk-pot: the treasury
holds 2% of $HUB supply (§A7.1) and, as a $HUB holder, claims its pro-rata
share of the OTC launcher's own 70% holders-in-stock leg (§A1) — an
inflow that arrives **already denominated in $OTC**, no swap required to
receive it. That claim is re-split 80/5/5/5/5 every time it clears a
threshold, funding the desk pot directly plus four smaller protocol legs:

```text
received (100% $OTC, from the launcher's holders-in-stock leg)
 ├─ 80% → OtcPotState (direct injection, NO SWAP)      — raises everyone's lifetime avg buy rate
 ├─  5% → swap OTC→HUB, BURN                            — buyback-burn sink #2 (§A7)
 ├─  5% → 50% swap OTC→HUB / 50% kept as OTC            — deposited + LOCKED into the HUB/OTC pool (§A6.2 phase-2)
 ├─  5% → swap OTC→HUB, held in treasury                — HUB float (§A7.1 cap still applies)
 └─  5% → swap OTC→SOL, held in ops reserve             — funds sweep/mint/LP protocol ops (§A6)
```

- **`CreatorFeeState`** (`["creator_fee"]`) tracks `pending_otc_units` (received,
  not yet split), `clear_threshold_units` (default 1,000 $OTC,
  `update_config`-style authority-adjustable), and lifetime totals per leg
  (`total_received_otc`, `total_desk_pot_otc`, `total_burn_otc/hub`,
  `total_lp_otc`, `total_stack_otc/hub`, `total_ops_otc`,
  `total_ops_sol_lamports`) — the same "pending vs. lifetime" pattern as
  `OtcPotState` and `TreasuryState.lp_pending_hub_units`.
- **`record_creator_fee`**: the treasury deposits its claimed $OTC into
  `creator_fee_vault` — an enforced `TransferChecked`, not a mere attestation
  (mirrors `record_otc_buy`'s deposit enforcement).
- **`clear_creator_fees`** (permissionless, deterministic bp math like
  `finalize_epoch`): once `pending_otc_units ≥ clear_threshold_units`, splits
  the *whole* pending balance in one instruction. The 80% desk-pot leg moves
  immediately — a program-signed vault-to-vault $OTC transfer straight into
  `OtcPotState.otc_vault`, bumping `total_otc_bought_units` **without**
  touching `total_lamports_spent` (no swap, no cost basis added) so it
  mechanically lowers every desk's lifetime average buy rate. The other four
  5% legs become per-leg pending earmarks (`burn/lp/stack/ops_pending_otc`);
  **the desk-pot leg is derived as the remainder** of the four (floor-rounded)
  minor legs, so it absorbs all rounding dust and the split always balances
  exactly to the cleared amount.
- **`draw_creator_fee_leg`** (keeper-only): pulls a leg's earmark out of
  `creator_fee_vault` (enforced `TransferChecked`, capped at that leg's
  pending balance) so the keeper can execute the off-chain swap. Then one of
  three attestation instructions records the result, using the same
  trust + idempotency-tx-hash model as `record_creator_fee_burn_result`
  (this program can no more cheaply verify an external swap than it can
  verify an external burn):
  - **`record_creator_fee_burn_result`** — swap done, $HUB burned; bumps
    `BurnState.total_hub_burned` (same ledger as the §A5/A7 buyback-burn sink)
    and `CreatorFeeState.total_burn_hub`.
  - **`record_creator_fee_stack`** — swap done, $HUB landed in the treasury's
    float (plain wallet transfer, outside program custody); bumps
    `total_stack_hub`.
  - **`record_creator_fee_ops`** — enforced (not attested): the keeper's
    post-swap SOL transfer to `Config.ops_wallet` happens in the *same*
    instruction as the ledger bump, refilling the reserve the sweeper's
    arbitrage logic (§A6) never drains.
  - The LP leg has no separate attestation — it's drawn like the others, then
    the keeper feeds its OTC (and the HUB half after a swap) into
    `build_lp_otc_locked` (§A6.2 phase-2), which deposits and locks in one tx.
- **Why 80/5/5/5/5 and not something else**: 80% is deliberately the
  dominant leg — it's the only one that's swap-free, so it's the cheapest and
  fastest to execute, and it compounds the exact mechanic every staker already
  benefits from (§A5's lifetime average buy rate). The remaining 20% is spread
  evenly across the protocol's three other sinks (burn, LP, treasury stack)
  plus an ops-SOL top-up, rather than concentrating risk in any one lever.

### A7. Buyback-burn sinks

| Event | HUB burned |
|---|---|
| Every pot inflow | 10%, bought on market, burned |
| Every treasury desk exit | 50% of consideration, in sale tx |
| Tier pricing | SOL-priced in this draft; HUB-pricing optional post-launch (community decision) |

No emissions, no minted staking rewards — supply is monotonic down after launch.

**§A7.1 Launch supply allocation** (`TokenomicsConfig`, `init_tokenomics` — program
`constants.rs` / SDK `constants.ts`, mirrored in the dashboard's Tokenomics tab):

| Slice | Share | Notes |
|---|---|---|
| Yield reserve | 2.00% | Held by the treasury multisig, never sold — backs the OTC-launcher reward basket ($OTC, CRCLx, NVDAx, SPCXx) that funds desk-holder yield. |
| LP reserve | 0.50% | Held by the treasury multisig, never sold — seeds/deepens $HUB's own liquidity position. |
| Desk airdrop | ≤2.50% | 10,000 $HUB per desk asset activated on otcdesks.cash before the snapshot, capped at the first 2,500 activated desks (`AIRDROP_DESK_CAP`); paid via Merkle claim to the desk's current owner. Scales down with fewer desks — the shortfall simply stays public. |
| Public / bonding curve | ≥95.00% | Everything not carved out above — bought up the OTC launcher's bonding curve. 0% team/dev allocation. |

Yield reserve + LP reserve are recorded on-chain as a single `treasury_lock_bp` (2.5%,
`YIELD_RESERVE_BP + LP_RESERVE_BP`); the dashboard splits it back into the two sub-shares
for display using the fixed 200:50 launch ratio. At the full 2,500-desk airdrop cap the
carve-outs total the full 5% treasury figure and public settles at exactly 95%.

**Supply definitions (SDK `constants.ts` / `reader.ts`, dashboard §C3/§C6):**

```text
MAX_SUPPLY   = 1,000,000,000 HUB (× 10⁶ base units), minted once, mint authority revoked
burned       = MAX_SUPPLY − Mint.supply      # spl-token Burn (mostly synchronous, inside
                                             # finalize_epoch/activate_tier_otc/upgrade_tier_otc),
                                             # so the mint account itself is the burn proof;
                                             # BurnState.total_hub_burned is the on-chain ledger
                                             # and must equal it (dashboard flags "drift" if not)
locked       = HUB in treasury-multisig ATA + vault-PDA ATA + TreasuryState.lp_hub_deposited
circulating  = MAX_SUPPLY − burned − locked
burn %       = burned / circulating           # headline; also shown as burned / MAX_SUPPLY
```

There is no sink/"burn wallet": a burn address in the Dexscreener/CoinGecko sense is
the mint (supply decreases) plus the BurnState PDA (`["burn"]`) as the on-chain ledger.

### A8. Sizing formulas (live worked examples — recompute, never promise)

```text
D = desk-pot take ≈ 0.144 SOL/desk/day; C = sweep cost ≈ 6.86 SOL; F = floor ≈ 6.41 SOL
pot_inflow/day = 0.45×A_steps + T×D + treasury_OTC_proceeds + exit_SOL_legs
```

| Scenario | Activated | Swept | D used | Pot inflow/day | Yield pool (90%) |
|---|---|---|---|---|---|
| Bear | 100 @ T1 | 3 | 0.05 | ≈45 SOL | 40.5 SOL |
| Base | 400 @ w̄1.3 | 10 | 0.12 | ≈190 SOL | 171 SOL |
| Bull | 900 @ w̄1.4 | 25 | 0.18 | ≈430 SOL | 387 SOL |

Base case, cohort Σw = 520: T1 desk ≈ 0.33 SOL/day (≈2.3× the raw desk-pot take);
T4 desk ≈ 0.66 SOL/day. Honest framing: $HUB yield compresses toward
`T×D×0.90/Σw + launcher legs` as adoption grows — every scenario still beats the raw
desk-pot take for activated desks. The desk take has collapsed before (−85% routing
cliff) — hence the sweep payback cap and treating sources A/C as uncorrelated with D.

### A9. Open community decisions (defaults chosen)

1. Tier pricing currency: **SOL** (default) vs HUB (extra burn sink, price risk).
2. Exit queue: **tier-weighted** (default) vs first-come vs lottery.
3. Ops share: **10% of activation fees** (covers RPC/relay/hosting).
4. Treasury minting when spread inverts: **dynamic** (§A6) — the keeper always sweeps
   when `sweep_cost < mint_cost` (the common case; minting burns 100k OTC and dilutes
   per-desk rounds, cutting against the not-greedy principle). It only mints when the
   spread inverts (`sweep_cost ≥ mint_cost`, e.g. no viable stocked listings) **and**
   the treasury already holds the full 100k OTC + 0.5 SOL free — it never sells the
   SOL reserve short to force a mint.
5. LP growth funding: ops surplus + explicit allocations (default) vs carving
   a small % of pot inflows pre-distribution (deepens the pool but dilutes
   staker yield short-term) — revisit once LP fee revenue is measurable.
6. Treasury launch-buy cap: **≤2% of supply** (§A3.1) vs lower (1%) — revisit
   after observing real source-C OTC proceeds vs community optics.

---

## PART B — ENGINEERING SPEC (repo `hubconnect`)

### B1. Repository layout

```text
hubconnect/
├── programs/hub/              # Anchor program (Solana, Rust)
│   └── src/…
├── tests/                     # integration tests (solana-bankrun / devnet)
├── keeper/                    # off-chain services (TypeScript)
│   ├── keeper/                # buyback-burn executor
│   ├── sweeper/               # desk sweep + vault verification
│   ├── treasury/              # exit listing + multisig tx builder
│   ├── lp/                    # LP depth monitor + fee harvest
│   ├── creator-fee/           # §A6.3 flywheel: clear + per-leg swap orchestration
│   └── shared/                # gas-float watermarks shared across keepers
├── sdk/                       # typed client SDK (activation, claims, read APIs)
│   ├── idl/                   # hub.json / hub.ts copied from target/ (scripts/copy-idl.mjs)
│   └── src/constants.ts       # mirror of programs/hub/src/constants.rs + HUB_PROGRAM_ID
├── web/                       # treasury dashboard (Vite); otchub.dev/hub
├── docs/                      # this spec + verification evidence
└── scripts/                   # devnet-deploy.sh · verify-build.sh · devnet-*.ts · hub-authority.ts
```

Stack (as built — see README "Toolchain"): Anchor 1.2.0 (`anchor-lang` 1.2.0,
TS client `@anchor-lang/core`), Agave 4.2.2, `solana` crate 4.0.3 pinned for the
verifiable Docker build, @solana/web3.js, TypeScript, anchor-ts (ts-mocha)
tests, **Helius devnet RPC for the devnet test stage (§B5.1)**. Program id,
IDL account and singleton PDAs are listed in **Appendix — Deployment addresses**.

### B2. On-chain program — accounts

| Account | Seeds (all under program id) | Key fields |
|---|---|---|
| `Config` | `["config"]` | authority, pot PDA, ops_wallet, treasury, **OTC-side refs** (otc_program, otc_desk_pot, desk_collection, hub_mint, otc_mint — runtime-set, §A2), tier_weights_bp[4], step_fee_lamports (flat, §A4), **tier_hub_cost_units[4]** (cumulative $HUB burn table, §A4), min_pot_threshold_lamports (0.1 SOL), burn_pct_bp (500), **lp_pct_bp (250)**, **treasury_float_pct_bp (250)** — §A5 4-way split (90/5/2.5/2.5), remainder is the $OTC-vault leg, ops_pct_bp (1000, step-fee split only), lp_enabled, lp_target_sol_lamports, lp_phase2_open_ts, paused, current_epoch, genesis_ts, total_weight_bp, pot_liability_lamports, **acc_per_weight (u128, lifetime, lamport-equivalent)**, **dust_scaled (u128)**, bumps |
| `OtcPotState` | `["otc_pot"]` | authority (keeper trusted for `record_otc_buy`), otc_vault (vault-owned $OTC token account `claim_yield` pays from), otc_pending_lamports (pot liability awaiting a buy), total_lamports_spent, total_otc_bought_units (⇒ lifetime avg buy rate), last_buy_tx, bump — §A5 90% leg, created once via `init_otc_pot` |
| `CreatorFeeState` | `["creator_fee"]` | authority (keeper), creator_fee_vault (vault-owned $OTC token account), clear_threshold_units (default 1,000 $OTC), pending_otc_units, burn/lp/stack/ops_pending_otc (per-leg earmarks awaiting a keeper draw), total_received_otc, total_desk_pot_otc, total_burn_otc/hub, total_lp_otc, total_stack_otc/hub, total_ops_otc, total_ops_sol_lamports, last_burn_result_tx / last_stack_tx (idempotency), bump — §A6.3 second flywheel, created once via `init_creator_fee_state` |
| `Epoch` (one round) | `["epoch", epoch_index u64]` | index, start_ts, finalized_ts, inflow_lamports, distributed_lamports (credited), burn_pending_lamports, **lp_pending_lamports**, **treasury_float_lamports** (the three swap-leg SOL amounts, §A5 4-way split — informational; spent synchronously, not a keeper-drawn balance), rolled_forward_lamports (floor remainder), total_weight_bp (Σw at close), per_weight_scaled, acc_per_weight_after, finalized |
| `DeskTier` | `["tier", asset_id]` | asset_id, owner_at_activation, tier 1–4, activated_epoch, **stamp_acc_per_weight**, total_claimed_lamports, voided |
| `Pot` (SOL escrow) | `["pot"]` | system-owned PDA; balance via lamports (no data) |
| `BurnState` | `["burn"]` | authority, total_hub_burned (lifetime ledger — bumped directly by `finalize_epoch`'s synchronous swap-burn, `activate_tier_otc`/`upgrade_tier_otc`'s swap-burn, and treasury discount-exit burns), last_burn_tx[64] (unused since the Jupiter-CPI refactor — no producer writes it post-refactor; kept for layout stability) |
| `TreasuryState` | `["treasury"]` | multisig, vault (PDA below), desks_owned, sweep_budget_cap_bp (1000), sweep_payback_cap_lamports (4.2 SOL), exit_discount_bp (1000), exit_hub_leg_bp (5000), floor_staleness_bp (500), **hub_float_cap_bp (500, admin-updatable via `set_treasury_float_cap_bp`)**, total_exits, total_sweeps, **lp_pending_hub_units** (§A5 2.5% LP-build leg, $HUB not lamports, drawn down by phase-2 `build_lp`), **vault_wsol** (vault-owned WSOL scratch ATA, the Jupiter swap's SOL-side input), **vault_hub** (vault-owned $HUB scratch ATA, the swap's destination + `lp_pending_hub_units`'s physical custody), **treasury_float_vault** (vault-owned $HUB buy-and-hold ATA, capped at `hub_float_cap_bp` of supply), **treasury_float_units** (running balance vs. the cap). The three new ATAs are recorded once via `init_treasury_float`; `finalize_epoch` rejects (`TreasuryFloatNotInitialized`) until they are |
| `Vault` (treasury custody) | `["vault"]` | program-signed PDA that holds treasury-side token positions (LP, §A6.2) and signs the swap-leg transfers/burns above; no data account (derived only) |
| `OtcPayConfig` | `["otc_pay"]` | §A4.1: enabled, pol_account (vault-owned $OTC ATA reserved for a future POL/`build_lp(HubOtc)` leg — the swap-burn/desk-pot split above no longer routes the per-call $OTC leg through it), total_otc_collected (lifetime $OTC charged across both legs). Created by `init_otc_payments`; optional. No stored rate — every call prices itself off a fresh Jupiter quote |
| `HubPotConfig` | `["hub_pot"]` | §A5.1: otc/crclx/nvdax/spcxx mints (runtime-resolved) + their vault-owned token accounts, `<bucket>_pending_units` ×4 (awaiting `open_hub_pot_round`), `<bucket>_deposited_units` ×4 (lifetime), round_count. Created once via `init_hub_pot` |
| `HubPotRound` | `["hub_pot_round", index u32]` | §A5.1: index, `<bucket>_units` ×4 (snapshotted at open), total_weight_bp (Σw at open), `<bucket>_distributed_units` ×4, claims, opened_ts |
| `HubPotClaim` | `["hub_pot_claim", round_index u32, asset]` | §A5.1: one payout per desk asset per HUB Pot round — round, asset, owner, `<bucket>_units` ×4, claimed_ts (double-payout guard shared by `claim_hub_pot_reward` and `distribute_hub_pot_reward`, mirrors `AirdropClaim`/`RewardClaim`) |

**Singletons created at M1 (`initialize_config`, one tx):** `Config`, `BurnState`,
`TreasuryState` and `Epoch[0]` are `init`-ed together; `Pot` and `Vault` are
derived only. All four seeds live under the program id and are exposed by the
SDK (`configPda`, `potPda`, `burnPda`, `treasuryPda`, `vaultPda`, `epochPda`).

All amounts in lamports; all rates in basis points. Every OTC-side address
(pot target verification, royalty rates, rotation list) is a **Config field
resolvable by authority**, never compiled in — with a resolution script that reads
the OTC program config on-chain and proposes updates.

### B3. On-chain program — instructions

| # | Instruction | Accounts | Constraints |
|---|---|---|---|
| 1 | `initialize_config` | payer, Config, Pot, BurnState, TreasuryState, Vault, Epoch[0] | once; args = ops_wallet, treasury, otc_program, otc_desk_pot, desk_collection, hub_mint, otc_mint, tier weights, step fee, `min_pot_threshold_lamports`; payer becomes `Config.authority` and `BurnState.authority`; opens round 0 |
| 2 | `activate_tier` | payer, desk NFT (Metaplex Core asset), Config, Epoch, Pot, ops wallet, hub_mint, payer $HUB ATA, Token program, DeskTier | args: `target_tier` (1..4); verify payer owns desk asset via Core plugin/DAS **inside the instruction**; fresh activation (or re-activation of a voided tier) straight into `target_tier`; pay flat 0.5 SOL: 90% → Pot, 10% → ops; `BurnChecked` the full $HUB cost of `target_tier` from the payer's $HUB ATA |
| 3 | `upgrade_tier` | payer, desk NFT, Config, Epoch, Pot, ops, hub_mint, payer $HUB ATA, Token program, DeskTier | args: `target_tier`; pay the same flat 0.5 SOL fee again (once, regardless of step size); `BurnChecked` only the $HUB delta between the current tier and `target_tier`; same ownership check (mismatch → void, no charge) |
| 4 | `finalize_epoch` | keeper (permissionless), Config, Epoch, next Epoch, Pot, BurnState, OtcPotState, TreasuryState, vault PDA, hub_mint, vault_wsol, vault_hub, treasury_float_vault, Token program, Jupiter program, remaining_accounts (route) | args: `epoch_index`, `min_hub_out`, `jupiter_data`; **threshold gate**: rejected (`PotBelowThreshold`) until inflow + dust carry ≥ `min_pot_threshold_lamports`; requires `TreasuryState.vault_hub` initialized (`init_treasury_float` first); 90% → `OtcPotState.otc_pending_lamports`, `acc_per_weight += ⌊distributable × 10¹² / Σw⌋` (unchanged mechanic); the other 10% (5% burn / 2.5% LP / 2.5% treasury float) is pulled from the pot and swapped SOL→$HUB in one **synchronous** Jupiter CPI right here, then split 50/25/25 — burned / earmarked in `lp_pending_hub_units` / deposited in the float (capped, excess → burn), all in the same tx; opens the next round with the floor remainder (§A5) |
| 4b | `init_otc_pot` | authority (one-time), Config, otc_vault, OtcPotState | args: `keeper` pubkey; creates `OtcPotState` + records its vault-owned $OTC token account (§A5) |
| 4c | `record_otc_buy` | keeper (must be `OtcPotState.authority`), Config, OtcPotState, otc_mint, keeper $OTC ATA, otc_vault, Pot | args: `otc_bought`, `lamports_spent`, `buy_tx`; requires `!Config.paused`; `TransferChecked`-deposits `otc_bought` into `otc_vault` in this tx (enforced, not attested), then reimburses the keeper `lamports_spent` from the pot, capped at `otc_pending_lamports` (`OtcBuyExceedsPending`); updates the lifetime avg buy rate |
| 5 | `claim_yield` | claimer, desk NFT, DeskTier, Config, OtcPotState, otc_mint, otc_vault, claimer $OTC ATA, Token program, Pot | **lazy revocation**: re-verify desk ownership on-chain NOW; if caller ≠ owner → void tier (voided = true, no refund) and revert; `owed = ⌊(acc − stamp) × w / 10¹²⌋` for every round since the stamp; reverts `NoOtcPurchased` until the first `record_otc_buy`; pays `otc_due = ⌊owed × total_otc_bought_units / total_lamports_spent⌋` in $OTC from `otc_vault`; stamp := acc; `NothingToClaim` when `owed` or `otc_due` rounds to zero |
| 6 | `register_treasury_inflow` | treasury multisig, Config, Epoch, Pot | record source B/C/D/F inflows into the open round |
| 8 | `void_tier` (internal path in 3/5) | — | ownership change discovered at claim/upgrade voids the tier |
| 9 | `update_config` | authority (multisig), Config | only whitelisted fields (incl. `min_pot_threshold_lamports`, must be > 0); rate changes apply to rounds finalized afterwards |
| 10 | `pause` / `unpause` | authority | halts activate/upgrade/claim and every keeper reimbursement draw that pays protocol-custodied funds out to an EOA (`record_otc_buy`, `draw_creator_fee_leg`) on anomaly — the only fast stop against a compromised keeper key, since those authorities aren't independently rotatable. Inbound deposits, permissionless internal bookkeeping (`clear_creator_fees`), and attestation-only instructions stay open so a legitimate keeper can settle in-flight recovery even while paused |
| 13 | `build_lp` | treasury multisig, Config, treasury LP vault, AMM pool accounts | `lp_enabled` must be true; deposit paired liquidity per §A6.2 (HUB/SOL top-ups, or bookkeeping-only intent recording); LP tokens custodied in the treasury PDA vault; withdraw path can never sell HUB |
| 13a | `init_treasury_float` | treasury multisig (one-time), Config, TreasuryState, vault PDA, vault_wsol, vault_hub, treasury_float_vault | records the three vault-owned ATAs `finalize_epoch`'s synchronous Jupiter legs and the $OTC swap-burn leg need (WSOL scratch, $HUB scratch, $HUB buy-and-hold float); `finalize_epoch` rejects (`TreasuryFloatNotInitialized`) until this runs |
| 13b | `set_treasury_float_cap_bp` | treasury multisig, Config, TreasuryState | args: `hub_float_cap_bp` (≤ 10,000 bp); experimental, admin-updatable — the multisig may retune the float cap at will; excess over the live cap at deposit time is burned, never rejected (§A6.3/§A7.1) |
| 14 | `init_otc_payments` | authority, Config, TreasuryState, Vault, pol_account, OtcPayConfig | §A4.1; `pol_account` must be an SPL token account with mint = `Config.otc_mint`, owner = vault PDA; creates `OtcPayConfig` disabled, `total_otc_collected = 0` — no stored rate to initialize since pricing comes from a live Jupiter quote per call |
| 15 | `set_otc_payments_enabled` | authority, Config, OtcPayConfig | args: `enabled`; on/off switch only — there is no rate to refresh (replaces the old `set_otc_rate`) |
| 16 | `activate_tier_otc` | payer, desk NFT, Config, Epoch, Pot, ops_wallet, OtcPayConfig, otc_mint, payer $OTC ATA, OtcPotState, otc_vault, hub_mint, payer $HUB ATA, Token program, Jupiter program, DeskTier, remaining_accounts (route) | args: `target_tier`, `otc_swap_amount`, `jupiter_data`; same gates as #2; requires `otc_pay.enabled`; pays the same flat 0.5 SOL fee as #2 (90% pot / 10% ops, booked as inflow); swaps `otc_swap_amount` $OTC→$HUB via Jupiter (`min_out = hub_cost_delta`), `BurnChecked`s the full amount received from the payer's $HUB ATA; charges an equal-scaled $OTC amount straight into `otc_vault` (`OTC_PAY_SWAP_BURN_PCT_BP`, no swap); `total_otc_collected += otc_paid_total` |
| 17 | `upgrade_tier_otc` | payer, desk NFT, Config, Epoch, Pot, ops_wallet, OtcPayConfig, otc_mint, payer $OTC ATA, OtcPotState, otc_vault, hub_mint, payer $HUB ATA, Token program, Jupiter program, DeskTier, remaining_accounts (route) | args: `target_tier`, `otc_swap_amount`, `jupiter_data`; same gates/state as #3 (ownership change → void, no charge); same flat-fee + swap-burn/desk-pot-leg mechanics as #16, priced off `hub_cost_delta(from, target_tier)` |
| 18 | `init_creator_fee_state` | authority (one-time), Config, creator_fee_vault, CreatorFeeState | args: `keeper` pubkey, `clear_threshold_units`; creates `CreatorFeeState` + records its vault-owned $OTC token account (§A6.3) |
| 19 | `record_creator_fee` | treasury multisig, Config, CreatorFeeState, otc_mint, treasury $OTC source, creator_fee_vault, Token program | args: `otc_received`; `TransferChecked`-deposits the treasury's claimed launcher holder-leg $OTC into `creator_fee_vault` (enforced, not attested); bumps `pending_otc_units` + `total_received_otc` |
| 20 | `clear_creator_fees` | permissionless, CreatorFeeState, Config, otc_mint, OtcPotState, creator_fee_vault, otc_vault, Pot (signer PDA), Token program | rejected (`CreatorFeeBelowThreshold`) until `pending_otc_units ≥ clear_threshold_units`; splits the whole pending balance 80/5/5/5/5; 80% desk-pot leg moves in this tx (program-signed vault-to-vault transfer into `otc_vault`, bumps `OtcPotState.total_otc_bought_units` only — no swap); other four legs become `*_pending_otc` earmarks; desk-pot leg = remainder of the four floor-divided minor legs (absorbs all rounding dust) |
| 21 | `draw_creator_fee_leg` | keeper (must be `CreatorFeeState.authority`), Config, CreatorFeeState, otc_mint, creator_fee_vault, keeper $OTC ATA, Pot (signer PDA), Token program | args: `leg` (Burn/Lp/Stack/Ops — `DeskPot` excluded, no swap needed), `otc_amount`; requires `!Config.paused`; `TransferChecked`-pays the keeper from `creator_fee_vault`, capped at that leg's pending balance (`CreatorFeeLegExceedsPending`) |
| 22 | `record_creator_fee_burn_result` | keeper, CreatorFeeState, BurnState | args: `otc_spent`, `hub_burned`, `burn_tx`; attests an off-chain OTC→HUB swap + burn already executed from a drawn `Burn` leg; idempotency via `burn_tx` (`InvariantViolated` on repeat); bumps `BurnState.total_hub_burned` (same ledger as the §A7 sink) and `CreatorFeeState.total_burn_hub` |
| 23 | `record_creator_fee_stack` | keeper, CreatorFeeState | args: `otc_spent`, `hub_amount`, `stack_tx`; attests an off-chain OTC→HUB swap whose $HUB landed in the treasury's float (plain wallet transfer, outside program custody); idempotency via `stack_tx`; bumps `total_stack_hub` |
| 24 | `record_creator_fee_ops` | keeper, Config, CreatorFeeState, ops_wallet, System program | args: `otc_spent`, `sol_amount`; enforced (not attested) — transfers `sol_amount` lamports keeper → `Config.ops_wallet` in the same instruction as the ledger bump; bumps `total_ops_sol_lamports` |
| 25 | `build_lp_otc_locked` | treasury multisig, Config, TreasuryState, treasury vault PDA, Raydium CP-Swap `deposit` accounts + locking-program `lock_cp_liquidity` accounts (remaining_accounts, split at `deposit_account_count`) | §A6.2 phase-2 only, gated on `lp_phase2_open_ts`; args: `hub_amount`, `otc_amount`, `lp_token_amount`, `deposit_account_count`, `with_metadata`; CPIs Raydium `deposit` then `lock_cp_liquidity` **in the same tx** — burns the LP mint, creates a `LockedLiquidity` record so the treasury PDA keeps claiming pool fees forever; bumps `TreasuryState.lp_hub_otc_active/lp_hub_deposited/lp_quote_deposited` |
| 33 | `init_hub_pot` | authority (one-time), Config, 4 basket vaults, HubPotConfig | §A5.1; args: otc/crclx/nvdax/spcxx mints; creates `HubPotConfig` + records its 4 vault-owned token accounts |
| 34 | `fund_hub_pot` | treasury multisig, Config, HubPotConfig, 4 mints, 4 treasury source ATAs, 4 vaults, 4 token programs (one per bucket — never assumed classic, `update_hub_pot_mint` can move a bucket to Token-2022 or back) | §A5.1; args: `otc_amount`, `crclx_amount`, `nvdax_amount`, `spcxx_amount`; four enforced `TransferChecked` deposits (not attested) in one instruction; bumps each bucket's pending + lifetime-deposited totals |
| 35 | `open_hub_pot_round` | permissionless, Config, HubPotConfig, HubPotRound | §A5.1; requires `Config.total_weight_bp > 0` (`NoActiveStakers`) and at least one bucket pending > 0 (`NoRewardPending`); snapshots all 4 pending balances × Σw into a new `HubPotRound`, zeroes pending |
| 36 | `distribute_hub_pot_reward` | authority, desk NFT, DeskTier, Config, HubPotConfig, HubPotRound, TreasuryState, vault PDA, 4 mints, 4 vaults, owner's 4 basket ATAs, 4 token programs (one per bucket), HubPotClaim | §A5.1; args: `round_index`; pays one active desk's tier-weighted share of all 4 buckets to its current owner in a single tx (4 `TransferChecked` CPIs); per-bucket capped at `round.<bucket>_units` (`HubPotRoundExceeded`); one claim per desk asset per round (`HubPotClaim` PDA) |
| 37 | `claim_hub_pot_reward` | claimant (desk owner, signer), desk NFT, DeskTier, Config, HubPotConfig, HubPotRound, TreasuryState, vault PDA, 4 mints, 4 vaults, claimant's 4 basket ATAs (pre-existing, claimant-funded rent), 4 token programs (one per bucket), HubPotClaim | §A5.1; args: `round_index`; user-initiated pull — identical math/over-draw guard to #36; shares the same `HubPotClaim` PDA as #36 (mirrors `claim_airdrop`/`distribute_airdrop`), so a desk is paid at most once per round regardless of path; per desk per call — bulk claiming across several owned desks is client-side batching (one ix per desk per tx, like `claim_yield`) |

Program-level invariants to assert everywhere: `inflow_lamports ==
distributed + burn_pending + rolled_forward`; pot lamports ≥ liability; DeskTier
weight lookup only for `voided == false`.

**Desk-pot desk-yield claim** (source B, §A5.1): the treasury claims OTC
desk-pot rounds for its owned desks using the OTC protocol's own claim
instruction — hubconnect does not wrap it; the keeper just performs it with
treasury keys, converts the 13-stock proceeds into the MemeStock basket, and
calls `fund_hub_pot` (no longer `register_treasury_inflow` — see §A5.1 for
why source B was redirected).

### B4. Keeper services (off-chain, TypeScript)

1. **Keeper (buyback-burn)** — whenever the open round is at threshold (poll
   `Epoch.inflow + dust carry ≥ min_pot_threshold`; anyone may call): assembles a Jupiter
   SOL→$HUB route (quote + `remaining_accounts`) and calls `finalize_epoch` with it — the
   swap, burn, LP earmark, and treasury-float deposit all happen **synchronously inside that
   one instruction** (no separate buy/burn/attest round-trip, nothing left pending). Publishes
   every tx. Idempotent: resume-safe journal, no double-finalize (`EpochAlreadyFinalized`).
2. **Sweeper** — watches Magic Eden listings + reads each listed desk's vault
   stock on-chain (non-empty required); applies §A6 formula (resolve OTC-side
   constants from config first); proposes sweeps within budget/payback caps;
   executes via treasury multisig; claims desk-pot rounds for owned desks and
   consolidates into the HUB Pot. **Harvest mechanics (source B, §A5.1):** per
   desk, for each of the 13 slots with a non-zero `["vault", asset_id]` stock
   ATA balance, call OTC `claim(index)` (slots 10–12 with `config_ext` +
   `vault_ext`) to the treasury's stock ATA (custom `[owner, tokenProgram,
   mint]` ATA order; Token-2022 for all but OTC). The 4 basket stocks (OTC,
   CRCLx, NVDAx, SPCXx) pass straight through untouched; the other 9 are
   sold for SOL via Jupiter with slippage caps, the SOL proceeds summed and
   split evenly 25/25/25/25, then each share swapped into its bucket token.
   Once all four bucket amounts are on hand, call `fund_hub_pot` (not
   `register_treasury_inflow` — source B no longer feeds the SOL round-inflow
   pot). OTC claimed from desks (slot 10) lands in the basket directly; it is
   not added to the treasury float (§A3.1).
3. **Treasury (exit)** — claims all accrued yield, lists at 90% of verified
   floor, escrow enforces 50% HUB burn + 50% SOL → pot in the same tx; floor
   staleness guard 5%.
4. **LP manager** — tracks live $HUB/SOL pool depth vs `lp_target_sol_lamports`;
   when below target and ops surplus allows, proposes `build_lp` via treasury
   multisig; harvests accumulated LP swap fees → `register_treasury_inflow`
   (source F); opens the $HUB/OTC position only after §A6.2 phase-2 conditions
   hold, via `build_lp_otc_locked` (deposit + `lock_cp_liquidity` in one tx —
   §A6.2/§A6.3); publishes depth + fees daily.
5. **Creator-fee keeper** (§A6.3) — claims the treasury's pro-rata launcher
   holder-leg $OTC, calls `record_creator_fee` to deposit it, and
   `clear_creator_fees` (permissionless) once `pending_otc_units` clears the
   threshold. For each of the four swap legs: `draw_creator_fee_leg`, execute
   the off-chain swap (Jupiter, slippage-capped, same pattern as the buyback
   keeper), then attest the result — `record_creator_fee_burn_result` (Burn),
   `record_creator_fee_stack` (Stack), `record_creator_fee_ops` (Ops, SOL sent
   in the same instruction), or feed the Lp leg's OTC (+ swapped HUB half)
   into `build_lp_otc_locked`. Idempotent via `burn_tx`/`stack_tx` hashes,
   mirroring the buyback-burn keeper's journal.

All keepers: run from secrets-managed keyers (never commit keys), structured
logs, and a dry-run mode. Keepers are permissionless where possible (finalize is
keeper-anyone with a small reward? — start permissioned, open later).

### B5. Test plan (the other agent must implement all)

**Unit (Rust):**
- Tier math: flat SOL fee regardless of step size, $HUB burn cost deltas,
  weight lookups, void semantics.
- Epoch math: pro-rata distribution, 4-way split (90% $OTC leg / 5% burn /
  2.5% LP / 2.5% treasury float), synchronous swap split + float-cap
  excess-to-burn folding, roll-forward, no rounding loss (last claimer gets
  remainder).
- $OTC yield math: `record_otc_buy` pending/spent/bought bookkeeping, replay
  rejection (`buy_tx` reuse), overspend rejection (`OtcBuyExceedsPending`),
  `claim_yield`'s lamport→$OTC conversion at the lifetime avg buy rate.
- Config guardrails: bp bounds, whitelisted update fields.

**Integration (bankrun + devnet):**
- Happy path: initialize → activate 4 desks across tiers → finalize → `init_otc_pot`
  → `record_otc_buy` → claim → verify exact lamports per weight, the 5%/5%
  burn/LP-pending split, and the $OTC payout at the recorded avg buy rate.
- **Threshold gate**: `finalize_epoch` rejected below `min_pot_threshold`;
  allowed immediately once reached (no clock); `claim_yield` with nothing closed
  since the stamp → `NothingToClaim`.
- **Lazy revocation**: transfer the desk NFT mid-round → old owner's claim
  reverts and voids the tier; new owner cannot claim without re-activating; no
  refund emitted.
- Upgrade path T1→T4 pays the flat SOL fee again (once) and burns exactly the
  $HUB difference (never the full T4 cost twice); double-upgrade rejected.
- Multi-round catch-up: a desk that skips rounds 1–2 claims both in one tx in
  round 3; Σ payouts + dust == credited exactly (zero-sum, ≤ 1 lamport floor per
  claim); whole-lamport dust re-enters the next round as inflow.
- Reentrancy/negative scenarios: claim with wrong desk, claim twice, finalize
  twice, inflow/liability invariant after every instruction (assert program
  panic if violated).
- Keeper: simulate the buyback route with a stub AMM/route builder; verify
  `finalize_epoch` (which swaps and burns synchronously) is idempotent across
  restarts (kill and resume) — a re-submit after a confirmed finalize must hit
  `EpochAlreadyFinalized`, never a double-burn.
- Sweeper: stub ME + vault reads; verify it never sweeps above payback cap,
  never sweeps empty-vault desks, and resolves OTC constants from config.
- LP: `build_lp` rejected while `lp_enabled = false`; LP tokens land in the
  treasury PDA vault; fee harvest registers pot inflow (source F) exactly once;
  HUB/OTC build rejected before the phase-2 gate; LP withdraw path can never
  sell HUB (asserted).

**Adversarial:**
- Floor spoof: exit tx with stale floor > 5% delta must revert.
- Treasury self-dealing: treasury wallet buying its own exit is rejected.
- Wash-transfer round-trip: transfer desk back to the original owner — tier
  stays voided; re-activation costs full steps.

**B5.1 Devnet test stage (Helius devnet RPC).** Bankrun proves program logic;
devnet proves the real network path — actual tx submission, confirmation,
blockhash expiry, priority fees, keepers reconnecting, and wallet UX. Helius
provides a devnet RPC endpoint (`https://devnet.helius-rpc.com/?api-key=<key>`,
same key infrastructure as mainnet) with airdrop-limited test SOL.

- **Environment split**: identical code, only the endpoint + program id + Config
  values differ. Never branch logic on cluster beyond that. Concretely:
  `Anchor.toml` `[programs.devnet]` / `[programs.localnet]` and
  `sdk/src/constants.ts` `HUB_PROGRAM_ID` carry the program id; the dashboard
  reads `VITE_HUB_CLUSTER`, `VITE_HUB_PROGRAM_ID`, `VITE_HUB_RPC_URL` from
  `web/.env.production.local` (RPC URL carries the Helius key — never commit it;
  `web/.env.example` documents the keys). Tests select the cluster with
  `HUB_CLUSTER=devnet`. All three must agree with the Appendix — Deployment
  addresses table.
- **OTC-side accounts do not exist on devnet** (the OTC program, desk pot, and
  desk collection are mainnet-only). All OTC-side references in devnet tests
  are **mock accounts deployed by the test harness**: a stub Metaplex-Core-style
  asset (or devnet Core mint) standing in for the desk NFT, stub pot wallet,
  stub SPL mints for HUB/OTC. The Config-driven design (§B2) is what makes this
  possible — no OTC address is compiled in.
- **Devnet suite (must pass before mainnet deploy):** the full integration +
  adversarial list above executed against the devnet cluster; plus an
  end-to-end epoch loop (activate → treasury inflow → finalize_epoch, which
  swaps and burns synchronously via a devnet AMM or mock-Jupiter route) with the
  keeper killed and resumed mid-loop; plus Metaplex Core ownership checks
  verified against real devnet Core assets.
- **Airdrops are rate-limited**: the harness maintains a devnet funder wallet
  (faucet + balance guard) and fails loudly when below a minimum, rather than
  producing flaky "insufficient funds" test failures.
- **Devnet is not a mainnet guarantee**: mainnet-specific facts (ME listings,
  real pot behavior, launcher mechanics) are covered only by the §B5 pre-launch
  verification checklist on mainnet, read-only.

**Pre-launch on-chain verification checklist (must all pass before $HUB launch):**
1. Launcher reward-stock claim settlement: claim instruction vs auto-airdrop,
   and whether it reads **wallet token balance** (determines treasury-float
   claim path in §A5-C and staker holding guidance).
2. Launched coins auto-join the reward-stock rotation (PONS precedent) — the
   inbound channel (§A3) exists.
3. Creator-fee rate `f` and that the 70/15/10/5 split holds on the launch
   summary before signing.
4. Treasury-owned desks receive desk-pot rounds identically to any desk (pilot
   sweep of 1–2 desks, verify claims).
5. Re-verify the 2% taker + 5% royalty buyer-cost model against live Magic
   Eden policy.

### B6. Upgradability — explicitly NOT immutable yet

The program is deployed **upgradeable** on purpose:

- Upgrade authority is retained and held by a **multisig** with a **timelock**
  (default 48h) before any upgrade takes effect; every upgrade is announced with
  a diff/changelog and the program is `pause`d during the swap.
- Storage layout compatibility is asserted on every upgrade build (no account
  field reinterpreted); the full B5 suite must pass against the new build
  before authority signs.
- Rationale: the OTC protocol itself may change under us (fee splits, rotation,
  claim mechanics, marketplace royalties) — hubconnect must be able to adapt.
  Immutability can be revisited post-launch (e.g., freeze authority once the
  verification checklist is stable and the design is audited), but v1 ships
  upgradeable.
- The `Config` account is the first-line adaptation path (rates, shares, caps
  change without a program upgrade); program upgrades are reserved for logic
  changes only.

### B7. Deliverables & milestones

1. **M1 — scaffold** ✅ (devnet, 2026-09-07): repo layout, program with Config +
   all instructions, test harness, CI (fmt, clippy, test); `initialize_config`
   executed on devnet — singleton addresses in Appendix — Deployment addresses.
2. **M2 — program complete**: all instructions + invariants; unit tests green.
3. **M3 — integration green**: B5 integration + adversarial suites pass on
   bankrun; devnet smoke.
4. **M3.5 — devnet suite green**: full B5.1 devnet stage passes (epoch loop,
   keeper resume, Core ownership checks) before any mainnet deploy.
5. **M4 — keepers**: all four services with dry-run modes + journals.
6. **M5 — verification checklist executed**: all 5 pre-launch items documented
   with on-chain evidence (tx signatures / screenshots in `docs/evidence/`).
7. **M6 — devnet pilot → mainnet deploy**: activate → finalize → claim → burn
   loop with a test SPL token standing in for $HUB; audit-ready state.

---

### B8. Agent tooling — install AI dev skills in the repo

The implementing agent should have expert Solana context loaded from day one:

- **Solana Foundation skills** (official, maintained): `npx skills add
  https://github.com/solana-foundation/solana-dev-skill`. Load especially:
  security checklist (account validation, signer checks, attack vectors),
  runtime concepts (rent, PDA semantics, entrypoint dispatch), common errors +
  Anchor/Solana/Rust version compatibility matrix, and IDL client codegen
  (Codama) for the `sdk/` package.
- **Helius Build skill + Helius MCP server** (`npx helius-mcp@latest`): DAS-first
  asset lookups (searchAssets over getProgramAccounts), dynamic priority-fee
  fetching, webhook setup, typed RPC tool calls for keeper development.
- **Testing stack note**: the official testing skill recommends LiteSVM/Mollusk
  (with Surfpool for mainnet-fork integration) rather than `solana-bankrun`;
  either satisfies M1's "fast integration harness" — pick one and use it
  consistently.
- **Caveat**: skills raise correctness, they are not an audit. The full B5/B5.1
  suite, the B5 pre-launch checklist, and a professional audit before mainnet
  funds remain mandatory.

---

## PART C — TREASURY DASHBOARD & YIELD TRACKER (user-facing)

### C1. Purpose

Desk owners must be able to answer one question before paying an activation fee:
**"What does an activated desk earn via $HUB vs leaving the desk raw?"** The
dashboard shows both numbers live, side by side, with the assumptions exposed —
never a promised APY. It is community tooling with the same evidence-first rules
as the rest of hubconnect: every figure links to its on-chain source.

### C2. Where it lives

The OTC Hub dashboard app (this repo's sibling) already ingests most inputs on a
5-minute cadence (OtcSnapshot: per-desk take history, pot sources, spot prices,
desk counts) and has the Helius RPC path — so the yield tracker is added **there**
as a new panel, reading hubconnect program accounts (Config, Pot, Epoch,
TreasuryState, BurnState) via the same RPC connection. hubconnect exposes only
read-only account decoders in its SDK (`sdk`); no privileged endpoints exist.
The interim standalone dashboard (`web/`, deployed at otchub.dev/hub) reads the
same accounts and lists every address below in its registry view
(`web/src/hub/lib/deployments.ts`).

**Merge status (2026-09-07):** `web/src/hub` and `sdk/` are vendored into the
otchub repo (`otchub/src/hub`, `otchub/src/hub-sdk`, alias `@hub-sdk`) and the
module is mounted at the otchub domain root — `/` (dashboard), `/treasury`,
`/deployments`, `/desk/:asset`; the OTC_DESK analytics moved to `/otc` and
`/hub/*` redirects. otchub supplies `rpcUrl` / `cluster` / `programId` via
`VITE_HUB_*` (defaults: public devnet RPC, IDL program id). `web/` remains the
standalone shell for otchub.dev/hub until the domains are consolidated;
`hubconnect` stays the source of truth — re-copy on change.

### C3. Live metrics strip (top of panel)

| Metric | Source |
|---|---|
| Pot balance + liability | Pot PDA lamports vs `Config.pot_liability_lamports` |
| Open round: inflow + dust carry vs `min_pot_threshold`, % to threshold, READY flag | Epoch + Config (no countdown — rounds have no clock) |
| Last closed round: how long it took, credited, per-tier payout | previous Epoch |
| Activated cohort: desks by tier, Σw | DeskTier accounts (index/scan) |
| Treasury: desks owned, exit history, burns executed, HUB float vs ≤2% cap | TreasuryState, BurnState, published treasury wallet |
| $HUB burned, **burn % of circulating**, circulating / locked supply (§A7 definitions) | Mint account (`supply`), treasury + vault ATAs, BurnState (ledger cross-check) |
| Raw desk-pot take D (trailing 7d and latest day) | OtcSnapshot per_desk history (already ingested) |

### C4. Yield comparison table (the core view)

For each tier T1–T4, recomputed live from the open round + config:

```text
round_size       = max(min_pot_threshold, effective_inflow_live)
proj_round_i     = (w_i / Σw_live) × 0.90 × round_size
round_secs       = last_round.finalized_ts − last_round.start_ts   # null before first close
rounds_per_day   = round_secs >= MIN_REALISTIC_ROUND_SECS ? 86400 / round_secs : null
proj_daily_i     = rounds_per_day === null ? null : proj_round_i × rounds_per_day
breakeven        = STEP_FEE_LAMPORTS / proj_round_i   # flat SOL fee ÷ payout — same fee at every tier
vs_raw           = proj_daily_i === null ? null : proj_daily_i / D_live   # multiplier vs raw desk take
```

Displayed per tier: flat SOL fee + cumulative $HUB burn (§A4), live weight,
projected SOL/day (with USD), breakeven in days, and the **vs-raw multiplier**
— the single number the whole product reduces to. Column beside it: the raw
desk earning (D) so the comparison is unmissable. Breakeven counts only the
SOL fee (the $HUB burn has no SOL-denominated price on-chain to net against
it). All projections labeled `ESTIMATE — scales with Σw; not a promise`.

`MIN_REALISTIC_ROUND_SECS` (1 hour) guards against extrapolating a day-rate
from an implausibly fast round close — rounds have no clock and close the
instant inflow crosses the threshold, so on a low-traffic cluster (e.g.
devnet's 0.1 SOL threshold hit by rapid test transactions) a round can close
in seconds. Multiplying a near-total-round payout by "seconds-per-day / a
few seconds" produces an impossible SOL/day figure. Below the floor,
`proj_daily_i` and everything derived from it (`vs_raw`) is `null` and the UI
shows `proj_round_i` only, with no fabricated cadence.

### C5. Single live view (no hypothetical scenarios)

The table always reflects the protocol's actual current state — live Σw,
live round size, live burn/LP/treasury-float split — with no separate
conservative/current/bull toggle. Σw naturally grows as more desks activate,
which the live numbers already show without an artificial multiplier; the
product goal is one trustworthy read of "what does activating right now
actually get me," not a menu of hypotheticals.

### C6. Treasury transparency panel

Sweep/exit ledger (every tx linked), burn history (HUB burned to
date, last burn tx), LP depth + harvested fees (source F), and the treasury HUB
float balance against its ≤2% cap — all read from on-chain accounts, no
hand-maintained numbers. Collapsible evidence sub-sections per the dashboard's
existing DOS-aesthetic conventions. A dedicated **Creator Fee Flywheel** panel
(§A6.3) shows the `CreatorFeeState` pending-vs-threshold progress bar and the
80/5/5/5/5 breakdown per leg (desk-pot injected, HUB burned, $OTC/HUB locked
into the LP, HUB stacked, SOL added to ops), plus lifetime totals and the
keeper/vault addresses.

**C6.1 Verification info (listing readiness).** A `[ VERIFICATION INFO ]` card with
copy buttons + Solscan links for everything a Dexscreener / CoinGecko / wallet
verification form asks for: $HUB mint (CA), program id, BurnState PDA (burn
proof), treasury multisig (locked), metadata PDA; live mint supply, burned,
locked, circulating, burn %, decimals; flags `MINT AUTH REVOKED`, `NO FREEZE
AUTH`, `METADATA`, `METADATA IMMUTABLE`, `LEDGER = MINT`; and the Metaplex Token
Metadata as indexers read it (name, symbol, uri, update authority, icon and
website/twitter/telegram/discord from the uri JSON, with a warning when the JSON
is unreachable or has no socials). Launch checklist derived from it: write Token
Metadata for the mint (name `OTC Hub`, symbol `HUB`, uri → JSON with `image` +
`extensions.{website,twitter,telegram}`), revoke mint authority, confirm the
treasury ATA is the only locked holder.

### C7. Rules

- Every displayed figure must be derivable on-chain or from the published
  OtcSnapshot feed — no manual treasury reporting.
- Community-tooling + DYOR disclaimers persist on this panel like everywhere else.
- The tracker never estimates the launcher 70% leg (per-wallet pro-rata) — that
  stream is direct-to-holder and shown only as a link-out explanation, since it
  depends on the viewer's own HUB balance, not the tier system.

---

## Appendix — Constants (single source of truth)

| Constant | Value |
|---|---|
| TIER_STEPS / WEIGHTS | 4 / [1.00, 1.25, 1.60, 2.00] |
| STEP_FEE | 0.5 SOL, flat — paid once per `activate_tier`/`upgrade_tier` call regardless of tiers crossed (90% pot / 10% ops) |
| TIER_HUB_COST (cumulative) | T1 100,000 / T2 125,000 / T3 150,000 / T4 200,000 $HUB — fresh activation burns the full target-tier cost, upgrade burns only the delta from the current tier (§A4) |
| OTC_PAY_SWAP_BURN_PCT_BP | 50% (5_000 bp) — the $OTC path's swap leg vs. desk-pot leg split; symmetric 50/50 makes the total $OTC charged ~2× the swap leg's live-priced cost (§A4.1). No stored premium/rate — priced off a fresh Jupiter quote every call |
| MIN_POT_THRESHOLD | 0.1 SOL per round (no clock; `update_config`-adjustable) |
| ACC_SCALE | 10¹² (accumulator precision) |
| BURN_PCT_BP | 5% of every round's inflow → swapped SOL→$HUB (synchronous Jupiter CPI in `finalize_epoch`), burned (§A5) |
| LP_PCT_BP | 2.5% of every round's inflow → swapped to $HUB, earmarked in `TreasuryState.lp_pending_hub_units` for the phase-2 $HUB/$OTC LP (§A5) |
| TREASURY_FLOAT_PCT_BP | 2.5% of every round's inflow → swapped to $HUB, deposited into `TreasuryState.treasury_float_vault` (buy-and-hold, capped at `TREASURY_HUB_FLOAT_CAP`; excess folds into the burn leg) (§A5) |
| OTC yield leg | remaining 90% — desks claim it in $OTC from `OtcPotState.otc_vault` at the pot's lifetime average buy rate (§A5) |
| REWARD_STOCK ($HUB launch) | OTC |
| LAUNCHER_SHARE | 0% |
| TREASURY_HUB_FLOAT_CAP | ≤5% of supply, admin-updatable via `set_treasury_float_cap_bp` (experimental parameter, §A6.3/§A7.1); excess over the live cap at deposit time is burned instead of floated — separate from the immutable 2%/0.5% genesis yield/LP reserves (§A3, §A7.1) |
| EXIT_DISCOUNT / HUB leg / SOL leg | 10% off live floor / 50% burned / 50% → pot |
| SWEEP_BUDGET_CAP | 10% of treasury SOL per desk |
| SWEEP_PAYBACK_CAP | ≤60 desk-days at D=0.07 (≈4.2 SOL/desk) |
| UNCLAIMED_YIELD_WARN | 0.02 SOL (claim-before-list UI flag) |
| FLOOR_STALENESS_GUARD | 5% |
| UPGRADE_TIMELOCK | 48h, multisig-held upgrade authority (not immutable) |
| LP_TARGET_SOL_DEPTH ($HUB/SOL) | 100–200 SOL-side — conditional top-up ceiling only; curve graduation already seeds the pool |
| HUB_OTC_LP_SEED | 25–50 SOL-eq per side, phase-2 gated (SOL pool at target + ≥24h stable) |
| LP_CUSTODY | Phase 1 ($HUB/SOL): LP tokens in treasury PDA vault, HODL both legs. Phase 2 ($HUB/OTC): `lock_cp_liquidity`-**burned** LP mint (no custody, no rug), permanent `LockedLiquidity` fee-claim right retained by the treasury PDA. Both legs' fees → pot (source F) |
| CREATOR_FEE_DESK_POT_BP / BURN_BP / LP_BP / STACK_BP / OPS_BP | 8000 / 500 / 500 / 500 / 500 — §A6.3 second flywheel split of the treasury's launcher holder-leg $OTC claim; desk-pot leg is a direct swap-free injection, the other four each swap off-chain before landing |
| CREATOR_FEE_CLEAR_THRESHOLD | 1,000 $OTC default (6 decimals assumed), authority-adjustable at `init_creator_fee_state` — mirrors `MIN_POT_THRESHOLD`'s no-clock, size-gated clearing |
| KEEPER_HARD_MIN / DRIP_TRIGGER / TARGET_CEILING (SOL gas float) | 0.02 / 0.05 / 0.3 SOL — off-chain-only watermarks (`keeper/shared/src/gas.ts`), no program instruction; below hard-min a keeper refuses to start a cycle, below drip-trigger it requests a manual multisig top-up from `ops_wallet` back to the ceiling. Separate from the `record_creator_fee_ops` pass-through SOL, which never idles in the keeper's balance |
| Keeper auto-operate gate | `keeper/shared/src/gate.ts`, off-chain-only, checked fresh every cycle: `Config.paused == false` **and** $HUB mint authority revoked ("mint sealed", resolved via `getMint().mintAuthority === null`, no Config field for this). Passing the gate only means a keeper *should* attempt a cycle — `register_treasury_inflow`/`record_creator_fee`/`build_lp`/`build_lp_otc_locked` still require the tx signer to literally be `Config.treasury`, a key-custody decision made outside the program |
| DESK_ACQUISITION_TARGET | 20 desks — `keeper/sweeper/src/arbitrage.ts`, off-chain-only launch-phase ceiling; `decideAcquisition` holds once `TreasuryState.desks_owned ≥` this, ahead of any sweep/mint pricing. No on-chain enforcement (`desks_owned` has no update instruction yet — set to 0 at `initialize_config`, never incremented on-chain today); raised by passing a higher `deskTarget`, not a program upgrade |
| RAYDIUM_CP_SWAP_PROGRAM_ID | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` (mainnet + devnet, same address) — Phase-2 HUB/OTC pool venue |
| RAYDIUM_LOCK_CP_SWAP_PROGRAM_ID | `LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE` — dedicated CP-Swap liquidity-locking program (`lock_cp_liquidity`: burns the LP mint, issues a permanent fee-claim `LockedLiquidity` record) |
| RPC_DEVNET | Helius devnet RPC (`devnet.helius-rpc.com`, same API key); OTC-side accounts mocked by the test harness |
| MPL_CORE_PROGRAM_ID | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` (`sdk/src/constants.ts`) |
| HUB_PROGRAM_ID | `7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i` (devnet + mainnet-beta, same id) |
| `f` (creator fee rate) | TBD at launch (checklist item 3) |

## Appendix — Deployment addresses (mainnet-beta deployed + verified 2026-09-08)

Source of truth for ids: `Anchor.toml`, `sdk/src/constants.ts`,
`web/.env.production.local`, `web/src/hub/lib/deployments.ts`. The previous
devnet program `DPEioLagahMiVy4xfSzeKLWjWho8GZhbvK85BgTkY8qW` was **closed** on
2026-09-07 (Config layout change for the threshold-round model; PDAs cannot be
re-initialized under the same id) — do not reference it anywhere. Its
successor, `5tCDEazUAkRjrkasup1uWcYo3t1C2ht76LmQva5rewQv`, was itself rotated
to the current id below before the mainnet-beta deploy — do not reference it
either.

| Item | Cluster | Address | Status |
|---|---|---|---|
| Hub program | devnet + mainnet-beta | `7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i` | **live** on both clusters (same id, upgradeable). Mainnet-beta: deployed via tx `33duFXLgzuVpe7uveQr3hWnnVrud3Vh6NZ2B1hzs2F3ibce4UV7uY7RTDGzmeYpV4Tpy9cQFykvngaKu47LNKyYg`, on-chain hash matches the verified Docker build, OtterSec-verified against `OTCHUB/hubconnect@1b3bb077` (job `7c683ade-879d-4cf1-b354-7f86d21ec6a9`, see [verify.osec.io/status/7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i](https://verify.osec.io/status/7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i)). `initialize_config` not yet called on mainnet-beta — deferred until the `$HUB` mint exists |
| Hub IDL / program metadata | devnet | `CnSKvxwKb3eNS6oF6GaAyAn8m3B8axXSCQYeBYrjdQfS` | live (Anchor 1.x metadata program `ProgM6JC…nk7S`) |
| Metaplex Core program | devnet + mainnet | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` | external |
| OTC Desk program | mainnet-beta | `AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW` | external, mainnet-only (mocked on devnet) |
| OTC Desks collection | mainnet-beta | `D7sLW9uKZG3G7bNbWfMHvKSgVhU9nXdv7huTfepF5Jrh` | external (mirrored on devnet by `devnet-mock-desks.ts`) |
| Pump.fun (launch dry-run) | devnet + mainnet | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | external test venue only |

**Devnet singleton PDAs (M1 `initialize_config`, all under the hub program id):**

| PDA | Seed | Address | State |
|---|---|---|---|
| `Config` | `["config"]` | `AfLMF6N7mYg9ooTEevqHMriakgH1AQADefhbbcjQeTS6` | initialized (411 B) |
| `Pot` | `["pot"]` | `HHKCcd2WYff9BieUyC6QM9sWAacXmhFkrUFxYguBsSsp` | system-owned, holds pot lamports |
| `BurnState` | `["burn"]` | `FAABfc8eYsBe95hzws7pCj7U67zA7aQ28BnffADjekfz` | initialized (121 B) |
| `TreasuryState` | `["treasury"]` | `7ePonUQ85jb4PHsUHaLFGYK4UCFRD1WEh1P7Wrv8pJH3` | initialized (126 B) |
| `Vault` | `["vault"]` | `3kokfoqWuPhfHEbrPiPaQa6ADtmTtcavh8BdGv1M2NgQ` | derived only (no account until first treasury-side token deposit, e.g. LP §A6.2) |
| `Epoch[0]` | `["epoch", 0u64]` | `3mSdteiDJxagm38mxmDc2e2q4KCwV61k9CMKMXU8cSwv` | initialized (106 B) |

**Devnet `Config` values (M1 + `devnet-config-reuse.ts`):** authority = ops_wallet
= treasury = deployer `FRsHGMKByp1EdckJVFU87i9FCf73NcbfMXcTZC71wJZz`;
`hub_mint` `HWBPrRKgVRetz6Sa7p2aHLwDgapKpzkeZkyhKd9nDwaj` (SPL, 1B × 10⁶);
`desk_collection` `25Qj1haczTkNNhmVdMdZmegn6kSj9WTwkhckgMUTQeMU` (mock Core
collection); `otc_program`, `otc_desk_pot`, `otc_mint` = harness placeholders
(replaced on mainnet by the §A2 resolution script); step fee 0.5 SOL,
`min_pot_threshold_lamports` 0.1 SOL, burn 1000 bp, ops 1000 bp, LP disabled
(target 100 SOL), not paused. Current state at verification: round 3 open, Σw
38,500 bp (three activated tiers).

*Community tooling. Not affiliated with the OTC protocol. Verify everything
on-chain. DYOR.*