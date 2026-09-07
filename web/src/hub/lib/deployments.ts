import { PublicKey } from "@solana/web3.js";
import {
  HUB_PROGRAM_ID,
  MPL_CORE_PROGRAM_ID,
  burnPda,
  configPda,
  potPda,
  treasuryPda,
  vaultPda,
  type ConfigView,
} from "@hub-sdk";

/** Registry cluster — localnet is not listed on Solscan, so the toggle offers only these two. */
export type RegistryCluster = "devnet" | "mainnet-beta";

export type DeploymentStatus = "live" | "pending" | "mock" | "external";

export type Deployment = {
  id: string;
  name: string;
  role: string;
  group: "hub" | "pdas" | "deps";
  /** `null` = not deployed / not launched on that cluster. */
  address: Record<RegistryCluster, string | null>;
  status: Record<RegistryCluster, DeploymentStatus>;
  note?: string;
};

// Mainnet $HUB program: not deployed yet — populate when the mainnet deployer ships it.
const HUB_MAINNET: string | null = null;
/** Anchor 1.x writes the IDL to a Program Metadata account — written at devnet deploy. */
const HUB_IDL_DEVNET = "Aa6cpxiNjUsD5Uwz7VMqPBNs9JS8DZdwDy1XFxm3FMYC";
const OTC_PROGRAM_MAINNET = "AjMx5My4YUDHMiCtLpTAtgkiUJgrpJnQqd5AcQnddHQW";
/** Pump.fun bonding-curve program — same id on devnet and mainnet (pump-public-docs). */
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const both = (addr: string, status: DeploymentStatus = "external") => ({
  address: { devnet: addr, "mainnet-beta": addr },
  status: { devnet: status, "mainnet-beta": status },
});

export const DEPLOYMENTS: Deployment[] = [
  {
    id: "hub-program",
    name: "$HUB PROGRAM",
    group: "hub",
    role: "Stake-to-earn core: Config, desk tiers, epochs, pot accounting, treasury sweeps (Anchor).",
    address: { devnet: HUB_PROGRAM_ID, "mainnet-beta": HUB_MAINNET },
    status: { devnet: "live", "mainnet-beta": "pending" },
    note: "Mainnet deploy waits on the full devnet M2/M3 suite + verified build.",
  },
  {
    id: "hub-idl",
    name: "IDL / PROGRAM METADATA",
    group: "hub",
    role: "On-chain Anchor IDL so explorers and wallets decode $HUB instructions.",
    address: { devnet: HUB_IDL_DEVNET, "mainnet-beta": null },
    status: { devnet: "live", "mainnet-beta": "pending" },
  },
  {
    ...both(MPL_CORE_PROGRAM_ID),
    id: "mpl-core",
    name: "METAPLEX CORE",
    group: "deps",
    role: "NFT standard for OTC desks; $HUB reads asset owner + collection from Core accounts.",
  },
  {
    id: "otc-program",
    name: "OTC DESK PROGRAM",
    group: "deps",
    role: "otcdesks.cash desk program — source of desk NFTs and the pot $HUB's yield tracks.",
    address: { devnet: null, "mainnet-beta": OTC_PROGRAM_MAINNET },
    status: { devnet: "mock", "mainnet-beta": "external" },
    note: "Mainnet-only; devnet Config points at harness mocks (see live rows below).",
  },
  {
    ...both(PUMP_PROGRAM),
    id: "pump",
    name: "PUMP.FUN (LAUNCH DRY-RUN)",
    group: "deps",
    role: "Bonding-curve launcher available on devnet — stand-in for rehearsing the $HUB mint launch.",
    note: "$HUB launches via the OTC launcher on mainnet; Pump.fun devnet is only a test venue.",
  },
];

export type LiveRow = {
  id: string;
  name: string;
  role: string;
  address: string;
  /** OTC-side references have no devnet counterpart — the harness substitutes mock keys (§B5.1). */
  devnetMock?: boolean;
};

type PdaFn = (programId: PublicKey) => [PublicKey, number];
const PDA_ROWS: [string, string, string, PdaFn][] = [
  ["config", "CONFIG PDA", "Singleton protocol parameters + epoch cursor.", configPda],
  ["pot", "POT PDA", "System-owned SOL pot; yield liability is paid from here.", potPda],
  ["burn", "BURN STATE PDA", "Burn-slice accounting for the $HUB burn leg.", burnPda],
  ["treasury", "TREASURY PDA", "Desk custody / exits / sweeps counters.", treasuryPda],
  ["vault", "VAULT PDA", "Program-signed custody for consigned desks.", vaultPda],
];

const CONFIG_ROWS: [string, string, string, keyof ConfigView, boolean][] = [
  [
    "hub-mint",
    "$HUB MINT",
    "Token launched via the OTC launcher; burn-leg target.",
    "hubMint",
    true,
  ],
  ["otc-mint", "$OTC MINT", "Reward stock paid to $HUB holders.", "otcMint", true],
  [
    "desk-collection",
    "DESK COLLECTION",
    "Core collection whose assets can activate tiers.",
    "deskCollection",
    true,
  ],
  [
    "otc-desk-pot",
    "OTC DESK POT",
    "OTC pot wallet whose inflow the epoch engine registers.",
    "otcDeskPot",
    true,
  ],
  ["ops-wallet", "OPS WALLET", "Receives the 10% ops slice of step fees.", "opsWallet", false],
  [
    "authority",
    "CONFIG AUTHORITY",
    "Admin key for pause/update_config (multisig planned for mainnet).",
    "authority",
    false,
  ],
];

/** Rows derived from the deployed program id + on-chain Config (empty where the program is absent). */
export function liveDeployments(
  programId: PublicKey | null,
  config: ConfigView | null,
): { pdas: LiveRow[]; fromConfig: LiveRow[] } {
  const pdas = programId
    ? PDA_ROWS.map(([id, name, role, fn]) => ({
        id,
        name,
        role,
        address: fn(programId)[0].toBase58(),
      }))
    : [];
  const fromConfig = config
    ? CONFIG_ROWS.map(([id, name, role, key, devnetMock]) => ({
        id,
        name,
        role,
        address: String(config[key]),
        devnetMock,
      }))
    : [];
  return { pdas, fromConfig };
}
