// Local PM2 process list for the 5 keeper services (§B4, see `keeper/README.md`).
//
// Devnet-only for now — every app below points at devnet RPC + the devnet keeper keypairs
// generated this session (`keeper/keys/devnet-*-keeper.json`, funded with 0.3 SOL each).
// All 5 run with DRY_RUN=1: the epoch keeper (`keeper/keeper`) is otherwise fully wired and
// would submit `finalize_epoch` once DRY_RUN is dropped and the round is ready; the other 4
// (`creator-fee`, `lp`, `sweeper`, `treasury`) are read-only heartbeats regardless of
// DRY_RUN — see each service's `src/index.ts` module doc for the specific blocker
// (missing instruction-submission code, missing marketplace integration, or missing
// on-chain instruction) standing between them and real execution.
//
// `Config.treasury` is reassigned to `keeper/keys/devnet-treasury-authority.json`
// (`scripts/devnet-set-treasury.ts`) and passed to the three services whose write path needs
// it (`creator-fee`, `lp`, `sweeper`) via `TREASURY_KEYPAIR` — see `keeper/shared/src/env.ts`.
//
// `hub-keeper-sweeper` additionally carries `SWEEPER_ENABLED: "0"` — explicit operator
// pause, independent of `DRY_RUN`/`Config.paused`, until a Magic Eden or OpenSea integration
// is picked and implemented (`keeper/shared/src/marketplace.ts`). Keep this "0" through
// mainnet launch; flip to "1" (with `MARKETPLACE_PROVIDER` + its API key) only once that
// integration ships and is verified on devnet.
//
// Usage: `pm2 start keeper/ecosystem.config.js` from the repo root.
const ROOT = __dirname + "/..";
const DEVNET_RPC = "https://api.devnet.solana.com";
const TREASURY_KEYPAIR = "keeper/keys/devnet-treasury-authority.json";

const common = {
  cwd: ROOT,
  script: "node_modules/.bin/ts-node",
  autorestart: true,
  restart_delay: 5000,
  max_restarts: 20,
  env: {
    HUB_CLUSTER: "devnet",
    HUB_RPC_URL: process.env.HUB_DEVNET_RPC_URL || DEVNET_RPC,
    HUB_PROGRAM_ID: "7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i",
    DRY_RUN: "1",
    KEEPER_LOOP_INTERVAL_MS: "60000",
  },
};

module.exports = {
  apps: [
    {
      ...common,
      name: "hub-keeper-epoch",
      args: ["-T", "keeper/keeper/src/index.ts"],
      env: { ...common.env, HUB_KEEPER_KEYPAIR: "keeper/keys/devnet-epoch-keeper.json" },
    },
    {
      ...common,
      name: "hub-keeper-creator-fee",
      args: ["-T", "keeper/creator-fee/src/index.ts"],
      env: {
        ...common.env,
        HUB_KEEPER_KEYPAIR: "keeper/keys/devnet-creator-fee-keeper.json",
        TREASURY_KEYPAIR,
      },
    },
    {
      ...common,
      name: "hub-keeper-lp",
      args: ["-T", "keeper/lp/src/index.ts"],
      env: {
        ...common.env,
        HUB_KEEPER_KEYPAIR: "keeper/keys/devnet-lp-keeper.json",
        TREASURY_KEYPAIR,
      },
    },
    {
      ...common,
      name: "hub-keeper-sweeper",
      args: ["-T", "keeper/sweeper/src/index.ts"],
      env: {
        ...common.env,
        HUB_KEEPER_KEYPAIR: "keeper/keys/devnet-sweeper-keeper.json",
        TREASURY_KEYPAIR,
        SWEEPER_ENABLED: "0",
      },
    },
    {
      ...common,
      name: "hub-keeper-treasury",
      args: ["-T", "keeper/treasury/src/index.ts"],
      env: { ...common.env, HUB_KEEPER_KEYPAIR: "keeper/keys/devnet-treasury-keeper.json" },
    },
  ],
};
