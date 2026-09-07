# Keeper services (§B4)

Four off-chain TypeScript services. Each is **permissioned** at launch, supports `--dry-run`,
and is resume-safe via an append-only journal (`keeper/<name>/journal/`, git-ignored).

| Service                     | Dir         | Cadence             | On-chain call                                                                                                  |
| --------------------------- | ----------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Epoch keeper + buyback-burn | `keeper/`   | every `EPOCH_HOURS` | `finalize_epoch`, then Jupiter route → SPL burn → `record_burn`                                                |
| Treasury sweeper            | `sweeper/`  | continuous          | ME listings + on-chain vault read; buys ≤ `SWEEP_BUDGET_CAP` / `SWEEP_PAYBACK_CAP`; `register_treasury_inflow` |
| Treasury exit               | `treasury/` | on demand           | 90% floor exit; HUB leg 50% burned, SOL leg 50% → pot; 5% `FLOOR_STALENESS_GUARD`                              |
| LP manager                  | `lp/`       | hourly              | depth monitor, fee harvest → source F; `build_lp` when `lp_enabled`                                            |

Implementation lands in **M4**. Until then these directories hold only the service entrypoint
stubs so CI wiring and env contracts are fixed early.

Env contract (all services): `HUB_RPC_URL`, `HUB_PROGRAM_ID`, `HUB_KEEPER_KEYPAIR`,
`HUB_CLUSTER=devnet|mainnet-beta`, `DRY_RUN=1`.
