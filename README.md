# hubconnect — $HUB protocol

[![ci](https://github.com/OTCHUB/hubconnect/actions/workflows/ci.yml/badge.svg)](https://github.com/OTCHUB/hubconnect/actions/workflows/ci.yml)
[![verified build](https://github.com/OTCHUB/hubconnect/actions/workflows/verify.yml/badge.svg)](https://github.com/OTCHUB/hubconnect/actions/workflows/verify.yml)
[![program](https://img.shields.io/badge/program-5tCDEazU…5rewQv-14f195?logo=solana&logoColor=white)](https://explorer.solana.com/address/5tCDEazUAkRjrkasup1uWcYo3t1C2ht76LmQva5rewQv/verified-build)

Stake-to-earn layer for OTC desk NFTs. Anchor program, keeper services, read-only SDK.
**Community tooling — not affiliated with OTC.**

Single source of truth: [`docs/hubconnect-spec.md`](docs/hubconnect-spec.md) (v1.2).
Implement from it; never re-derive tokenomics.

## Layout

```
programs/hub/        Anchor program — §B2 accounts, §B3 instructions
  src/constants.rs   Appendix defaults (written into Config at initialize_config)
  src/state/         Config, Epoch, DeskTier, ConsignedDesk, StakerAccrual, BurnState, TreasuryState, OtcPayConfig
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
accumulator + consignor `StakerAccrual` credits) and `BurnState.burn_pending_lamports`.

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
                                  # if missing) → owner-sent desk consigned into the vault PDA → gate
                                  # (finalize/claim rejected below 0.1 SOL) → desk-pot rounds
                                  # (--desk-round, default 0.144 SOL/desk = §A5 mainnet take) booked as
                                  # source B per treasury-owned desk + source E per vault desk → finalize
                                  # (⌊inflow×burn_bp⌋ burn, rest → acc_per_weight) → one claim_yield per
                                  # tier settles every closed round → claim_accrual → burn → record_burn
npm run devnet:cycle -- --quick   # streamlined: inflow → finalize → claim → burn on existing desks
npm run devnet:cycle -- --consignor-share 5000   # also exercises the consignor's claim_accrual path
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
PROGRAM=5tCDEazUAkRjrkasup1uWcYo3t1C2ht76LmQva5rewQv
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
and submits them to the OtterSec API, so [Solana Explorer](https://explorer.solana.com/address/5tCDEazUAkRjrkasup1uWcYo3t1C2ht76LmQva5rewQv/verified-build),
SolanaFM and Solscan show the program as verified and wallets can resolve the source
(`https://verify.osec.io/status/<program-id>`). `scripts/verify-build.sh verify` performs that step.

## Milestones

| | Gate |
|---|---|
| M1 | scaffold builds; `initialize_config` writes Appendix constants; admin paths enforce authority ✔ |
| M2 | tier math, round math (threshold gate, 90/10, accumulator + dust zero-sum), lazy revocation, consignment, LP gates, invariants ✔ |
| M3 | integration + adversarial suites on localnet, then Helius devnet with mock OTC accounts |
| M4 | keepers (dry-run, resume-safe journals) |
| M5 | mainnet read-only verification checklist → `docs/evidence/` |
| M6 | upgradeable deploy behind multisig + 48h timelock; devnet pilot loop; mainnet |
