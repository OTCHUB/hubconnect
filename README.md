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

## Milestones

| | Gate |
|---|---|
| M1 | scaffold builds; `initialize_config` writes Appendix constants; admin paths enforce authority ✔ |
| M2 | tier math, epoch math (90/10, roll-forward), lazy revocation, consignment, LP gates, invariants |
| M3 | integration + adversarial suites on localnet, then Helius devnet with mock OTC accounts |
| M4 | keepers (dry-run, resume-safe journals) |
| M5 | mainnet read-only verification checklist → `docs/evidence/` |
| M6 | upgradeable deploy behind multisig + 48h timelock; devnet pilot loop; mainnet |
