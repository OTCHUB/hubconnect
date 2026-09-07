# hubconnect — $HUB protocol

Stake-to-earn layer for OTC desk NFTs. Anchor program, keeper services, read-only SDK.
**Community tooling — not affiliated with OTC.**

Single source of truth: [`docs/hubconnect-spec.md`](docs/hubconnect-spec.md) (v1.2).
Implement from it; never re-derive tokenomics.

## Layout

```
programs/hub/        Anchor program — §B2 accounts, §B3 instructions
  src/constants.rs   Appendix defaults (written into Config at initialize_config)
  src/state/         Config, Epoch, DeskTier, ConsignedDesk, StakerAccrual, BurnState, TreasuryState
  src/instructions/  admin | tiers | epochs | treasury
sdk/                 PDA derivation + constants mirror; account decoders (M3)
keeper/              §B4 services: keeper (epoch+burn), sweeper, treasury (exit), lp
tests/               anchor-ts suites; HUB_CLUSTER=devnet targets Helius devnet (§B5.1)
scripts/             devnet-deploy.sh · verify-build.sh · devnet-hub-mint.ts · devnet-mock-desks.ts
docs/                spec, master prompt, evidence/ (mainnet read-only verification)
```

`Pot` is a data-less system-owned PDA (`["pot"]`); its lamport balance is the pot.
Liability is tracked on `Epoch` / `BurnState` / Σ `StakerAccrual`.

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
                                  # epoch + claims owned yield whenever the payer runs short (10 desks
                                  # ≈ 1 SOL net instead of 9); asserts Σw and pot ≥ liability
npm run devnet:cycle              # sweep mock (seller → treasury, atomic; creates the buyer's $HUB ATA
                                  # if missing) → owner-sent desk consigned into the vault PDA → desk-pot
                                  # rounds (--desk-round, default 0.144 SOL/desk = §A5 mainnet take) booked
                                  # as source B per treasury-owned desk + source E per vault desk →
                                  # finalize (⌊inflow×burn_bp⌋) → claim every tier in program order
                                  # (⌊dist×w/Σw⌋, last claimer absorbs the remainder) → burn → record_burn
npm run devnet:cycle -- --quick   # streamlined: inflow → finalize → claim → burn on existing desks
npm run authority -- status       # program upgrade authority vs $HUB mint/freeze authority
npm run authority -- revoke-mint --yes   # irreversible: mint + freeze authority → None
```

`update_config` is the single admin entry point (`setConfigValue` in `scripts/lib/devnet.ts`):
`setConfigValue(ctx, "hubMint", { pubkey })`, `("burnPctBp", { u16: 1000 })`,
`("epochDurationSecs", { u64: 120 })`, `("lpEnabled", { bool: true })`. Rate fields apply to epochs
finalized after the call; the duration applies to the next epoch `finalize_epoch` opens.
`HUB_DEVNET_EPOCH_SECS` (default 120) is the epoch length the scripts restore after a catch-up finalize.

## Verified builds

The deployed `.so` is produced by `solana-verify build` inside the pinned
`solanafoundation/solana-verifiable-build` image (`[workspace.metadata.cli] solana` in
`Cargo.toml`), so anyone can rebuild the repo at a commit and compare hashes with the chain
([docs](https://solana.com/docs/programs/verified-builds)). Requires Docker + `cargo install solana-verify`.

```sh
scripts/verify-build.sh build              # anchor build (IDL) → docker build → target/deploy/hub.so
scripts/verify-build.sh hash               # local executable hash vs on-chain program hash
scripts/verify-build.sh deploy             # extend if larger, upgrade, re-check hash
scripts/verify-build.sh verify <commit>    # rebuild from GitHub at <commit> and compare (3rd-party path)
HUB_CLUSTER=mainnet-beta HUB_WALLET=... scripts/verify-build.sh verify <commit>   # + --remote: verify PDA + OtterSec API
```

`devnet-deploy.sh` uses the same artifact. Local `anchor build` output is fine for tests but is not
byte-identical to the docker build (host platform-tools differ), so never deploy it directly.

## Milestones

| | Gate |
|---|---|
| M1 | scaffold builds; `initialize_config` writes Appendix constants; admin paths enforce authority ✔ |
| M2 | tier math, epoch math (90/10, roll-forward), lazy revocation, consignment, LP gates, invariants |
| M3 | integration + adversarial suites on localnet, then Helius devnet with mock OTC accounts |
| M4 | keepers (dry-run, resume-safe journals) |
| M5 | mainnet read-only verification checklist → `docs/evidence/` |
| M6 | upgradeable deploy behind multisig + 48h timelock; devnet pilot loop; mainnet |
