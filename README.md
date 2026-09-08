<div align="center">

# 🟢 hubconnect — the $HUB protocol

**Stake-to-earn yield layer built on top of the OTCDesks Protocol.**
Anchor program · keeper services · read-only SDK · treasury dashboard.

[![ci](https://github.com/OTCHUB/hubconnect/actions/workflows/ci.yml/badge.svg)](https://github.com/OTCHUB/hubconnect/actions/workflows/ci.yml)
[![verified build](https://github.com/OTCHUB/hubconnect/actions/workflows/verify.yml/badge.svg)](https://github.com/OTCHUB/hubconnect/actions/workflows/verify.yml)
[![program](https://img.shields.io/badge/program-7c5oPs9G…XJx7b7i-14f195?logo=solana&logoColor=white)](https://explorer.solana.com/address/7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i/verified-build)
[![website](https://img.shields.io/badge/website-otchub.dev-14f195)](https://otchub.dev)
[![app](https://img.shields.io/badge/app-app.otchub.dev-14f195)](https://app.otchub.dev)
[![x](https://img.shields.io/badge/-@otchubdev-000000?logo=x&logoColor=white)](https://x.com/otchubdev)

**Community tooling — not affiliated with the OTC Desks / OTCDesks Protocol team.**

</div>

Single source of truth: [`docs/hubconnect-spec.md`](docs/hubconnect-spec.md) (v1.2).
Implement from it; never re-derive tokenomics. Section refs below (`§A…`, `§B…`) point there.

## Links

| | |
|---|---|
| 🌐 Website | [otchub.dev](https://otchub.dev) |
| 📊 $HUB app (treasury dashboard) | [app.otchub.dev](https://app.otchub.dev) |
| 🐦 X / Twitter | [@otchubdev](https://x.com/otchubdev) |
| 📈 DexScreener | pending — published here once the $HUB mint and its first liquidity pool exist (see [Program IDs](#program-ids)) |
| 📖 Full spec | [`docs/hubconnect-spec.md`](docs/hubconnect-spec.md) |

## What is $HUB?

**OTCDesks Protocol** (otcdesks.cash) runs OTC desk NFTs and an OTC launcher: any token launched
through it (including $HUB) pays creator fees that buy **$OTC** for the launched token's holders.
**hubconnect is a separate, community-built layer on top of that base protocol** — it does not
fork or modify OTCDesks, it only reads its on-chain state and composes with it. $HUB launches
*through* the OTC launcher and uses the $OTC it earns to fund yield for desk owners, on top of two
protocol-native mechanisms of its own:

1. **Desk tier activation** (`§A4`) — an OTC desk NFT owner activates a tier on-chain (burn-based,
   never lock-based) and earns pro-rata $OTC yield from five pot-inflow sources: activation fees,
   treasury desk-sweep proceeds, the treasury's launcher holder-leg claim, discount-exit proceeds,
   and LP swap fees (`§A5`).
2. **Treasury desk flywheel** (`§A6`) — the treasury sweeps listed desks when cheaper than minting
   (zero dilution to the desk pot), harvests their yield for stakers, and can resell them to the
   community at a floor discount.

Design principles, in priority order (`§A1`): not greedy (nothing taken from other OTC
participants, only added buy pressure and pot funding); better yield for desk owners;
deflationary by construction; evidence-first (every constant parameterized and re-verified
on-chain). **0% team/dev token allocation.**

## Tokenomics (§A3, §A6.2, §A7)

**Launch supply allocation** (`MAX_SUPPLY = 1,000,000,000 $HUB`, minted once, mint authority
revoked post-launch):

| Slice | Share | Notes |
|---|---|---|
| Yield reserve | 2.00% | Treasury-multisig-held, never sold — backs the OTC-launcher reward basket that funds desk-holder yield (the launcher's 70% holders-in-stock leg pays $OTC pro-rata on $HUB held, `§A6.3`) |
| LP reserve | 0.50% | Treasury-multisig-held, never sold — seeds/deepens $HUB's own liquidity |
| Desk airdrop | ≤2.50% | 10,000 $HUB per desk activated on otcdesks.cash before the snapshot, capped at the first 2,500 activated desks (`AIRDROP_DESK_CAP`); Merkle claim to the desk's current owner; scales down with fewer desks |
| Public / bonding curve | ≥95.00% | Everything not carved out above, bought up the launcher's bonding curve |

Yield + LP reserve are one on-chain `treasury_lock_bp` (2.5% combined); at the full 2,500-desk
airdrop cap the carve-outs total 5% and public settles at exactly 95%. The treasury's launch buy
into its own $HUB float is capped at **≤2% of supply**, announced and tranched (`§A3.1`) — a
share-of-supply cap, never a fixed SOL amount, to avoid reading as a dev wallet; the float is
never sold, used only to claim its pro-rata $OTC and to pair LP.

**Liquidity (`§A6.2`):** bootstrap LP is free — the OTC launcher's bonding-curve graduation seeds
the $HUB/SOL pool automatically; the treasury hand-seeds nothing and that pool has no withdrawable
LP authority for anyone. **Phase 2 ($HUB/OTC)** opens only after $HUB price is stable ≥24h
post-launch (`lp_phase2_open_ts`, admin-set): the treasury deposits into a Raydium CP-Swap
HUB/OTC pool and, in the same transaction, calls `lock_cp_liquidity` — **burning the LP mint
outright** (principal never withdrawable by anyone) while retaining a permanent right to claim the
pool's trading fees. Both phases' harvested fees flow back into the pot (source F).

**Deflationary sinks (`§A7`):** no emissions, no minted staking rewards — supply is monotonic down
after launch. 5% of every round's inflow buys $HUB on the market and burns it; every treasury desk
exit burns 50% of the sale consideration in $HUB; the creator-fee flywheel (below) burns another 5%
of its own inflow. `BurnState.total_hub_burned` is the on-chain ledger; it must equal
`MAX_SUPPLY − Mint.supply` (dashboards flag "drift" if it doesn't).

## Activation & upgrade mechanic (§A4)

Tiers bind to a desk NFT **asset id**, not a wallet. `activate_tier` / `upgrade_tier` targets
`target_tier` (1..4) directly and pays two things every call:

| Tier | Weight | SOL fee (flat, per call) | $HUB burn (cumulative) |
|---|---|---|---|
| T1 TRADER | 1.00x | 0.5 SOL (90% pot / 10% ops) | 100,000 |
| T2 BROKER | 1.25x | 0.5 SOL | 125,000 |
| T3 DEALER | 1.60x | 0.5 SOL | 150,000 |
| T4 MARKET MAKER | 2.00x | 0.5 SOL | 200,000 |

1. **A flat SOL fee** — `STEP_FEE_LAMPORTS = 0.5 SOL`, paid once per call regardless of how many
   tiers it crosses. A fresh T4 activation costs the same 0.5 SOL as a fresh T1; a later upgrade to
   any higher tier pays 0.5 SOL again, once — never `(to − from) × fee`.
2. **A $HUB burn** — the cumulative tier-cost table above; a fresh activation burns the full target
   cost, an upgrade burns only the delta from the tier already held. `BurnChecked`, permanent,
   independent of the round-based buyback burn.

Ownership is **lazily re-verified on-chain** at every `claim_yield`/`upgrade_tier` call: if the
caller no longer owns the desk asset, the tier is voided (no refund) instead of paying out to a
stale owner. Either leg may alternatively be paid in $OTC (`activate_tier_otc`/`upgrade_tier_otc`,
`§A4.1`, 2× premium, proceeds go to the $OTC/$HUB LP reserve — never the pot).

## Revenue split (§A5, §A6.3)

Two independent, deterministic-bp splits, both threshold-gated (not clocked) and enforced
on-chain — a round or a creator-fee clearing fires the instant it clears its size threshold, not
on a timer:

**Round split — 90/5/5** (`finalize_epoch`, permissionless once `MIN_POT_THRESHOLD = 0.1 SOL` is
reached):

```text
5%  → buy $HUB on the market, burn                    (BurnState.burn_pending_lamports)
5%  → TreasuryState.lp_pending_lamports                (phase-2 $HUB/OTC LP build)
90% → desk-staker $OTC yield, pro-rata by tier weight   (Config.acc_per_weight accumulator)
```

**Creator-fee flywheel — 80/5/5/5/5** (`clear_creator_fees`, permissionless once
`clear_threshold_units` is reached) — a *second*, independent $OTC stream: the treasury's 2%
$HUB float earns its pro-rata share of the OTC launcher's own 70% holders-in-stock leg, arriving
already denominated in $OTC:

```text
80% → direct injection into the desk-yield vault, no swap  (raises the lifetime avg buy rate)
 5% → swap $OTC→$HUB, burn                                 (buyback-burn sink)
 5% → half swapped to $HUB, LOCKED into the $HUB/OTC pool   (§A6.2 phase 2)
 5% → swap $OTC→$HUB, held in the treasury float            (§A7.1 cap still applies)
 5% → swap $OTC→SOL, held in ops reserve                    (funds sweep/mint/LP operations)
```

Compile-time assertions in `programs/hub/src/constants.rs` guarantee both splits always sum to
exactly 10,000 bp.

## Program IDs

**$HUB-native (this repo):**

| Item | Devnet | Mainnet-beta |
|---|---|---|
| Hub program | [`7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i`](https://explorer.solana.com/address/7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i?cluster=devnet) — live | same id — **live**, deployed + OtterSec-verified (see [Security & Verification](#security--verification)); `initialize_config` pending the `$HUB` mint |
| $HUB mint | `HWBPrRKgVRetz6Sa7p2aHLwDgapKpzkeZkyhKd9nDwaj` — devnet mock, 1B × 10⁶ | **pending** — published here the moment `initialize_config` runs on mainnet |
| DexScreener | — | **pending** — link goes live once the $HUB mint and its first liquidity pool exist |

**External (OTCDesks Protocol + Solana infra — not deployed by this repo):**

| Item | Address | Status |
|---|---|---|
| Metaplex Core program | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` | devnet + mainnet |
| OTC Desk program | `AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW` | mainnet-only (mocked on devnet) |
| OTC Desks collection | `D7sLW9uKZG3G7bNbWfMHvKSgVhU9nXdv7huTfepF5Jrh` | mainnet-only |
| Raydium CP-Swap | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` | devnet + mainnet |
| Raydium `lock_cp_liquidity` | `LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE` | devnet + mainnet |

Full PDA table (`Config`, `Pot`, `BurnState`, `TreasuryState`, `Vault`, `Epoch[0]`) and current
devnet `Config` values: [Appendix — Deployment addresses](docs/hubconnect-spec.md#appendix--deployment-addresses-verified-on-chain-2026-09-07)
in the spec. `hub_mint`, `otc_mint`, `desk_collection`, `otc_desk_pot`, `ops_wallet` and
`authority` are never hardcoded in the frontend — every consumer reads them live off the on-chain
`Config` singleton (`§A3.2`). The devnet $HUB mint above is a **test-only mock** minted by
`scripts/devnet-hub-mint.ts` — it is not the real $HUB token and carries no value.

## Security

- **Disclosure**: report privately via [GitHub Security Advisories](https://github.com/OTCHUB/hubconnect/security/advisories/new) — see [`SECURITY.md`](SECURITY.md). Do not open a public issue for security bugs.
- **On-chain `security.txt`**: embedded in the deployed `.so` ([neodyme-labs/solana-security-txt](https://github.com/neodyme-labs/solana-security-txt)), so explorers and researchers can find the disclosure channel from the binary alone — `programs/hub/src/lib.rs`.
- **Audit status**: `auditors: "None"` (declared in the embedded security.txt). No third-party audit has been performed; treat the program as unaudited until this changes.
- **Arithmetic policy**: every accounting counter (`total_weight_bp`, `pot_liability_lamports`, `total_exits`, all `*_pending_*` balances) uses checked `add()`/`sub()` helpers that error on overflow/underflow — no `saturating_*` on state that must never silently clamp.
- **Split invariants**: the 90/5/5 round split and 80/5/5/5/5 creator-fee split are asserted to sum to exactly 10,000 bp at **compile time** (`programs/hub/src/constants.rs`), not just at runtime.
- **Emergency pause (`Config.paused`, authority-only)**: gates new value-creating actions (`activate_tier`, `upgrade_tier`, `claim_yield`) and every keeper reimbursement draw that pays protocol-custodied funds out to an externally-controlled wallet (`record_burn`, `record_otc_buy`, `draw_creator_fee_leg`) — the fastest stop available against a compromised keeper key, since those keepers' authorities aren't independently rotatable. Inbound deposits, internal PDA-signed bookkeeping (`clear_creator_fees`), and pure off-chain attestations stay open under pause so a keeper mid-recovery isn't stranded. Full instruction-level gating: [`§B3`](docs/hubconnect-spec.md#b3-on-chain-program--instructions).
- **Verified builds**: reproducible `.so`, SLSA provenance and independent verification steps — see [Verified builds](#verified-builds) below.

## Layout

```
programs/hub/        Anchor program — §B2 accounts, §B3 instructions
  src/constants.rs   Appendix defaults (written into Config at initialize_config)
  src/state/         Config, Epoch, DeskTier, BurnState, TreasuryState, OtcPayConfig
  src/instructions/  admin | tiers | otc_pay ($OTC step fees → POL reserve) | epochs | treasury
sdk/                 PDA derivation + constants mirror; account decoders (M3)
keeper/              §B4 services: keeper (epoch+burn), sweeper, treasury (exit), lp
tests/               anchor-ts suites; HUB_CLUSTER=devnet targets Helius devnet (§B5.1)
scripts/             devnet-deploy.sh · verify-build.sh · orquestra-idl.ts · devnet-hub-mint.ts · devnet-mock-desks.ts
assets/              hub.png (1024², $HUB logo) · hub-token.json (Metaplex fungible metadata)
docs/                spec, master prompt, evidence/ (mainnet read-only verification)
```

`Pot` is a data-less system-owned PDA (`["pot"]`); its lamport balance is the pot.
Liability is tracked on `Config.pot_liability_lamports` (staker yield via the `acc_per_weight`
accumulator) and `BurnState.burn_pending_lamports`.

Distribution is threshold-gated like the OTC desk pot: inflow fills the open round (`Epoch`);
`finalize_epoch` is allowed the moment the round reaches `min_pot_threshold_lamports` (0.1 SOL),
credits `⌊distributable × 10¹² / Σw⌋` to `Config.acc_per_weight`, and one `claim_yield` per desk
pays `⌊(acc − stamp) × w / 10¹²⌋` across every round closed since the desk's stamp.

## Toolchain

| Tool | Version | Notes |
|---|---|---|
| Anchor | 1.2.0 | `anchor-lang` 1.2.0 on the Solana 3.x crate split; TS client is `@anchor-lang/core` (renamed from `@coral-xyz/anchor` in 1.0). Spec says 0.30.x; the program API is unchanged apart from `CpiContext::new(program_id, ..)`. |
| Agave (solana-cli) | 4.2.2 | platform-tools v1.57 (rustc 1.95); installed via `avm solana install` / `agave-install init 4.2.2` |
| Host Rust | 1.98.1 | pinned in `rust-toolchain.toml`; Anchor 1.x MSRV is 1.89, so edition-2024 crates resolve without overrides |
| Node | ≥ 22 | ts-mocha, keepers (`@anchor-lang/core` requires ≥ 20.18) |

```sh
export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
npm install
anchor build            # hub.so + target/idl/hub.json + target/types/hub.ts
anchor test --skip-build --validator legacy
```

Anchor 1.x runs `anchor test` on surfpool by default; this suite uses `solana-test-validator`
(`--validator legacy` or `ANCHOR_TEST_VALIDATOR=legacy`) so the `[test.validator.clone]` entries
in `Anchor.toml` pull Metaplex Core from devnet. `Cargo.lock` regenerates with plain `cargo update`.

## Repositories, branches, clusters

Two GitHub homes, one codebase. Development and devnet staging happen in the `nodecattel`
account; only reviewed releases are pushed to the `OTCHUB` organisation, which is the public
source that explorers, `solana-verify`, CI provenance (OIDC `repository_owner=OTCHUB`) and
Orquestra point at for the mainnet program.

| Branch | Git remote | Repository | Cluster | Wallet |
|---|---|---|---|---|
| `develop` | `origin` | `nodecattel/hubconnect` (private, staging) | **devnet** | `~/.config/solana/hubconnect-devnet.json` |
| `main` | `production` | `OTCHUB/hubconnect` (public, releases) | **mainnet-beta** | upgrade authority (Squads vault) |

```sh
git remote -v                     # origin → nodecattel/hubconnect, production → OTCHUB/hubconnect
git remote add production https://github.com/OTCHUB/hubconnect.git   # once, on a fresh clone
```

`scripts/verify-build.sh` derives the source URL it records on chain and in Orquestra from the
cluster's remote (`HUB_REPO_URL` overrides) and refuses a **mainnet** `deploy`/`verify` unless
the checkout is on `main`, clean and already pushed to `production/main` (`HUB_FORCE=1` bypasses;
devnet only warns). Nothing is ever deployed from an unpushed commit, so every on-chain hash maps
to a commit anyone can rebuild.

**Devnet (from `develop`)**

```sh
git switch develop && git push origin develop
scripts/devnet-deploy.sh                    # build → verify-build.sh deploy (extend/upgrade, hash, Orquestra sync)
scripts/verify-build.sh verify              # verify PDA on devnet (no explorer badge — OtterSec is mainnet-only)
```

**Mainnet (from `main`)**

```sh
git switch main && git merge --ff-only develop         # or a reviewed PR develop → main
git push origin main                                    # keep the staging mirror in step
git push production main && git tag vX.Y.Z && git push production vX.Y.Z   # verify.yml runs in OTCHUB only
export HUB_CLUSTER=mainnet-beta HUB_WALLET=~/.config/solana/hub-mainnet-authority.json
scripts/verify-build.sh build && scripts/verify-build.sh deploy    # hash MATCH → Orquestra sync (public)
scripts/verify-build.sh verify                                     # verify PDA + OtterSec remote job → Explorer "Verified"
```

After every successful `deploy` or `verify` on either cluster the script runs
`npm run orquestra:idl` (when `ORQUESTRA_TOKEN` is set): the IDL, local/on-chain executable hash,
commit link, embedded security.txt and PDA seeds are published to the Orquestra project. The
devnet project may be kept unlisted with `ORQUESTRA_PRIVATE=1`; the mainnet sync is always public
so the indexed IDL can be checked against the verified hash by anyone.

`npm run orquestra:send -- --ix <name> [--accounts '{…}'] [--args '{…}'] [--send]` builds an
instruction through Orquestra's REST API (`POST /api/{projectId}/instructions/{name}/build`),
encodes the same call with the Anchor client and diffs data + account metas before simulating; the
key never leaves the machine. PDAs and fixed addresses are derived locally from the IDL because
the Orquestra builder does not derive them. Known upstream gap (2026-09): Orquestra omits the borsh
variant index for enum arguments, so `update_config`, `build_lp` and `register_treasury_inflow`
report `PARITY FAIL` and must be sent with the Anchor client; the other 19 instructions encode
byte-for-byte. The IDL sync publishes these caveats in the project notes.

## Devnet (§B5.1)

Dedicated deployer keypair `~/.config/solana/hubconnect-devnet.json` — never reused on mainnet.

```sh
cp .env.example .env          # add HELIUS_API_KEY
solana airdrop 2 $(solana-keygen pubkey ~/.config/solana/hubconnect-devnet.json) -u devnet
scripts/devnet-deploy.sh --init
```

All $HUB mechanics pass the devnet stage (mock OTC-side accounts) before any mainnet deploy.

The devnet Config starts with harness placeholders for every OTC-side key. Two operator scripts
replace them with functional stand-ins (payer = Config.authority):

```sh
npx ts-node -T scripts/devnet-hub-mint.ts        # SPL mint (1B × 10^6) → Config.hub_mint; ops_wallet → payer
npx ts-node -T scripts/devnet-mock-desks.ts      # Core collection mirroring mainnet "OTC Desks" (royalties
                                                 # 5% → pot) + desks minted to the payer; --tiers 1,2,3,0
                                                 # activates/upgrades them and checks Σw on-chain
```

`devnet-mock-desks.ts` ends by running the same owner+collection `getProgramAccounts` filter the
dashboard's `useWalletPortfolio` uses (`fetchOwnedDesks` in `sdk/`), so the web view and the
program agree on which assets are desks. Tier is program state (`DeskTier`), not NFT metadata —
the mock assets carry an `Attributes` plugin (`hub_tier_target`) only as a label.

Scale + cycle validation (payer = Config.authority = Config.treasury = BurnState.authority on devnet):

```sh
npm run devnet:desks -- --count 10 --tiers 1,1,1,1,2,2,2,3,3,4 --recycle
                                  # batch activate/upgrade in one tx per desk; --recycle finalizes the
                                  # round + claims owned yield whenever the payer runs short (10 desks
                                  # ≈ 1 SOL net instead of 9); asserts Σw and pot ≥ liability
npm run devnet:cycle              # sweep mock (seller → treasury, atomic; creates the buyer's $HUB ATA
                                  # if missing) → gate (finalize/claim rejected below 0.1 SOL) →
                                  # desk-pot rounds (--desk-round, default 0.144 SOL/desk = §A5 mainnet
                                  # take) booked as source B per treasury-owned desk → finalize
                                  # (⌊inflow×burn_bp⌋ burn, rest → acc_per_weight) → one claim_yield per
                                  # tier settles every closed round → burn → record_burn
npm run devnet:cycle -- --quick   # streamlined: inflow → finalize → claim → burn on existing desks
npm run authority -- status       # program upgrade authority vs $HUB mint/freeze authority
npm run authority -- revoke-mint --yes   # irreversible: mint + freeze authority → None
```

`update_config` is the single admin entry point (`setConfigValue` in `scripts/lib/devnet.ts`):
`setConfigValue(ctx, "hubMint", { pubkey })`, `("burnPctBp", { u16: 1000 })`,
`("minPotThresholdLamports", { u64: 100_000_000 })`, `("lpEnabled", { bool: true })`. Rate fields
apply to rounds finalized after the call. Rounds have no clock: `finalize_epoch` is rejected
(`PotBelowThreshold`) until the open round's inflow (+ whole-lamport dust carry) reaches
`min_pot_threshold_lamports`, and succeeds immediately after.

## Verified builds

The deployed `.so` is produced by `solana-verify build` inside the pinned
`solanafoundation/solana-verifiable-build` image (`[workspace.metadata.cli] solana` in
`Cargo.toml`), so anyone can rebuild the repo at a commit and compare hashes with the chain
([docs](https://solana.com/docs/programs/verified-builds)). Requires Docker + `cargo install solana-verify`.

```sh
scripts/verify-build.sh build              # anchor build (IDL) → docker build → target/deploy/hub.so
scripts/verify-build.sh hash               # local executable hash vs on-chain program hash
scripts/verify-build.sh deploy             # extend if larger, upgrade (or initial deploy), re-check hash, Orquestra sync
scripts/verify-build.sh verify [commit]    # rebuild from the cluster's repo at commit, compare, write verify PDA
HUB_CLUSTER=mainnet-beta HUB_WALLET=... scripts/verify-build.sh verify   # + `remote submit-job` → OtterSec / Explorer badge
scripts/verify-build.sh orquestra          # push IDL + verified-build notes to Orquestra by hand
```

`devnet-deploy.sh` calls the same `build` and `deploy`. Local `anchor build` output is fine for
tests but is not byte-identical to the docker build (host platform-tools differ), so never deploy
it directly. Which repo/branch each cluster is verified against is fixed in
[Repositories, branches, clusters](#repositories-branches-clusters).

### CI (`.github/workflows/verify.yml`)

Every `v*` tag (and `workflow_dispatch`) runs the same docker build on GitHub Actions, compares the
executable hash with the program on `devnet` / `mainnet-beta`, signs SLSA provenance for `hub.so`
through GitHub OIDC (Sigstore), and attaches `hub.so`, `hub.so.sha256`, `hub.json` (IDL) and
`verification-summary.md` to the GitHub Release. The job only runs in `OTCHUB/hubconnect` and
asserts the OIDC `iss` / `repository_owner` / `repository` claims before building; it holds no
deploy key. Repository variable `HUB_VERIFY_NETWORK` selects the cluster for tag builds.

### Verify independently

Anyone can confirm the on-chain program equals this source without trusting us or CI.
Requires Docker and `cargo install solana-verify`.

```sh
PROGRAM=7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i
RPC=https://api.mainnet-beta.solana.com          # or https://api.devnet.solana.com

# 1. rebuild from the public repo at the released commit and compare with the deployed bytes
solana-verify verify-from-repo -u $RPC --program-id $PROGRAM \
  https://github.com/OTCHUB/hubconnect --commit-hash <commit-or-tag> --library-name hub

# 2. or just read both hashes and compare them yourself
solana-verify get-program-hash -u $RPC $PROGRAM               # on chain
solana-verify get-executable-hash hub.so                     # release asset, or your own build

# 3. confirm the release asset was built by this repository's workflow (GitHub OIDC provenance)
gh attestation verify hub.so --owner OTCHUB
```

The upgrade authority also records the repo URL, commit and build args in the on-chain verify PDA
and submits them to the OtterSec API, so [Solana Explorer](https://explorer.solana.com/address/7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i/verified-build),
SolanaFM and Solscan show the program as verified and wallets can resolve the source
(`https://verify.osec.io/status/<program-id>`). `scripts/verify-build.sh verify` performs that step.

## Security & Verification

The `hub` program is **live on mainnet-beta** at
[`7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i`](https://explorer.solana.com/address/7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i)
and **OtterSec-verified** — the on-chain executable hash matches a public rebuild of this repo:

- Verification status: **[verify.osec.io/status/7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i](https://verify.osec.io/status/7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i)**
- Verified against commit [`OTCHUB/hubconnect@1b3bb077`](https://github.com/OTCHUB/hubconnect/tree/1b3bb077f540e9be3e262654ee89c9a7a2f11c85)
- Security disclosure policy: embedded via `security_txt!` in `programs/hub/src/lib.rs`, kept in sync with [`SECURITY.md`](SECURITY.md)

The program is deployed but **not yet initialized** — `initialize_config` is deferred until the
`$HUB` mint exists, so its address can be supplied at initialization instead of hardcoded ahead of
launch (see [Program IDs](#program-ids)).

## Milestones

| | Gate |
|---|---|
| M1 | scaffold builds; `initialize_config` writes Appendix constants; admin paths enforce authority ✔ |
| M2 | tier math, round math (threshold gate, 90/10, accumulator + dust zero-sum), lazy revocation, LP gates, invariants ✔ |
| M3 | integration + adversarial suites on localnet, then Helius devnet with mock OTC accounts |
| M4 | keepers (dry-run, resume-safe journals) |
| M5 | mainnet read-only verification checklist → `docs/evidence/` |
| M6 | upgradeable deploy behind multisig + 48h timelock; devnet pilot loop; mainnet |
