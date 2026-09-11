# Keeper services (§B4)

Five off-chain TypeScript services. Each is **permissioned** at launch, supports `--dry-run`,
and is resume-safe via an append-only journal (`keeper/<name>/journal/`, git-ignored).

| Service                     | Dir            | Cadence             | On-chain call                                                                                                                                                                               |
| --------------------------- | -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epoch keeper + buyback-burn | `keeper/`      | every `EPOCH_HOURS` | `finalize_epoch` (assembles the Jupiter route; the SOL→$HUB swap and burn happen synchronously on-chain inside the same instruction)                                                        |
| Treasury sweeper            | `sweeper/`     | continuous          | ME listings + on-chain vault read; buys ≤ `SWEEP_BUDGET_CAP` / `SWEEP_PAYBACK_CAP`; `register_treasury_inflow`                                                                              |
| Treasury exit               | `treasury/`    | on demand           | 90% floor exit; HUB leg 50% burned, SOL leg 50% → pot; 5% `FLOOR_STALENESS_GUARD`                                                                                                           |
| LP manager                  | `lp/`          | hourly              | depth monitor, fee harvest → source F; `build_lp` when `lp_enabled`                                                                                                                         |
| Creator-fee flywheel        | `creator-fee/` | on demand           | `record_creator_fee` → `clear_creator_fees` (80/5/5/5/5, §A6.3) → per-leg `draw_creator_fee_leg` + Jupiter swap + `record_creator_fee_burn_result`/`_stack`/`_ops` or `build_lp_otc_locked` |

Implementation lands in **M4**. Until then these directories hold only the service entrypoint
stubs so CI wiring and env contracts are fixed early — except `creator-fee/`, `sweeper/`, and
`shared/`, whose **pure decision logic is implemented and unit-tested now** (no RPC/signing yet,
same "pure logic first" split):

- `creator-fee/src/clear_cycle.ts` — clear-threshold gate + per-leg draw plans, including
  the LP leg's 50/50 OTC→HUB-swap / raw-OTC-deposit split.
- `sweeper/src/arbitrage.ts` — sweep-vs-mint-vs-hold decision, gated by
  `DESK_ACQUISITION_TARGET` below.
- `shared/src/gas.ts` — the SOL gas-float watermarks below, reusable by any keeper.
- `shared/src/gate.ts` — the auto-operate gate below, reusable by any keeper.

Run `npm run test:keeper` to execute all keeper unit tests.

## Auto-operate gate (`shared/src/gate.ts`)

Every keeper cycle must pass **both** gates below before it does any on-chain work, checked
fresh each run (never cached):

1. **Gas float** (`checkGasFloat`, below) — the keeper's own hot wallet has enough SOL.
2. **Operational gate** (`checkOperationalGate`) — `Config.paused == false` **and** the
   $HUB mint authority has been revoked ("mint sealed", resolved off-chain via
   `getMint(hubMint).mintAuthority === null` and passed in as `hubMintSealed`). This is the
   concrete switch behind "let keepers run automatically once the protocol has started and
   the $HUB mint is sealed" — before mint-seal, autonomous keeper spend against a still-mintable
   supply is refused; after `set_paused(true)`, the very next cycle refuses too.

**Passing the gate is necessary but not sufficient.** `register_treasury_inflow`,
`record_creator_fee`, `build_lp`, and `build_lp_otc_locked` all require the transaction
signer to literally be `Config.treasury` (`has_one = treasury`). On devnet this key-custody
decision is resolved: `Config.treasury` has been reassigned (`scripts/devnet-set-treasury.ts`)
to a dedicated hot wallet, separate from `Config.authority` and from every keeper's own
`HUB_KEEPER_KEYPAIR` gas wallet, and is passed to `creator-fee`/`lp`/`sweeper` via
`TREASURY_KEYPAIR` (`keeper/ecosystem.config.js`, loaded into `KeeperEnv.treasury` by
`keeper/shared/src/env.ts`). What's still missing is the instruction-assembly/submission code
itself for each write path — not implemented yet, so these three services remain read-only
heartbeats regardless. Mainnet has not been touched; the equivalent mainnet script and hot
wallet are a separate, explicit decision.

## Marketplace gate (`shared/src/marketplace.ts`)

The sweeper carries one more gate on top of the two above: `checkMarketplaceGate`, driven by
`SWEEPER_ENABLED` (default off, independent of `DRY_RUN`/`Config.paused`), `MARKETPLACE_PROVIDER`
(`magiceden` | `opensea`), and that provider's API key. No Magic Eden or OpenSea client exists
in this repo yet, so `SWEEPER_ENABLED=0` in `keeper/ecosystem.config.js` and should stay `0`
through mainnet launch — flip it only once one integration is picked, implemented, and
verified on devnet.

## Desk acquisition target (`sweeper/src/arbitrage.ts`)

`DESK_ACQUISITION_TARGET = 20` — the sweeper stops sweeping/minting once
`TreasuryState.desks_owned` reaches this count, regardless of spread economics
(`decideAcquisition` returns `hold` first, before even pricing the sweep-vs-mint choice).
Keeper-side only, no on-chain enforcement (`TreasuryState.desks_owned` has no update
mechanism on-chain yet either — it is set to 0 at `initialize_config` and never
incremented by any instruction today, so this cap only binds once desk-count tracking is
wired to a real inflow source). Deliberately conservative for the first operating window;
raise it by passing a higher `deskTarget` once comfortable with observed sweep behavior —
"until update config" in the sense of a keeper-side parameter change, not a program field.

**Keeper SOL gas float** — separate from any SOL a keeper transiently passes through
mid-cycle (e.g. `record_creator_fee_ops`'s post-swap SOL, which lands in
`Config.ops_wallet` in the same instruction it's booked, never idling in the keeper's
balance). No program-level funding instruction exists; refilling is a manual multisig
transfer from `ops_wallet` (which already accumulates the 5% ops-SOL creator-fee leg):

| Watermark                        | Value    | Purpose                                                          |
| -------------------------------- | -------- | ---------------------------------------------------------------- |
| `KEEPER_HARD_MIN_LAMPORTS`       | 0.02 SOL | Below this, refuse to start a cycle — avoids dying mid-sequence. |
| `KEEPER_DRIP_TRIGGER_LAMPORTS`   | 0.05 SOL | Pre-flight check; below this, request a top-up before starting.  |
| `KEEPER_TARGET_CEILING_LAMPORTS` | 0.3 SOL  | A drip refills to here — ~6–10 unattended cycles' worth.         |

Env contract (all services): `HUB_RPC_URL`, `HUB_PROGRAM_ID`, `HUB_KEEPER_KEYPAIR`,
`HUB_CLUSTER=devnet|mainnet-beta`, `DRY_RUN=1`. Optional: `TREASURY_KEYPAIR` (`creator-fee`/
`lp`/`sweeper` — the `Config.treasury` co-signer, see above); `SWEEPER_ENABLED`,
`MARKETPLACE_PROVIDER`, `MAGIC_EDEN_API_KEY`/`OPENSEA_API_KEY` (`sweeper` only, see the
marketplace gate above).
