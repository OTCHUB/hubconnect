# Tokenomics

Supply, allocation, and every deflationary sink. Tier/round mechanics that drive the
burns below: [`mechanics.md`](mechanics.md). Full protocol reference:
[`hubconnect-spec.md`](hubconnect-spec.md).

**0% team/dev allocation.** Every constant here is a live on-chain field
(`Config`, `TreasuryState`, `TokenomicsConfig`), never hardcoded client-side.

## Supply

`MAX_SUPPLY = 1,000,000,000 $HUB` (6 decimals), minted once at launch, mint
authority revoked immediately after (`scripts/hub-authority.ts revoke-mint`). No
emissions — supply only ever moves down.

## Launch allocation

| Slice | Share | Notes |
|---|---|---|
| Yield reserve | 2.00% | Treasury-multisig-held, never sold — backs the OTC-launcher reward basket that funds desk-holder yield |
| LP reserve | 0.50% | Treasury-multisig-held, never sold — seeds/deepens $HUB's own liquidity |
| Desk airdrop | ≤2.50% | 10,000 $HUB per desk activated on otcdesks.cash before the snapshot, capped at the first 2,500 activated desks (`AIRDROP_DESK_CAP`); Merkle claim to the desk's current owner; scales down with fewer desks |
| Public / bonding curve | ≥95.00% | Everything not carved out above, bought up the launcher's bonding curve |

Yield + LP reserve are one on-chain `treasury_lock_bp` (2.5% combined); at the full
2,500-desk airdrop cap the carve-outs total 5% and public settles at exactly 95%.

Separately, the treasury's **launch buy** into its own $HUB position (funded from
the bonding curve at launch, to hold $HUB and earn the launcher's holder-pro-rata
$OTC reward) is announced and tranched, capped at ≤2% of supply — a share-of-supply
cap, never a fixed SOL amount, so it never reads as a dev wallet. This float is
never sold, used only to claim its pro-rata $OTC and to pair LP.

## Deflationary sinks

No emissions, no minted staking rewards — supply is monotonic down after launch:

1. **Tier activation/upgrade burn** — every `activate_tier` / `upgrade_tier` (or its
   $OTC-paid equivalent) burns the tier's $HUB cost (100k–200k cumulative, see
   [`mechanics.md`](mechanics.md)).
2. **Round buyback burn (5%)** — every finalized round swaps 5% of its inflow
   SOL→$HUB and burns it, synchronously, inside `finalize_epoch`.
3. **Discount-exit burn** — every treasury desk exit burns 50% of the sale
   consideration in $HUB.
4. **Creator-fee flywheel burn (5%)** — the treasury's pro-rata claim on the OTC
   launcher's holder-leg $OTC is re-split 80/5/5/5/5; one of the 5% legs buys back
   and burns $HUB.

`BurnState.total_hub_burned` is the on-chain ledger; it must equal
`MAX_SUPPLY − Mint.supply` (dashboards flag "drift" if it doesn't).

## The 4-way epoch split

Every finalized round splits its inflow:

```text
90%  → desk-staker $OTC yield, pro-rata by tier weight
 5%  → $HUB buyback, burned
2.5% → $HUB earmarked for the $HUB/$OTC LP (phase 2)
2.5% → $HUB deposited into the treasury's buy-and-hold float
```

The 10% non-yield leg is swapped SOL→$HUB in one synchronous on-chain Jupiter CPI —
see [`mechanics.md`](mechanics.md) for the full mechanic.

## Treasury float cap

The treasury-float leg above accumulates in a dedicated buy-and-hold $HUB account,
capped at `TreasuryState.hub_float_cap_bp` of supply (currently 5%, admin-updatable
via `set_treasury_float_cap_bp` — an explicitly experimental parameter the treasury
multisig may retune while iterating). A deposit that would push the running total
past the live cap burns the excess instead of leaving it un-swapped or rejecting the
round — the cap can never stall a finalize.

This is separate from the launch-buy cap above (§ Launch allocation): the launch buy
is a one-time, manually-tranched purchase off the bonding curve; the float cap here
gates the ongoing, automatic accumulation from every round's split.

## Liquidity

**Phase 1 ($HUB/SOL)** is free — the OTC launcher's bonding-curve graduation seeds
the pool automatically; the treasury hand-seeds nothing and the pool has no
withdrawable LP authority for anyone.

**Phase 2 ($HUB/OTC)** opens only after $HUB price is stable ≥24h post-launch
(`lp_phase2_open_ts`, admin-set): the treasury deposits into a Raydium CP-Swap
HUB/OTC pool and, in the same transaction, calls `lock_cp_liquidity` — **burning the
LP mint outright** (principal never withdrawable by anyone) while retaining a
permanent right to claim the pool's trading fees. Harvested fees from both phases
flow back into the pot as round inflow.

## Program IDs & mints

| Item | Address |
|---|---|
| Hub program | `7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i` |
| $OTC mint | `MukLDtJ8Cx9DxLbeyLRSWPSposTMWuwHANbuaudpump` |
| Jupiter aggregator v6 | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` |

$HUB mint, ops wallet, desk collection and every other OTC-side address are never
hardcoded in the frontend — every consumer reads them live off the on-chain
`Config` singleton. See [Program IDs](../README.md#program-ids) in the README for
the full devnet/mainnet table.
