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
scripts/             devnet-deploy.sh
docs/                spec, master prompt, evidence/ (mainnet read-only verification)
```

`Pot` is a data-less system-owned PDA (`["pot"]`); its lamport balance is the pot.
Liability is tracked on `Epoch` / `BurnState` / Σ `StakerAccrual`.

## Toolchain

| Tool | Version | Notes |
|---|---|---|
| Anchor | 0.31.1 | Spec says 0.30.x; 0.30.1's IDL build hardcodes `cargo +nightly` and breaks on every current nightly (`proc_macro::SourceFile` removed). 0.31 is the maintained line with the same program API. |
| Agave (solana-cli) | 2.1.21 | platform-tools v1.43 (rustc 1.79) |
| Host Rust | 1.79.0 | pinned in `rust-toolchain.toml` to match platform-tools; `Cargo.lock` is resolved with `CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback` and `blake3` pinned to 1.5.x |
| Node | ≥ 22 | ts-mocha, keepers |

```sh
export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
npm install
anchor build            # hub.so + target/idl/hub.json + target/types/hub.ts
anchor test --skip-build
```

If you regenerate `Cargo.lock`, do it with
`CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo +stable generate-lockfile`
then `cargo +stable update -p blake3 --precise 1.5.5`.

## Devnet (§B5.1)

Dedicated deployer keypair `~/.config/solana/hubconnect-devnet.json` — never reused on mainnet.

```sh
cp .env.example .env          # add HELIUS_API_KEY
solana airdrop 2 $(solana-keygen pubkey ~/.config/solana/hubconnect-devnet.json) -u devnet
scripts/devnet-deploy.sh --init
```

All $HUB mechanics pass the devnet stage (mock OTC-side accounts) before any mainnet deploy.

## Milestones

| | Gate |
|---|---|
| M1 | scaffold builds; `initialize_config` writes Appendix constants; admin paths enforce authority ✔ |
| M2 | tier math, epoch math (90/10, roll-forward), lazy revocation, consignment, LP gates, invariants |
| M3 | integration + adversarial suites on localnet, then Helius devnet with mock OTC accounts |
| M4 | keepers (dry-run, resume-safe journals) |
| M5 | mainnet read-only verification checklist → `docs/evidence/` |
| M6 | upgradeable deploy behind multisig + 48h timelock; devnet pilot loop; mainnet |
