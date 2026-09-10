<div align="center">

# 🟢 hubconnect — the $HUB protocol

**$HUB Yield Optimizer Protocol — Activate-to-earn Boosted Yield layer for OTC desk NFTs on Solana.**
Anchor program · keeper services · read-only SDK · treasury dashboard.

[![ci](https://github.com/OTCHUB/hubconnect/actions/workflows/ci.yml/badge.svg)](https://github.com/OTCHUB/hubconnect/actions/workflows/ci.yml)
[![verified build](https://github.com/OTCHUB/hubconnect/actions/workflows/verify.yml/badge.svg)](https://github.com/OTCHUB/hubconnect/actions/workflows/verify.yml)
[![program](https://img.shields.io/badge/program-7c5oPs9G…XJx7b7i-14f195?logo=solana&logoColor=white)](https://explorer.solana.com/address/7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i/verified-build)
[![website](https://img.shields.io/badge/website-otchub.dev-14f195)](https://otchub.dev)
[![app](https://img.shields.io/badge/app-app.otchub.dev-14f195)](https://app.otchub.dev)
[![x](https://img.shields.io/badge/-@otchubdev-000000?logo=x&logoColor=white)](https://x.com/otchubdev)

**Community tooling — not affiliated with the OTC Desks / OTCDesks Protocol team.**

</div>

Full protocol reference: [`docs/hubconnect-spec.md`](docs/hubconnect-spec.md) (v1.2).
Implement from it; never re-derive tokenomics.

## Links

| | |
|---|---|
| 🌐 Website | [otchub.dev](https://otchub.dev) |
| 📊 $HUB app (treasury dashboard) | [app.otchub.dev](https://app.otchub.dev) |
| 🐦 X / Twitter | [@otchubdev](https://x.com/otchubdev) |
| 📈 DexScreener | pending — published here once the $HUB mint and its first liquidity pool exist (see [Program IDs](#program-ids)) |
| ⚙️ How it works | [`docs/mechanics.md`](docs/mechanics.md) |
| 🪙 Tokenomics | [`docs/tokenomics.md`](docs/tokenomics.md) |
| 📖 Full spec | [`docs/hubconnect-spec.md`](docs/hubconnect-spec.md) |

## What is $HUB?

**OTCDesks Protocol** (otcdesks.cash) runs OTC desk NFTs and an OTC launcher. Any token launched
through the launcher picks its own **reward asset** at launch time — a tokenized stock, a
pre-IPO, a memecoin, or a wrapped asset — and every trade's creator fees are split a fixed
**70% / 10% / 15% / 5%**: 70% auto-swapped into that chosen asset and airdropped pro-rata to the
launched token's holders, 10% used to buy the reward asset for the OTC desk pot, 15% to OTC
protocol operations, and 5% held back for manual (non-scheduled) $OTC buybacks. The launcher
itself takes 0%. **$HUB chose $OTC as its reward asset**, so for $HUB specifically every leg above
is paid in $OTC — that is what the rest of this document means by "$OTC yield". **hubconnect is a
separate, community-built layer on top of that base protocol** — it does not fork or modify
OTCDesks, it only reads its on-chain state and composes with it.

$HUB launches *through* the OTC launcher and lets any OTC desk NFT owner **activate a tier
on-chain** (burn-based, never lock-based) to earn pro-rata **$OTC yield** every round, funded by
activation fees, treasury desk-sweep proceeds, the treasury's launcher holder-leg claim,
discount-exit proceeds, and LP swap fees. A dedicated **treasury desk flywheel** sweeps listed
desks when cheaper than minting (zero dilution), harvests their yield for stakers, and can resell
them to the community at a floor discount.

Design principles, in priority order: not greedy (nothing taken from other OTC participants, only
added buy pressure and pot funding); better yield for desk owners; deflationary by construction;
evidence-first (every constant parameterized and re-verified on-chain). **0% team/dev token
allocation.**

See [`docs/mechanics.md`](docs/mechanics.md) for the tier system, the flat activation fee, the
$OTC dynamic swap-burn payment path, and the 4-way per-round yield split; see
[`docs/tokenomics.md`](docs/tokenomics.md) for supply, allocation, and every burn sink.

### M.I.M ETF — the HUB Pot basket

Alongside the per-round $OTC yield above, activated desks also share in the **"HUB Pot"**
(on-chain/SDK name; branded to holders as the **M.I.M ETF**, "Magic Internet Money" ETF) — a
fixed 4-token basket, **$OTC, CRCLx, NVDAx, SPCXx**, funded entirely by the treasury's own
13-stock desk-pot yield (the 9 non-basket stocks are swapped to SOL and split evenly across the
4 buckets; the 4 basket stocks pass straight through, no swap). Desk owners pull their
tier-weighted share per round via `claim_hub_pot_reward`, or the authority can push it with
`distribute_hub_pot_reward` — both share one `HubPotClaim` PDA per round so a desk is paid at
most once. $OTC and the whole basket are **Token-2022** mints; $HUB/WSOL/USDC stay classic SPL —
every account/PDA that touches a basket mint resolves the correct token program per-mint
(`otc_pay.rs`, `hub_pot.rs`) rather than assuming one. See
[§A5.1 of the spec](docs/hubconnect-spec.md#a51-hub-pot--mim-etf-memestock-basket-yield-source-b-redirect)
for the full funding diagram and instruction list.

## Quick Start

```sh
git clone https://github.com/OTCHUB/hubconnect.git && cd hubconnect
export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
npm install
npm test   # anchor build (mainnet default) + anchor build -p hub -- --features mock-jupiter (for the
           # localnet-only two-hop swap in finalize_epoch) + anchor test --skip-build --validator legacy
```

Read-only SDK (account decoders, PDA derivation, projection math) lives in [`sdk/`](sdk); the
treasury dashboard in [`web/`](web) consumes it directly. Full devnet deploy + mock-desk setup:
see [Devnet](#devnet-b51) below.

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
| Token-2022 program | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | devnet + mainnet — $OTC + the whole M.I.M ETF basket (CRCLx/NVDAx/SPCXx) mint through this program; $HUB/WSOL/USDC stay classic `TOKEN_PROGRAM_ID` |

Full PDA table (`Config`, `Pot`, `BurnState`, `TreasuryState`, `Vault`, `Epoch[0]`) and current
devnet `Config` values: [Appendix — Deployment addresses](docs/hubconnect-spec.md#appendix--deployment-addresses-verified-on-chain-2026-09-07)
in the spec. `hub_mint`, `otc_mint`, `desk_collection`, `otc_desk_pot`, `ops_wallet`, `authority`,
and the M.I.M ETF basket's `crclx_mint`/`nvdax_mint`/`spcxx_mint` (`HubPotConfig`, §A5.1) are never
hardcoded in the frontend — every consumer reads them live off the on-chain `Config` /
`HubPotConfig` singletons (`§A3.2`). The devnet $HUB mint above is a **test-only mock** minted by
`scripts/devnet-hub-mint.ts` — it is not the real $HUB token and carries no value.

## Security

- **Disclosure**: report privately via [GitHub Security Advisories](https://github.com/OTCHUB/hubconnect/security/advisories/new) — see [`SECURITY.md`](SECURITY.md). Do not open a public issue for security bugs.
- **On-chain `security.txt`**: embedded in the deployed `.so` ([neodyme-labs/solana-security-txt](https://github.com/neodyme-labs/solana-security-txt)), so explorers and researchers can find the disclosure channel from the binary alone — `programs/hub/src/lib.rs`.
- **Audit status**: `auditors: "None"` (declared in the embedded security.txt). No third-party audit has been performed; treat the program as unaudited until this changes.
- **Arithmetic policy**: every accounting counter (`total_weight_bp`, `pot_liability_lamports`, `total_exits`, all `*_pending_*` balances) uses checked `add()`/`sub()` helpers that error on overflow/underflow — no `saturating_*` on state that must never silently clamp.
- **Split invariants**: the 90/5/2.5/2.5 round split and 80/5/5/5/5 creator-fee split are asserted to sum to exactly 10,000 bp at **compile time** (`programs/hub/src/constants.rs`), not just at runtime.
- **Emergency pause (`Config.paused`, authority-only)**: gates new value-creating actions (`activate_tier`, `upgrade_tier`, `claim_yield`) and every keeper reimbursement draw that pays protocol-custodied funds out to an externally-controlled wallet (`record_otc_buy`, `draw_creator_fee_leg`) — the fastest stop available against a compromised keeper key, since those keepers' authorities aren't independently rotatable. Inbound deposits, internal PDA-signed bookkeeping (`clear_creator_fees`), and pure off-chain attestations stay open under pause so a keeper mid-recovery isn't stranded. Full instruction-level gating: [`§B3`](docs/hubconnect-spec.md#b3-on-chain-program--instructions).
- **Verified builds**: reproducible `.so`, SLSA provenance and independent verification steps — see [Verified builds](#verified-builds) below.

## Layout

```
programs/hub/        Anchor program — §B2 accounts, §B3 instructions
  src/constants.rs   Appendix defaults (written into Config at initialize_config)
  src/state/         Config, Epoch, DeskTier, BurnState, TreasuryState, OtcPayConfig, HubPotConfig
  src/instructions/  admin | tiers | otc_pay ($OTC step fees → POL reserve) | epochs | treasury |
                     hub_pot (§A5.1 M.I.M ETF basket: $OTC/CRCLx/NVDAx/SPCXx, Token-2022)
programs/mock_jupiter/  Localnet-only Jupiter swap stand-in (`mock-jupiter` feature, tests only)
sdk/                 PDA derivation + constants mirror; account decoders (M3)
keeper/              §B4 services: keeper (epoch+burn), sweeper, treasury (exit), lp
tests/               anchor-ts suites; HUB_CLUSTER=devnet targets Helius devnet (§B5.1)
scripts/             devnet-deploy.sh · verify-build.sh · orquestra-idl.ts · devnet-hub-mint.ts · devnet-mock-desks.ts
assets/              hub.png (1024², $HUB logo) · hub-token.json (Metaplex fungible metadata)
docs/                spec, master prompt, evidence/ (mainnet read-only verification)
```

`Pot` is a data-less system-owned PDA (`["pot"]`); its lamport balance is the pot.
Liability is tracked on `Config.pot_liability_lamports` (staker yield via the `acc_per_weight`
accumulator); the burn/LP/treasury-float legs are spent synchronously inside `finalize_epoch`,
so they never sit as pot liability.

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
anchor build                                        # hub.so + target/idl/hub.json + target/types/hub.ts
anchor build -p hub -- --features mock-jupiter      # 2nd hub.so, localnet-only Jupiter CPI double
anchor test --skip-build --validator legacy
```

Anchor 1.x runs `anchor test` on surfpool by default; this suite uses `solana-test-validator`
(`--validator legacy` or `ANCHOR_TEST_VALIDATOR=legacy`) so the `[test.validator.clone]` entries
in `Anchor.toml` pull Metaplex Core from devnet. `Cargo.lock` regenerates with plain `cargo update`.
`finalize_epoch`'s round split swaps SOL→$HUB via a synchronous on-chain Jupiter CPI
(`programs/hub/src/instructions/jupiter_swap.rs`) — no real Jupiter route exists on a local
validator, so the `mock-jupiter` Cargo feature swaps `hub`'s target program for
`programs/mock_jupiter` (a pre-funded WSOL→USDC→$HUB two-hop stand-in, `sdk/src/constants.ts`'s
`MOCK_JUPITER_PROGRAM_ID`); `npm test` builds both binaries so the M2/M3 suites can exercise the
real accounting path end-to-end on localnet. Never build `hub` with `mock-jupiter` for a devnet or
mainnet deploy — `scripts/verify-build.sh` and `devnet-deploy.sh` always use the default build.

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

The devnet Config starts with harness placeholders for every OTC-side key. Operator scripts
replace them with functional stand-ins (payer = Config.authority):

```sh
npx ts-node -T scripts/devnet-hub-mint.ts        # SPL mint (1B × 10^6) → Config.hub_mint; ops_wallet → payer
npx ts-node -T scripts/devnet-hub-pot-mint.ts    # CRCLx/NVDAx/SPCXx mock mints (classic SPL stand-ins;
                                                 # mainnet basket tokens are Token-2022) + their vault-owned
                                                 # token accounts → init_hub_pot's HubPotConfig
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
                                  # (⌊inflow×burn_bp⌋ swapped SOL→$HUB via synchronous Jupiter CPI and
                                  # burned in the same tx, rest → acc_per_weight) → one claim_yield per
                                  # tier settles every closed round
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
