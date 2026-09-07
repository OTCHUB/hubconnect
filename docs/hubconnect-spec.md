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

### A4. Tier system

Tiers bind to a desk NFT asset id, not to a wallet. Upgrade-only (pay the step
difference). **Burn-based, never lock-based** — the launcher's 70% leg pays
per-wallet pro-rata on HUB held, so locked HUB would miss it; burned tiers never
conflict.

| Tier | Weight | Cumulative cost | To pot (90%) | To ops (10%) |
|---|---|---|---|---|
| T1 BRONZE | 1.00x | 0.5 SOL | 0.45 | 0.05 |
| T2 SILVER | 1.25x | 1.0 SOL | 0.90 | 0.10 |
| T3 GOLD | 1.60x | 1.5 SOL | 1.35 | 0.15 |
| T4 DIAMOND | 2.00x | 2.0 SOL | 1.80 | 0.20 |

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

Per epoch (`EPOCH_HOURS = 24`; unclaimed rolls forward):

```text
epoch_yield_i = (w_i / Σ w_j) × 0.90 × pot_inflow_epoch
burn          =             0.10 × pot_inflow_epoch   [buy $HUB → burn]
```

Direct-to-holder stream (no tier needed, per wallet, pro-rata on HUB held):
`0.70 × f × V_HUB_volume` of OTC bought daily, where `f` = creator-fee rate
(verify at launch).

### A6. Treasury desk flywheel

**Acquisition rule — sweep, never dilute:**

```text
sweep_cost = list_price × (1 + 0.02 + 0.05)     # taker + royalty
mint_cost  = 100_000 × p_OTC_SOL + 0.5
SWEEP if sweep_cost < mint_cost                  # current: 6.86 < 14.98 ✓
MINT  only if sweep_cost ≥ mint_cost             # recommended: never (see A9)
```

- Only sweep desks with **verified non-empty vault stock** (on-chain ATA read).
- Sweep budget cap: ≤10% of treasury SOL per desk; payback cap ≤60 desk-days at
  D = 0.07 (max sweep cost ≈ 4.2 SOL/desk at that take) — pause sweeps above it.

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
- From the consignment epoch onward, the treasury claims that desk's desk-pot
  rounds exactly like its owned desks (same OTC claim instruction). Proceeds are
  pot inflow **(source E)** and are distributed to **connected (activated) desks**
  per the normal epoch formula.
- Optional contributor reward: `CONSIGNOR_SHARE` (default **0%** — all yield goes
  to the pool, per the community-first ethos) can later be raised via config to
  credit a share directly to the consignor's accrual. Consigned-desk claim
  proceeds are tracked separately so the split is always auditable.
- `unconsign_desk` returns the desk to the consignor after the current epoch
  finalizes (no epoch is double-counted); yield earned through the withdrawal
  epoch is credited as normal.
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
4. Treasury minting when spread inverts: **never** (default) — minting burns 100k
   OTC and dilutes per-desk rounds, cutting against the not-greedy principle.
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
├── docs/                      # this spec + verification evidence
└── scripts/                   # launch checklist automation, config resolution
```

Stack: Anchor 0.30.x, solana 1.18.x, @solana/web3.js, TypeScript, vitest or
anchor-ts tests, `solana-bankrun` for fast integration tests, **Helius devnet RPC
for the devnet test stage (§B5.1)**.

### B2. On-chain program — accounts

| Account | Seeds (all under program id) | Key fields |
|---|---|---|
| `Config` | `["config"]` | authority, pot PDA, ops wallet, tier weights[4], step_fee_lamports, epoch_hours, burn_pct_bp (1000), ops_pct_bp, consignment_enabled, consignor_share_bp, lp_enabled, lp_target_sol_lamports, paused |
| `Epoch` | `["epoch", epoch_index u64]` | index, start_ts, end_ts, inflow_lamports, distributed_lamports, burned_lamports, finalized |
| `DeskTier` | `["tier", asset_id]` | asset_id, tier 1–4, activated_epoch, last_claimed_epoch, voided |
| `ConsignedDesk` | `["consign", asset_id]` | asset_id, consignor, consigned_epoch, active |
| `StakerAccrual` | `["accrual", wallet, epoch_index]` | owed_lamports (rolled forward at finalize) |
| `Pot` (SOL escrow) | `["pot"]` | balance via system PDA lamports |
| `Burn` | `["burn"]` | total_hub_burned, last_burn_tx, authority |
| `TreasuryState` | `["treasury"]` | multisig set, desks owned count, sweep budget caps, exit params (discount 900 bp, hub leg 5000 bp) |

All amounts in lamports; all rates in basis points. Every OTC-side address
(pot target verification, royalty rates, rotation list) is a **Config field
resolvable by authority**, never compiled in — with a resolution script that reads
the OTC program config on-chain and proposes updates.

### B3. On-chain program — instructions

| # | Instruction | Accounts | Constraints |
|---|---|---|---|
| 1 | `initialize_config` | payer, Config | once; sets constants from §A4/A5 |
| 2 | `activate_tier` | payer, desk NFT (Metaplex Core asset), Config, Pot, ops wallet, DeskTier | verify payer owns desk asset via Core plugin/DAS **inside the instruction**; tier = current+1 (or 1); pay 0.5 SOL: 90% → Pot, 10% → ops; mark 10% of inflow as burn-pending |
| 3 | `upgrade_tier` | payer, desk NFT, Config, Pot, ops, DeskTier | pay step difference; same ownership check |
| 4 | `finalize_epoch` | keeper, Config, Epoch, treasury SOL source | epoch boundary; compute per-weight distribution; 10% of epoch inflow → burn-pending; roll unclaimed into next epoch accruals |
| 5 | `claim_yield` | claimer, desk NFT, DeskTier, StakerAccrual, Pot | **lazy revocation**: re-verify desk ownership on-chain NOW; if caller ≠ owner → void tier (voided = true, no refund) and revert; pay owed_lamports |
| 6 | `register_treasury_inflow` | treasury multisig, Config, Pot | record source B/C/D/E inflows from treasury ops; same 10% burn-pending marking; for consigned-desk (E) proceeds, credit `consignor_share_bp` directly to the consignor's StakerAccrual, remainder → pot |
| 7 | `record_burn` | keeper, Config, Burn, Pot | after the keeper buys HUB and burns it: mark burn executed, decrement burn-pending |
| 8 | `void_tier` (internal path in 3/5) | — | ownership change discovered at claim/upgrade voids the tier |
| 9 | `update_config` | authority (multisig), Config | only whitelisted fields; rate changes apply to future epochs |
| 10 | `pause` / `unpause` | authority | halts activate/claim on anomaly |
| 11 | `consign_desk` | owner, desk NFT, treasury vault, ConsignedDesk, Config | verify owner holds the desk asset (Core/DAS); `consignment_enabled` must be true; transfer NFT to vault; record consignor + epoch |
| 12 | `unconsign_desk` | consignor, desk NFT, treasury vault, ConsignedDesk, Config | only after the current epoch finalizes (no double-count); return NFT; set `active = false`; accrued consignor share (if any) stays claimable |
| 13 | `build_lp` | treasury multisig, Config, treasury LP vault, AMM pool accounts | `lp_enabled` must be true; deposit paired liquidity per §A6.2 (HUB/SOL first, HUB/OTC only after phase-2 gate); LP tokens custodied in the treasury PDA vault; withdraw path can never sell HUB |

Program-level invariants to assert everywhere: `inflow_lamports ==
distributed + burn_pending + rolled_forward`; pot lamports ≥ liability; DeskTier
weight lookup only for `voided == false`.

**Desk-pot desk-yield claim** (sources B + E): the treasury claims OTC desk-pot
rounds for its owned **and consigned** desks using the OTC protocol's own claim
instruction — hubconnect does not wrap it; the keeper just performs it with
treasury keys and then `register_treasury_inflow` (consigned proceeds apply the
consignor share split). Consigned desks are claimed but never sold (§A6.1).

### B4. Keeper services (off-chain, TypeScript)

1. **Keeper (buyback-burn)** — per epoch finalize: (a) call `finalize_epoch`;
   (b) route burn-pending SOL through a public AMM (Jupiter) with slippage caps
   to buy HUB; (c) burn HUB (send to a published burn address); (d) call
   `record_burn`. Publishes every tx. Idempotent: resume-safe journal, no
   double-burn.
2. **Sweeper** — watches Magic Eden listings + reads each listed desk's vault
   stock on-chain (non-empty required); applies §A6 formula (resolve OTC-side
   constants from config first); proposes sweeps within budget/payback caps;
   executes via treasury multisig; claims desk-pot rounds for owned and
   consigned desks and registers inflow.
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
- Tier math: step differences, weight lookups, void semantics.
- Epoch math: pro-rata distribution, 90/10 split, roll-forward, no rounding
  loss (last claimer gets remainder).
- Config guardrails: bp bounds, whitelisted update fields.

**Integration (bankrun + devnet):**
- Happy path: initialize → activate 4 desks across tiers → finalize → claim →
  verify exact lamports per weight and the 10% burn-pending.
- **Lazy revocation**: transfer the desk NFT mid-epoch → old owner's claim
  reverts and voids the tier; new owner cannot claim without re-activating; no
  refund emitted.
- Upgrade path T1→T4 pays exactly the difference; double-upgrade rejected.
- Rollover: unclaimed epoch-1 yield is claimable in epoch 3 after finalize.
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

- **Environment split**: `RPC_DEVNET` / `RPC_MAINNET` config; identical code,
  only the endpoint + program id + Config values differ. Never branch logic on
  cluster beyond that.
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

1. **M1 — scaffold**: repo layout, program with Config + all instructions as
   stubs, bankrun harness, CI (fmt, clippy, test).
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
TreasuryState, Burn) via the same RPC connection. hubconnect exposes only
read-only account decoders in its SDK (`sdk`); no privileged endpoints exist.

### C3. Live metrics strip (top of panel)

| Metric | Source |
|---|---|
| Pot balance + liability (unclaimed accruals) | Pot PDA lamports vs Σ StakerAccrual |
| Current epoch: inflow-so-far, time remaining | Epoch account |
| Activated cohort: desks by tier, Σw | DeskTier accounts (index/scan) |
| Treasury: desks owned / consigned, exit history, burns executed, HUB float vs ≤2% cap | TreasuryState, Burn, published treasury wallet |
| Raw desk-pot take D (trailing 7d and latest day) | OtcSnapshot per_desk history (already ingested) |

### C4. Yield comparison table (the core view)

For each tier T1–T4, recomputed live from current epoch data:

```text
proj_daily_i   = (w_i / Σw_live) × 0.90 × pot_inflow_per_day_live
breakeven_days = cumulative_cost_i / proj_daily_i
vs_raw         = proj_daily_i / D_live              # multiplier vs raw desk take
```

Displayed per tier: cumulative cost, live weight, projected SOL/day (with USD),
breakeven in days, and the **vs-raw multiplier** — the single number the whole
product reduces to. Column beside it: the raw desk earning (D) so the comparison
is unmissable. All projections labeled `ESTIMATE — scales with Σw; not a promise`.

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
| STEP_FEE | 0.5 SOL (90% pot / 10% ops) |
| EPOCH_HOURS | 24 |
| BUYBACK_BURN_PCT | 10% of every pot inflow |
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
| `f` (creator fee rate) | TBD at launch (checklist item 3) |

*Community tooling. Not affiliated with the OTC protocol. Verify everything
on-chain. DYOR.*