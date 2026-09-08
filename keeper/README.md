# Keeper services (§B4)

Five off-chain TypeScript services. Each is **permissioned** at launch, supports `--dry-run`,
and is resume-safe via an append-only journal (`keeper/<name>/journal/`, git-ignored).

| Service                     | Dir            | Cadence             | On-chain call                                                                                                                                                                               |
| --------------------------- | -------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epoch keeper + buyback-burn | `keeper/`      | every `EPOCH_HOURS` | `finalize_epoch`, then Jupiter route → SPL burn → `record_burn`                                                                                                                             |
| Treasury sweeper            | `sweeper/`     | continuous          | ME listings + on-chain vault read; buys ≤ `SWEEP_BUDGET_CAP` / `SWEEP_PAYBACK_CAP`; `register_treasury_inflow`                                                                              |
| Treasury exit               | `treasury/`    | on demand           | 90% floor exit; HUB leg 50% burned, SOL leg 50% → pot; 5% `FLOOR_STALENESS_GUARD`                                                                                                           |
| LP manager                  | `lp/`          | hourly              | depth monitor, fee harvest → source F; `build_lp` when `lp_enabled`                                                                                                                         |
| Creator-fee flywheel        | `creator-fee/` | on demand           | `record_creator_fee` → `clear_creator_fees` (80/5/5/5/5, §A6.3) → per-leg `draw_creator_fee_leg` + Jupiter swap + `record_creator_fee_burn_result`/`_stack`/`_ops` or `build_lp_otc_locked` |

Implementation lands in **M4**. Until then these directories hold only the service entrypoint
stubs so CI wiring and env contracts are fixed early — except `creator-fee/` and `shared/`,
whose **pure decision logic is implemented and unit-tested now** (no RPC/signing yet, same
"pure logic first" split as `sweeper/src/arbitrage.ts`):

- `creator-fee/src/clear_cycle.ts` — clear-threshold gate + per-leg draw plans, including
  the LP leg's 50/50 OTC→HUB-swap / raw-OTC-deposit split.
- `shared/src/gas.ts` — the SOL gas-float watermarks below, reusable by any keeper.

Run `npm run test:keeper` to execute all keeper unit tests.

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
`HUB_CLUSTER=devnet|mainnet-beta`, `DRY_RUN=1`.
