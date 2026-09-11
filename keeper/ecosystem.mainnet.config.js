// Mainnet PM2 process list for the 5 keeper services — mirrors `keeper/ecosystem.config.js`
// (devnet) but targets mainnet-beta. See `keeper/README.md` §B4 for the service contract.
//
// STATUS — live on mainnet-beta as of the §A7.1 genesis init chain:
//   1. `initialize_config` executed: Config = 6G7FFF8ct3z6cam5zBUQi54uBpRgKpUJmS5wxSdj2W9n.
//   2. Each keeper wallet below funded with 0.3 SOL (KEEPER_TARGET_CEILING_LAMPORTS) from the
//      deployer wallet.
//   3. `Config.treasury` reassigned to `keeper/keys/mainnet-treasury-authority.json` via
//      `scripts/mainnet-set-treasury.ts`.
//   4. `hub-keeper-sweeper-mainnet` keeps SWEEPER_ENABLED=0 regardless of DRY_RUN — no Magic
//      Eden/OpenSea client exists yet (`keeper/shared/src/marketplace.ts`).
// DRY_RUN is now "0" — keepers submit real transactions against mainnet-beta.
//
// RPC precedence (mirrors `scripts/lib/mainnet.ts`): HUB_MAINNET_RPC_URL (raw or with
// `${HELIUS_API_KEY}` substitution) > Helius mainnet via HELIUS_API_KEY > public mainnet-beta.
// Reads the repo-root `.env` directly since PM2 loads this file outside the ts-node/dotenv
// bootstrap each keeper's own `src/index.ts` uses.
//
// Usage: `pm2 start keeper/ecosystem.mainnet.config.js` from the repo root.
require("dotenv").config({ path: __dirname + "/../.env" });

const ROOT = __dirname + "/..";

function mainnetRpc() {
  const tmpl = process.env.HUB_MAINNET_RPC_URL;
  if (tmpl) return tmpl.replace("${HELIUS_API_KEY}", process.env.HELIUS_API_KEY || "");
  if (process.env.HELIUS_API_KEY) {
    return `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
  }
  return "https://api.mainnet-beta.solana.com";
}

const TREASURY_KEYPAIR = "keeper/keys/mainnet-treasury-authority.json";

const common = {
  cwd: ROOT,
  script: "node_modules/.bin/ts-node",
  autorestart: true,
  restart_delay: 5000,
  max_restarts: 20,
  env: {
    HUB_CLUSTER: "mainnet-beta",
    HUB_RPC_URL: mainnetRpc(),
    HUB_PROGRAM_ID: "7c5oPs9GvX8vrC5jVFketNx1ZLuPs7HeH8Qc4XJx7b7i",
    DRY_RUN: "0",
    KEEPER_LOOP_INTERVAL_MS: "60000",
  },
};

module.exports = {
  apps: [
    {
      ...common,
      name: "hub-keeper-epoch-mainnet",
      args: ["-T", "keeper/keeper/src/index.ts"],
      env: { ...common.env, HUB_KEEPER_KEYPAIR: "keeper/keys/mainnet-epoch-keeper.json" },
    },
    {
      ...common,
      name: "hub-keeper-creator-fee-mainnet",
      args: ["-T", "keeper/creator-fee/src/index.ts"],
      env: {
        ...common.env,
        HUB_KEEPER_KEYPAIR: "keeper/keys/mainnet-creator-fee-keeper.json",
        TREASURY_KEYPAIR,
      },
    },
    {
      ...common,
      name: "hub-keeper-lp-mainnet",
      args: ["-T", "keeper/lp/src/index.ts"],
      env: {
        ...common.env,
        HUB_KEEPER_KEYPAIR: "keeper/keys/mainnet-lp-keeper.json",
        TREASURY_KEYPAIR,
      },
    },
    {
      ...common,
      name: "hub-keeper-sweeper-mainnet",
      args: ["-T", "keeper/sweeper/src/index.ts"],
      env: {
        ...common.env,
        HUB_KEEPER_KEYPAIR: "keeper/keys/mainnet-sweeper-keeper.json",
        TREASURY_KEYPAIR,
        SWEEPER_ENABLED: "0",
      },
    },
    {
      ...common,
      name: "hub-keeper-treasury-mainnet",
      args: ["-T", "keeper/treasury/src/index.ts"],
      env: { ...common.env, HUB_KEEPER_KEYPAIR: "keeper/keys/mainnet-treasury-keeper.json" },
    },
  ],
};
