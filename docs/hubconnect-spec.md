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

### A4.1 Paying steps in $OTC (2× premium → POL reserve)

Every call may alternatively pay its SOL leg in $OTC via `activate_tier_otc` /
`upgrade_tier_otc` (same `target_tier` argument, same $HUB burn either way).
The tier result is identical (same weight, same stamp, same lazy-revocation
rules); only the SOL-equivalent payment leg differs:

| | SOL path | $OTC path |
|---|---|---|
| Price per call | 0.5 SOL (flat, see §A4) | `⌈0.5 SOL × otc_per_sol × 2.00⌉` $OTC units — the flat SOL fee's value **at a fixed 2× premium** (`OTC_PREMIUM_BP = 20_000`, written at init, not updatable) |
| Reference rate | — | `OtcPayConfig.otc_per_sol` ($OTC base units per SOL), refreshed by the authority keeper (`set_otc_rate`); the path rejects a rate older than `OTC_RATE_MAX_AGE = 24h` |
| $HUB burn | full tier cost (fresh) / delta (upgrade) — burned either way | same, burned either way |
| Proceeds | 90% pot / 10% ops | 100% → **POL reserve**: the `["vault"]` PDA's $OTC token account. Nothing enters the pot or ops; the $OTC can only leave via a program instruction (`build_lp(HubOtc)`, §A6.2 phase 2) — it is the $OTC leg of the $OTC/$HUB pair, never operating capital |
| Round inflow | yes (source A) | **no** — an $OTC-paid call adds weight without adding SOL inflow |

Example at 1 SOL = 1,000 $OTC: a fresh T4 activation costs 0.5 SOL or 1,000
$OTC (500 $OTC of value × 2) plus burns 200,000 $HUB either way — one call.
`OtcPayConfig` is a separate PDA created by the authority after
`initialize_config` (`init_otc_payments`, starts disabled), so the path can be
added to a live deployment without migrating `Config`; absent or disabled ⇒
SOL-only.

### A5. Yield engine

Pot inflow sources:
- **A — Activation fees**: 0.45 SOL per tier step (front-loaded at launch).
- **B — Treasury desk yield**: treasury-owned desks claim desk-pot rounds;
  proceeds → pot. ≈0.144 SOL/desk/day at current take.
- **C — Treasury OTC-stock claims**: treasury HUB float (§A3.1, ≤2% of supply)
  claims its pro-rata launcher 70% leg (paid in OTC) like any holder; OTC sold → pot.
- **D — Discount-exit SOL leg**: 50% SOL half of every treasury desk sale → pot.
- **E — Consigned desks**: owner-sent desks (§A6.1) whose desk-pot rounds the
  treasury claims for the pool and distributes to activated desks.
- **F — LP swap fees**: $HUB/SOL and $HUB/OTC LP positions held by the treasury
  (§A6.2); harvested swap fees → pot.

Distribution is **threshold-gated, not clocked** — the same mechanic as the OTC desk
pot ("the moment the pot clears 0.1 SOL it is spent"). Inflow accumulates in the
open *round* (`Epoch` account); `finalize_epoch` is rejected until the round's
inflow (plus whole lamports of dust carried from earlier rounds) reaches
`MIN_POT_THRESHOLD = 0.1 SOL`, and succeeds the moment it does. A round can be
seconds or days long depending on flow.

```text
burn           = ⌊0.05 × round_inflow⌋                  [buy $HUB → burn, BURN_PCT_BP]
lp_pending    += ⌊0.05 × round_inflow⌋                  [TreasuryState, phase-2 build_lp, LP_PCT_BP]
distributable  = round_inflow − burn − lp_pending        [the 90% $OTC leg]
per_weight     = ⌊distributable × 10¹² / Σ w_j⌋          [scaled, u128, lamport-equivalent]
acc_per_weight += per_weight                            [Config, lifetime]
yield_i        = ⌊(acc_per_weight − stamp_i) × w_i / 10¹²⌋   [owed, lamport-equivalent]
otc_due_i      = ⌊owed_i × OtcPotState.total_otc_bought_units / OtcPotState.total_lamports_spent⌋
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

Each `DeskTier` stores `stamp_acc_per_weight` (set at activation and on every
claim), so one `claim_yield` pays everything a desk earned across **every round
closed since its stamp** in a single transaction — there is no per-round claiming
and nothing to catch up. Sub-lamport fractions (from the ⌊⌋ floors) accumulate in
`Config.dust_scaled`; whole lamports of dust re-enter the next round as inflow,
so the accounting is exactly zero-sum. Desks activated after a round closed do
not share in it (their stamp is already past it). The 5% LP-build leg accumulates
in `TreasuryState.lp_pending_lamports` (mirrors `BurnState.burn_pending_lamports`'s
keeper-draw pattern) until the phase-2 `build_lp(HubOtc)` adapter lands.

Direct-to-holder stream (no tier needed, per wallet, pro-rata on HUB held):
`0.70 × f × V_HUB_volume` of OTC bought daily, where `f` = creator-fee rate
(verify at launch).

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

### A6.1 Desk consignment — owner-sent desks

Any desk owner can **consign** their desk to the treasury instead of selling it:

- `consign_desk` transfers the desk NFT into the **treasury vault** and records a
  `ConsignedDesk` entry (asset_id → consignor). The owner keeps the withdrawal
  right; the desk is off the market while consigned.
- From the consignment round onward, the treasury claims that desk's desk-pot
  rounds exactly like its owned desks (same OTC claim instruction). Proceeds are
  pot inflow **(source E)** and are distributed to **connected (activated) desks**
  per the normal round formula.
- Optional contributor reward: `CONSIGNOR_SHARE` (default **0%** — all yield goes
  to the pool, per the community-first ethos) can later be raised via config to
  credit a share directly to the consignor's per-wallet `StakerAccrual`
  (`owed_lamports`), claimable any time in one `claim_accrual` tx. Consigned-desk
  claim proceeds are tracked separately so the split is always auditable.
- `unconsign_desk` returns the desk to the consignor once the round it was
  consigned in has closed (no round is double-counted); any accrued consignor
  share stays claimable.
- Guardrails: consigned desks are **never eligible for discount exits** (the exit
  pool is treasury-*owned* desks only); the program-enforced `ConsignedDesk`
  record blocks any treasury transfer/sale of a consigned desk; a
  claim-before-consign UI flag warns owners of unclaimed vault yield ≥ 0.02 SOL.

Why: owners who believe in $HUB can put idle desks' yield to work for stakers
without selling the desk — desk-pot take is turned into $HUB staker yield while
the owner stays long the desk.

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
- **Phase 2 — $HUB/OTC**: opens only after $HUB price has been stable ≥ 14
  days post-launch. Seed ≈ **25–50 SOL-equivalent per side**, pairing treasury
  OTC (from source C claims) with treasury HUB float. Rationale: OTC is the
  reward stock — stakers rotate OTC ↔ HUB without two SOL hops, tightening the
  flywheel.
- **Funding**: ops surplus (the 10% ops share beyond running costs) + explicit
  treasury allocations; harvested **swap fees → pot (source F)**, compounding
  staker yield.
- **Guardrails**: LP tokens custodied by the treasury PDA vault; HODL both legs
  — the treasury never sells HUB out of LP; one position per pair; every
  deposit/withdrawal announced; depth + collected fees published daily.
- **No LP authority to hold**: graduation-created AMM pools are protocol-owned
  (pump-style) — there is no withdrawable LP authority for the treasury or
  anyone to pull, which is itself a trust signal worth publishing.

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
| Yield reserve | 2.00% | Held by the treasury multisig, never sold — backs the OTC-launcher reward basket ($OTC, CRCLx, OpenAI, Anthropic) that funds desk-holder yield. |
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
burned       = MAX_SUPPLY − Mint.supply      # keeper burns with spl-token Burn, so the mint
                                             # account itself is the burn proof; BurnState.
                                             # total_hub_burned is the record_burn ledger and
                                             # must equal it (dashboard flags "drift" if not)
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
5. Consignor reward: `CONSIGNOR_SHARE` default **0%** (pure community
   contribution) vs a direct credit (e.g. 25–50%) to attract consignments —
   revisit after launch once real consignment demand is observable.
6. LP growth funding: ops surplus + explicit allocations (default) vs carving
   a small % of pot inflows pre-distribution (deepens the pool but dilutes
   staker yield short-term) — revisit once LP fee revenue is measurable.
7. Treasury launch-buy cap: **≤2% of supply** (§A3.1) vs lower (1%) — revisit
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
│   └── treasury/              # exit listing + multisig tx builder
├── sdk/                       # typed client SDK (activation, claims, read APIs)
│   ├── idl/                   # hub.json / hub.ts copied from target/ (scripts/copy-idl.mjs)
│   └── src/constants.ts       # mirror of programs/hub/src/constants.rs + HUB_PROGRAM_ID
├── web/                       # treasury dashboard (Vite); app.otchub.dev
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
| `Config` | `["config"]` | authority, pot PDA, ops_wallet, treasury, **OTC-side refs** (otc_program, otc_desk_pot, desk_collection, hub_mint, otc_mint — runtime-set, §A2), tier_weights_bp[4], step_fee_lamports (flat, §A4), **tier_hub_cost_units[4]** (cumulative $HUB burn table, §A4), min_pot_threshold_lamports (0.1 SOL), burn_pct_bp (500), **lp_pct_bp (500)** — §A5 90/5/5 split, remainder is the $OTC-vault leg, ops_pct_bp (1000, step-fee split only), consignment_enabled, consignor_share_bp, lp_enabled, lp_target_sol_lamports, lp_phase2_open_ts, paused, current_epoch, genesis_ts, total_weight_bp, pot_liability_lamports, **acc_per_weight (u128, lifetime, lamport-equivalent)**, **dust_scaled (u128)**, bumps |
| `OtcPotState` | `["otc_pot"]` | authority (keeper trusted for `record_otc_buy`), otc_vault (vault-owned $OTC token account `claim_yield` pays from), otc_pending_lamports (pot liability awaiting a buy), total_lamports_spent, total_otc_bought_units (⇒ lifetime avg buy rate), last_buy_tx, bump — §A5 90% leg, created once via `init_otc_pot` |
| `Epoch` (one round) | `["epoch", epoch_index u64]` | index, start_ts, finalized_ts, inflow_lamports, distributed_lamports (credited), burn_pending_lamports, rolled_forward_lamports (floor remainder), total_weight_bp (Σw at close), per_weight_scaled, acc_per_weight_after, finalized |
| `DeskTier` | `["tier", asset_id]` | asset_id, owner_at_activation, tier 1–4, activated_epoch, **stamp_acc_per_weight**, total_claimed_lamports, voided |
| `ConsignedDesk` | `["consign", asset_id]` | asset_id, consignor, consigned_epoch, active |
| `StakerAccrual` | `["accrual", wallet]` | per-wallet consignor credits: owed_lamports, total_claimed_lamports |
| `Pot` (SOL escrow) | `["pot"]` | system-owned PDA; balance via lamports (no data) |
| `BurnState` | `["burn"]` | authority, total_hub_burned, burn_pending_lamports, last_burn_tx[64] |
| `TreasuryState` | `["treasury"]` | multisig, vault (PDA below), desks_owned, desks_consigned, sweep_budget_cap_bp (1000), sweep_payback_cap_lamports (4.2 SOL), exit_discount_bp (1000), exit_hub_leg_bp (5000), floor_staleness_bp (500), hub_float_cap_bp (200), total_exits, total_sweeps, **lp_pending_lamports** (§A5 5% LP-build leg, drawn down by phase-2 `build_lp`) |
| `Vault` (NFT custody) | `["vault"]` | program-signed PDA that owns consigned desks; no data account (created lazily by Core on first transfer) |
| `OtcPayConfig` | `["otc_pay"]` | §A4.1: enabled, otc_per_sol, rate_ts, premium_bp (20_000, fixed), pol_account (vault-owned $OTC ATA = POL reserve), total_otc_collected. Created by `init_otc_payments` after M1; optional |

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
| 4 | `finalize_epoch` | keeper (permissionless), Config, Epoch, next Epoch, Pot, BurnState, TreasuryState | **threshold gate**: rejected (`PotBelowThreshold`) until inflow + dust carry ≥ `min_pot_threshold_lamports`; Σw > 0; 5% → burn-pending, 5% → `TreasuryState.lp_pending_lamports`, remaining 90% → `OtcPotState.otc_pending_lamports` (§A5); `acc_per_weight += ⌊distributable × 10¹² / Σw⌋` (still lamport-equivalent); opens the next round with the floor remainder |
| 4b | `init_otc_pot` | authority (one-time), Config, otc_vault, OtcPotState | args: `keeper` pubkey; creates `OtcPotState` + records its vault-owned $OTC token account (§A5) |
| 4c | `record_otc_buy` | keeper (must be `OtcPotState.authority`), Config, OtcPotState, otc_mint, keeper $OTC ATA, otc_vault, Pot | args: `otc_bought`, `lamports_spent`, `buy_tx`; `TransferChecked`-deposits `otc_bought` into `otc_vault` in this tx (enforced, not attested), then reimburses the keeper `lamports_spent` from the pot, capped at `otc_pending_lamports` (`OtcBuyExceedsPending`); updates the lifetime avg buy rate |
| 5 | `claim_yield` | claimer, desk NFT, DeskTier, Config, OtcPotState, otc_mint, otc_vault, claimer $OTC ATA, Token program, Pot | **lazy revocation**: re-verify desk ownership on-chain NOW; if caller ≠ owner → void tier (voided = true, no refund) and revert; `owed = ⌊(acc − stamp) × w / 10¹²⌋` for every round since the stamp; reverts `NoOtcPurchased` until the first `record_otc_buy`; pays `otc_due = ⌊owed × total_otc_bought_units / total_lamports_spent⌋` in $OTC from `otc_vault`; stamp := acc; `NothingToClaim` when `owed` or `otc_due` rounds to zero |
| 5b | `claim_accrual` | wallet, StakerAccrual, Config, Pot | pay the wallet's consignor credits (`owed_lamports`) in one tx; `AccrualEmpty` when zero |
| 6 | `register_treasury_inflow` / `register_consigned_inflow` | treasury multisig, Config, Epoch, Pot (+ ConsignedDesk, consignor StakerAccrual) | record source B/C/D/F (or E) inflows into the open round; for consigned-desk (E) proceeds, credit `consignor_share_bp` to the consignor's StakerAccrual, remainder → round inflow |
| 7 | `record_burn` | keeper, Config, BurnState, Pot | after the keeper buys HUB and burns it: mark burn executed, decrement burn-pending |
| 8 | `void_tier` (internal path in 3/5) | — | ownership change discovered at claim/upgrade voids the tier |
| 9 | `update_config` | authority (multisig), Config | only whitelisted fields (incl. `min_pot_threshold_lamports`, must be > 0); rate changes apply to rounds finalized afterwards |
| 10 | `pause` / `unpause` | authority | halts activate/claim on anomaly |
| 11 | `consign_desk` | owner, desk NFT, treasury vault, ConsignedDesk, Config | verify owner holds the desk asset (Core/DAS); `consignment_enabled` must be true; transfer NFT to vault; record consignor + epoch |
| 12 | `unconsign_desk` | consignor, desk NFT, treasury vault, ConsignedDesk, Config | only after the current epoch finalizes (no double-count); return NFT; set `active = false`; accrued consignor share (if any) stays claimable |
| 13 | `build_lp` | treasury multisig, Config, treasury LP vault, AMM pool accounts | `lp_enabled` must be true; deposit paired liquidity per §A6.2 (HUB/SOL first, HUB/OTC only after phase-2 gate); LP tokens custodied in the treasury PDA vault; withdraw path can never sell HUB |
| 14 | `init_otc_payments` | authority, Config, TreasuryState, Vault, pol_account, OtcPayConfig | §A4.1; `pol_account` must be an SPL token account with mint = `Config.otc_mint`, owner = vault PDA; creates `OtcPayConfig` disabled/unpriced with `premium_bp = OTC_PREMIUM_BP` |
| 15 | `set_otc_rate` | authority, Config, OtcPayConfig | args `otc_per_sol`, `enabled`; stamps `rate_ts = now`; `enabled` with rate 0 rejected. The premium is not an argument |
| 16 | `activate_tier_otc` | payer, desk NFT, Config, OtcPayConfig, otc_mint, payer $OTC ATA, pol_account, hub_mint, payer $HUB ATA, Token program, DeskTier | args: `target_tier`; same gates/state as #2; requires `enabled`, rate fresh (≤ 24h); `TransferChecked` of `otc_fee(step_fee(0, target_tier))` payer → POL reserve; `BurnChecked` the full $HUB cost of `target_tier`; no pot/ops/inflow booking; `total_otc_collected += fee` |
| 17 | `upgrade_tier_otc` | payer, desk NFT, Config, OtcPayConfig, otc_mint, payer $OTC ATA, pol_account, hub_mint, payer $HUB ATA, Token program, DeskTier | args: `target_tier`; same gates/state as #3 (ownership change → void, no charge; `ClaimBeforeUpgrade`); fee `otc_fee(step_fee(from, target_tier))` → POL reserve; `BurnChecked` only the $HUB delta between `from` and `target_tier` |

Program-level invariants to assert everywhere: `inflow_lamports ==
distributed + burn_pending + rolled_forward`; pot lamports ≥ liability; DeskTier
weight lookup only for `voided == false`.

**Desk-pot desk-yield claim** (sources B + E): the treasury claims OTC desk-pot
rounds for its owned **and consigned** desks using the OTC protocol's own claim
instruction — hubconnect does not wrap it; the keeper just performs it with
treasury keys and then `register_treasury_inflow` (consigned proceeds apply the
consignor share split). Consigned desks are claimed but never sold (§A6.1).

### B4. Keeper services (off-chain, TypeScript)

1. **Keeper (buyback-burn)** — whenever the open round is at threshold (poll
   `Epoch.inflow + dust carry ≥ min_pot_threshold`; anyone may call): (a) call `finalize_epoch`;
   (b) route burn-pending SOL through a public AMM (Jupiter) with slippage caps
   to buy HUB; (c) burn HUB (send to a published burn address); (d) call
   `record_burn`. Publishes every tx. Idempotent: resume-safe journal, no
   double-burn.
2. **Sweeper** — watches Magic Eden listings + reads each listed desk's vault
   stock on-chain (non-empty required); applies §A6 formula (resolve OTC-side
   constants from config first); proposes sweeps within budget/payback caps;
   executes via treasury multisig; claims desk-pot rounds for owned and
   consigned desks and registers inflow. **Harvest mechanics (source B/E):**
   per desk, for each of the 13 slots with a non-zero `["vault", asset_id]`
   stock ATA balance, call OTC `claim(index)` (slots 10–12 with `config_ext` +
   `vault_ext`) to the treasury's stock ATA (custom `[owner, tokenProgram, mint]`
   ATA order; Token-2022 for all but OTC), sell each stock for SOL via Jupiter
   with slippage caps, then `register_treasury_inflow` (or
   `register_consigned_inflow` for E) with the net SOL. OTC claimed from desks
   (slot 10) is sold like any other rotation stock — it is not added to the
   treasury float (§A3.1).
3. **Treasury (exit)** — claims all accrued yield, lists at 90% of verified
   floor, escrow enforces 50% HUB burn + 50% SOL → pot in the same tx; floor
   staleness guard 5%.
4. **LP manager** — tracks live $HUB/SOL pool depth vs `lp_target_sol_lamports`;
   when below target and ops surplus allows, proposes `build_lp` via treasury
   multisig; harvests accumulated LP swap fees → `register_treasury_inflow`
   (source F); opens the $HUB/OTC position only after §A6.2 phase-2 conditions
   hold; publishes depth + fees daily.

All keepers: run from secrets-managed keyers (never commit keys), structured
logs, and a dry-run mode. Keepers are permissionless where possible (finalize is
keeper-anyone with a small reward? — start permissioned, open later).

### B5. Test plan (the other agent must implement all)

**Unit (Rust):**
- Tier math: flat SOL fee regardless of step size, $HUB burn cost deltas,
  weight lookups, void semantics.
- Epoch math: pro-rata distribution, 90/5/5 split (burn / LP-pending / $OTC leg),
  roll-forward, no rounding loss (last claimer gets remainder).
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
- Keeper: simulate buyback route with a stub AMM; verify burn-pending →
  record_burn is idempotent across restarts (kill and resume).
- Sweeper: stub ME + vault reads; verify it never sweeps above payback cap,
  never sweeps empty-vault desks, and resolves OTC constants from config.
- Consignment: consign → treasury claims a round → consignor-share credit
  (at 0% and at 50% config) → unconsign after finalize returns the desk;
  treasury exit of a consigned desk is rejected; double-claim of one consigned
  desk rejected; unconsign before finalize reverts.
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
  end-to-end epoch loop (activate → treasury inflow → finalize → buyback-buy on
  a devnet AMM or stub → burn → record_burn) with the keeper killed and resumed
  mid-loop; plus Metaplex Core ownership checks verified against real devnet
  Core assets.
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
The interim standalone dashboard (`web/`, deployed at app.otchub.dev) reads the
same accounts and lists every address below in its registry view
(`web/src/hub/lib/deployments.ts`).

**Merge status (2026-09-07):** `web/src/hub` and `sdk/` are vendored into the
otchub repo (`otchub/src/hub`, `otchub/src/hub-sdk`, alias `@hub-sdk`) and the
module is mounted at the otchub domain root — `/` (dashboard), `/treasury`,
`/deployments`, `/desk/:asset`; the OTC_DESK analytics moved to `/otc` and
`/hub/*` redirects. otchub supplies `rpcUrl` / `cluster` / `programId` via
`VITE_HUB_*` (defaults: public devnet RPC, IDL program id). `web/` remains the
standalone shell for app.otchub.dev until the domains are consolidated;
`hubconnect` stays the source of truth — re-copy on change.

### C3. Live metrics strip (top of panel)

| Metric | Source |
|---|---|
| Pot balance + liability | Pot PDA lamports vs `Config.pot_liability_lamports` |
| Open round: inflow + dust carry vs `min_pot_threshold`, % to threshold, READY flag | Epoch + Config (no countdown — rounds have no clock) |
| Last closed round: how long it took, credited, per-tier payout | previous Epoch |
| Activated cohort: desks by tier, Σw | DeskTier accounts (index/scan) |
| Treasury: desks owned / consigned, exit history, burns executed, HUB float vs ≤2% cap | TreasuryState, BurnState, published treasury wallet |
| $HUB burned, **burn % of circulating**, circulating / locked supply (§A7 definitions) | Mint account (`supply`), treasury + vault ATAs, BurnState (ledger cross-check) |
| Raw desk-pot take D (trailing 7d and latest day) | OtcSnapshot per_desk history (already ingested) |

### C4. Yield comparison table (the core view)

For each tier T1–T4, recomputed live from the open round + config:

```text
round_size     = max(min_pot_threshold, effective_inflow_live)
proj_round_i   = (w_i / Σw_live) × 0.90 × round_size
rounds_per_day = 86400 / (last_round.finalized_ts − last_round.start_ts)   # null before first close
proj_daily_i   = proj_round_i × rounds_per_day
breakeven      = STEP_FEE_LAMPORTS / proj_round_i   # flat SOL fee ÷ payout — same fee at every tier
vs_raw         = proj_daily_i / D_live              # multiplier vs raw desk take
```

Displayed per tier: flat SOL fee + cumulative $HUB burn (§A4), live weight,
projected SOL/day (with USD), breakeven in days, and the **vs-raw multiplier**
— the single number the whole product reduces to. Column beside it: the raw
desk earning (D) so the comparison is unmissable. Breakeven counts only the
SOL fee (the $HUB burn has no SOL-denominated price on-chain to net against
it). All projections labeled `ESTIMATE — scales with Σw; not a promise`.

### C5. Scenario toggle

Since Σw grows after you activate, a 3-way toggle (conservative / current / bull,
from §A8) re-projects the table under different cohort sizes — showing honestly
that yield compresses as adoption grows, while still beating raw desk take.

### C6. Treasury transparency panel

Sweep/consignment/exit ledger (every tx linked), burn history (HUB burned to
date, last burn tx), LP depth + harvested fees (source F), and the treasury HUB
float balance against its ≤2% cap — all read from on-chain accounts, no
hand-maintained numbers. Collapsible evidence sub-sections per the dashboard's
existing DOS-aesthetic conventions.

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
| OTC_PREMIUM | 2.00× (20_000 bp) — $OTC price = flat STEP_FEE value × premium (§A4.1); 100% → POL reserve |
| OTC_RATE_MAX_AGE | 24h — $OTC path rejects an `otc_per_sol` older than this |
| MIN_POT_THRESHOLD | 0.1 SOL per round (no clock; `update_config`-adjustable) |
| ACC_SCALE | 10¹² (accumulator precision) |
| BURN_PCT_BP | 5% of every round's distributable inflow → buy $HUB, burn (§A5) |
| LP_PCT_BP | 5% of every round's distributable inflow → `TreasuryState.lp_pending_lamports`, phase-2 $HUB/$OTC LP (§A5) |
| OTC yield leg | remaining 90% — desks claim it in $OTC from `OtcPotState.otc_vault` at the pot's lifetime average buy rate (§A5) |
| REWARD_STOCK ($HUB launch) | OTC |
| LAUNCHER_SHARE | 0% |
| TREASURY_HUB_FLOAT_CAP | ≤2% of supply (announced launch buy, tranched; never sold — source C claims + LP pairing only) |
| EXIT_DISCOUNT / HUB leg / SOL leg | 10% off live floor / 50% burned / 50% → pot |
| SWEEP_BUDGET_CAP | 10% of treasury SOL per desk |
| SWEEP_PAYBACK_CAP | ≤60 desk-days at D=0.07 (≈4.2 SOL/desk) |
| UNCLAIMED_YIELD_WARN | 0.02 SOL (claim-before-list UI flag) |
| FLOOR_STALENESS_GUARD | 5% |
| CONSIGNMENT_ENABLED | true (config-gated) |
| CONSIGNOR_SHARE | 0% of consigned desk yield (parameterized; see A9.5) |
| UPGRADE_TIMELOCK | 48h, multisig-held upgrade authority (not immutable) |
| LP_TARGET_SOL_DEPTH ($HUB/SOL) | 100–200 SOL-side — conditional top-up ceiling only; curve graduation already seeds the pool |
| HUB_OTC_LP_SEED | 25–50 SOL-eq per side, phase-2 gated (SOL pool at target + ≥14d stable) |
| LP_CUSTODY | LP tokens in treasury PDA vault · HODL both legs · fees → pot (source F) |
| RPC_DEVNET | Helius devnet RPC (`devnet.helius-rpc.com`, same API key); OTC-side accounts mocked by the test harness |
| MPL_CORE_PROGRAM_ID | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` (`sdk/src/constants.ts`) |
| HUB_PROGRAM_ID | `5tCDEazUAkRjrkasup1uWcYo3t1C2ht76LmQva5rewQv` (devnet; mainnet TBD) |
| `f` (creator fee rate) | TBD at launch (checklist item 3) |

## Appendix — Deployment addresses (verified on-chain 2026-09-07)

Source of truth for ids: `Anchor.toml`, `sdk/src/constants.ts`,
`web/.env.production.local`, `web/src/hub/lib/deployments.ts`. The previous
devnet program `DPEioLagahMiVy4xfSzeKLWjWho8GZhbvK85BgTkY8qW` was **closed** on
2026-09-07 (Config layout change for the threshold-round model; PDAs cannot be
re-initialized under the same id) — do not reference it anywhere.

| Item | Cluster | Address | Status |
|---|---|---|---|
| Hub program | devnet | `5tCDEazUAkRjrkasup1uWcYo3t1C2ht76LmQva5rewQv` | live (upgradeable; authority `FRsH…wJZz`, deploy slot 494579757; on-chain hash matches the pinned Docker build) |
| Hub IDL / program metadata | devnet | `CnSKvxwKb3eNS6oF6GaAyAn8m3B8axXSCQYeBYrjdQfS` | live (Anchor 1.x metadata program `ProgM6JC…nk7S`) |
| Hub program | mainnet-beta | — | pending (after M3.5 devnet suite + verified build) |
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
| `Vault` | `["vault"]` | `3kokfoqWuPhfHEbrPiPaQa6ADtmTtcavh8BdGv1M2NgQ` | derived only (no account until first consignment) |
| `Epoch[0]` | `["epoch", 0u64]` | `3mSdteiDJxagm38mxmDc2e2q4KCwV61k9CMKMXU8cSwv` | initialized (106 B) |

**Devnet `Config` values (M1 + `devnet-config-reuse.ts`):** authority = ops_wallet
= treasury = deployer `FRsHGMKByp1EdckJVFU87i9FCf73NcbfMXcTZC71wJZz`;
`hub_mint` `HWBPrRKgVRetz6Sa7p2aHLwDgapKpzkeZkyhKd9nDwaj` (SPL, 1B × 10⁶);
`desk_collection` `25Qj1haczTkNNhmVdMdZmegn6kSj9WTwkhckgMUTQeMU` (mock Core
collection); `otc_program`, `otc_desk_pot`, `otc_mint` = harness placeholders
(replaced on mainnet by the §A2 resolution script); step fee 0.5 SOL,
`min_pot_threshold_lamports` 0.1 SOL, burn 1000 bp, ops 1000 bp, consignment
enabled, consignor share 0 bp, LP disabled (target 100 SOL), not paused. Current
state at verification: round 3 open, Σw 38,500 bp (three activated tiers).

*Community tooling. Not affiliated with the OTC protocol. Verify everything
on-chain. DYOR.*