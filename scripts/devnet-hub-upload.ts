// One-off: pin the refreshed $HUB logo + assets/hub-token.json on Irys (permanent Arweave-backed
// storage; payloads under 100 KiB upload for free, no funding tx required) and print the resulting
// metadata URI to feed into `npm run devnet:metadata -- --uri <uri>`.
//   npx ts-node -T scripts/devnet-hub-upload.ts
//
// assets/hub.png is the 1408x1408 master and exceeds the 100 KiB free-tier limit, so this script
// downsamples it to assets/hub-icon-512.png (512x512, the canonical size for token-list logos)
// before uploading. Re-run any time assets/hub.png changes.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Uploader } from "@irys/upload";
import { Solana } from "@irys/upload-solana";
import { loadKeypair } from "./lib/devnet";

const ASSETS = path.join(__dirname, "..", "assets");
const MASTER_LOGO = path.join(ASSETS, "hub.png");
const ICON_LOGO = path.join(ASSETS, "hub-icon-512.png");
const TOKEN_JSON_PATH = path.join(ASSETS, "hub-token.json");
const FREE_TIER_BYTES = 100 * 1024;

function ensureIcon() {
  execFileSync("sips", ["-z", "512", "512", MASTER_LOGO, "--out", ICON_LOGO], { stdio: "pipe" });
  const size = fs.statSync(ICON_LOGO).size;
  if (size >= FREE_TIER_BYTES) {
    throw new Error(`${ICON_LOGO} is ${size}B, still >= 100 KiB free-tier limit`);
  }
  console.log(`resized ${MASTER_LOGO} -> ${ICON_LOGO} (${size}B)`);
}

async function main() {
  ensureIcon();

  const keypair = loadKeypair();
  const irys = await Uploader(Solana).withWallet(Array.from(keypair.secretKey));
  console.log(`irys address ${irys.address}`);

  const logoReceipt = await irys.uploadFile(ICON_LOGO, {
    tags: [{ name: "Content-Type", value: "image/png" }],
  });
  const imageUri = `https://gateway.irys.xyz/${logoReceipt.id}`;
  console.log(`logo uploaded  -> ${imageUri}`);

  const tokenJson = JSON.parse(fs.readFileSync(TOKEN_JSON_PATH, "utf8"));
  tokenJson.image = imageUri;
  fs.writeFileSync(TOKEN_JSON_PATH, `${JSON.stringify(tokenJson, null, 2)}\n`);
  console.log(`updated ${TOKEN_JSON_PATH} image field`);

  const jsonBuf = Buffer.from(fs.readFileSync(TOKEN_JSON_PATH));
  if (jsonBuf.byteLength >= FREE_TIER_BYTES) {
    throw new Error(
      `${TOKEN_JSON_PATH} is ${jsonBuf.byteLength}B, exceeds 100 KiB free-tier limit`,
    );
  }
  const jsonReceipt = await irys.upload(jsonBuf, {
    tags: [{ name: "Content-Type", value: "application/json" }],
  });
  const metadataUri = `https://gateway.irys.xyz/${jsonReceipt.id}`;
  console.log(`metadata uploaded -> ${metadataUri}`);
  console.log(`\nnext: npm run devnet:metadata -- --uri ${metadataUri}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
