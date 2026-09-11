// Mainnet PM2 process list for the 5 keeper services — mirrors `keeper/ecosystem.config.js`
// (devnet) but targets mainnet-beta. See `keeper/README.md` §B4 for the service contract.
//
// SAFETY — every app below still runs DRY_RUN=1. Do NOT flip to "0" until all of the
// following are true:
//   1. Mainnet `initialize_config` has actually run (no on-chain Config account exists yet —
//      derives to `6G7FFF8ct3z6cam5zBUQi54uBpRgKpUJmS5wxSdj2W9n`, currently empty).
//   2. Each keeper wallet below is funded with real SOL to at least
//      KEEPER_TARGET_CEILING_LAMPORTS (0.3 SOL — see the gas-float table in keeper/README.md).
//      The keys were freshly generated this session and hold 0 SOL; fund them from a real
//      mainnet source, there is no faucet.
//   3. `Config.treasury` has been reassigned to `keeper/keys/mainnet-treasury-authority.json`
//      via a mainnet equivalent of `scripts/devnet-set-treasury.ts` (not written yet — treasury
//      write paths stay read-only heartbeats regardless of DRY_RUN until that script exists).
//   4. `hub-keeper-sweeper-mainnet` must also keep SWEEPER_ENABLED=0 through launch — no Magic
//      Eden/OpenSea client exists yet (`keeper/shared/src/marketplace.ts`).
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
    DRY_RUN: "1",
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
