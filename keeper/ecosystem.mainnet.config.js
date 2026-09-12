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
//   5. `hub-keeper-epoch-mainnet` carries `HUB_EPOCH_ALT` (see `scripts/
//      mainnet-create-epoch-alt.ts`) — required for `finalize_epoch`'s tx to fit under the legacy
//      1232-byte limit; omitting it reproduces the "Transaction too large" crash loop.
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
      env: {
        ...common.env,
        HUB_KEEPER_KEYPAIR: "keeper/keys/mainnet-epoch-keeper.json",
        // Address Lookup Table from `scripts/mainnet-create-epoch-alt.ts` — without it,
        // finalize_epoch's fixed accounts + hop2's fixed Raydium accounts + hop1's Jupiter route
        // accounts as static keys overflow the legacy 1232-byte tx limit ("Transaction too
        // large"), crash-looping this process. See `keeper/keeper/src/index.ts`'s
        // `KeeperEnv.epochAlt` doc comment.
        HUB_EPOCH_ALT: "GYLVnPTrMGURphi1s8gUFHdmtucXNkGVNS4KDUi9vbrj",
      },
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
    {
      ...common,
      name: "hub-keeper-otc-buy-mainnet",
      args: ["-T", "keeper/otc-buy/src/index.ts"],
      env: {
        ...common.env,
        HUB_KEEPER_KEYPAIR: "keeper/keys/mainnet-otc-buy-keeper.json",
      },
    },
    {
      // §A5.1 recurring reconciliation for scripts/mainnet-recognize-hub-pot-inflow.ts — sweeps
      // whatever the OTC Desks launcher's automatic pro-rata holder payout deposited straight
      // into HubPotConfig's 4 bucket vaults since the last run (bypassing fund_hub_pot), skims
      // Config.protocol_fee_bp to ops_wallet, and credits the net remainder as pending yield.
      // Not built on keeper/shared/src/env.ts's KeeperEnv (that's for HUB_RPC_URL/
      // HUB_KEEPER_KEYPAIR-shaped services) — this is a standalone script using scripts/lib/
      // mainnet.ts's mainnetCtx(), which reads HUB_MAINNET_WALLET/HUB_MAINNET_RPC_URL instead.
      // A one-shot script, not a runForever() loop, so PM2's own cron_restart drives the same
      // ~60s cadence as KEEPER_LOOP_INTERVAL_MS above (otc-buy's loop interval) instead of an
      // internal setInterval. autorestart is off so a normal exit (including the expected
      // "NoHubPotInflow — nothing to do" no-op) doesn't immediately relaunch the process between
      // cron ticks. recognize_hub_pot_inflow is permissionless — any funded keypair works
      // identically (fixed skim rate/destination come from on-chain Config) — so this uses its
      // own low-privilege gas-only wallet rather than the deployer/upgrade-authority key
      // mainnetCtx() would otherwise default to.
      name: "hub-keeper-hub-pot-inflow-mainnet",
      cwd: ROOT,
      script: "node_modules/.bin/ts-node",
      args: ["-T", "scripts/mainnet-recognize-hub-pot-inflow.ts"],
      autorestart: false,
      cron_restart: "* * * * *",
      env: {
        HUB_MAINNET_WALLET: "keeper/keys/mainnet-hub-pot-inflow-keeper.json",
      },
    },
  ],
};
