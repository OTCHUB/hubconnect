// Attach Metaplex Token Metadata (name / symbol / logo URI) to the devnet mock $OTC / CRCLx /
// NVDAx / SPCXx mints so wallets and explorers render them instead of "Unknown" — same problem
// devnet-hub-metadata.ts solved for $HUB, generalized over the faucet's other drip tokens, whose
// devnet mints (created by devnet-otc-mint.ts / devnet-hub-pot-mint.ts via the raw
// InitializeMint2 helper) never got a metadata account attached.
//   npx ts-node -T scripts/devnet-mock-token-metadata.ts [--token otc|crclx|nvdax|spcxx|all]
// Idempotent per token: creates the metadata account if missing, otherwise updates it. The payer
// must be the mint authority (create) — true for all 4 mints, since devnet-otc-mint.ts and
// devnet-hub-pot-mint.ts both mint via `createHubMint()`, which sets `owner` (the payer) as the
// mint authority. Images already live at the production otchub.dev bundle (public/stocks/*.png —
// the exact icons StockIcon.tsx renders in the UI), so this only uploads a small metadata JSON
// per token to Irys (free tier, no funding tx), not the images themselves.
import { PublicKey } from "@solana/web3.js";
import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import { fetchHubPot, type HubPotView } from "../sdk/src";
import {
  TOKEN_PROGRAM_ID,
  devnetCtx,
  explorer,
  loadKeypair,
  sendIxs,
  type Ctx,
} from "./lib/devnet";
import { createMetadataV3, metadataPda, updateMetadataV2 } from "./devnet-hub-metadata";

const MINT_SIZE = 82;
type TokenKey = "otc" | "crclx" | "nvdax" | "spcxx";

const TOKEN_META: Record<
  TokenKey,
  { name: string; symbol: string; description: string; image: string }
> = {
  otc: {
    name: "OTC Desks (mock)",
    symbol: "OTC",
    description:
      "Devnet mock of $OTC — the §A5 90% yield leg desk owners claim via claim_yield. Never deployed to mainnet as its own SPL token; test-only stand-in for faucet drips.",
    image: "https://otchub.dev/stocks/OTC.png",
  },
  crclx: {
    name: "Circle xStock (mock)",
    symbol: "CRCLx",
    description:
      "Devnet mock of Backed Finance's tokenized Circle (CRCL) xStock — one of the 3 M.I.M ETF basket buckets HubPot drips on devnet. Test-only, not the real xStock mint.",
    image: "https://otchub.dev/stocks/CRCLx.png",
  },
  nvdax: {
    name: "NVIDIA xStock (mock)",
    symbol: "NVDAx",
    description:
      "Devnet mock of Backed Finance's tokenized NVIDIA (NVDA) xStock — one of the 3 M.I.M ETF basket buckets HubPot drips on devnet. Test-only, not the real xStock mint.",
    image: "https://otchub.dev/stocks/NVDAx.png",
  },
  spcxx: {
    name: "SpaceX xStock (mock)",
    symbol: "SPCXx",
    description:
      "Devnet mock of Backed Finance's tokenized SpaceX (SPCX) xStock — one of the 3 M.I.M ETF basket buckets HubPot drips on devnet. Test-only, not the real xStock mint.",
    image: "https://otchub.dev/stocks/SPCXx.png",
  },
};

async function resolveMint(ctx: Ctx, token: TokenKey): Promise<PublicKey> {
  if (token === "otc") {
    const cfg = await ctx.program.account.config.fetch(ctx.config);
    if (cfg.otcMint.equals(PublicKey.default)) {
      throw new Error("Config.otc_mint unset — run devnet-otc-mint.ts first");
    }
    return cfg.otcMint;
  }
  const pot = await fetchHubPot(ctx.program);
  if (!pot) throw new Error("HubPotConfig unset — run devnet-hub-pot-mint.ts first");
  const field = `${token}Mint` as keyof HubPotView;
  return new PublicKey(pot[field] as string);
}

async function uploadMetadataJson(token: TokenKey) {
  const meta = TOKEN_META[token];
  const keypair = loadKeypair();
  const irys = await Uploader(Solana).withWallet(Array.from(keypair.secretKey));
  const json = {
    name: meta.name,
    symbol: meta.symbol,
    description: meta.description,
    image: meta.image,
    external_url: "https://otchub.dev",
  };
  const buf = Buffer.from(JSON.stringify(json, null, 2));
  const receipt = await irys.upload(buf, {
    tags: [{ name: "Content-Type", value: "application/json" }],
  });
  return `https://gateway.irys.xyz/${receipt.id}`;
}

async function attachOne(ctx: Ctx, token: TokenKey) {
  const meta = TOKEN_META[token];
  const mint = await resolveMint(ctx, token);
  const info = await ctx.connection.getAccountInfo(mint);
  if (!info || !info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length !== MINT_SIZE) {
    throw new Error(`${token} mint ${mint.toBase58()} is not a Token-program mint`);
  }
  const mintAuthority = new PublicKey(info.data.subarray(4, 36));
  const pda = metadataPda(mint);
  const exists = !!(await ctx.connection.getAccountInfo(pda));
  if (!exists && !mintAuthority.equals(ctx.payer.publicKey)) {
    throw new Error(`payer is not the mint authority of ${token} (${mintAuthority.toBase58()})`);
  }
  const uri = await uploadMetadataJson(token);
  const ix = exists
    ? updateMetadataV2(mint, ctx.payer.publicKey, meta.name, meta.symbol, uri)
    : createMetadataV3(mint, ctx.payer.publicKey, meta.name, meta.symbol, uri);
  const sig = await sendIxs(ctx, [ix]);
  console.log(
    `${exists ? "updated" : "created"} metadata ${pda.toBase58()} for ${meta.symbol} ${mint.toBase58()}`,
  );
  console.log(`  uri=${uri}\n  ${explorer(sig, "tx")}`);
}

function arg(name: string, dflt: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function main() {
  const ctx = await devnetCtx();
  const requested = arg("--token", "all");
  const tokens: TokenKey[] =
    requested === "all" ? ["otc", "crclx", "nvdax", "spcxx"] : [requested as TokenKey];
  for (const t of tokens) {
    if (!TOKEN_META[t]) throw new Error(`unknown --token ${t} (want otc|crclx|nvdax|spcxx|all)`);
    await attachOne(ctx, t);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
