// Copies the built IDL + types into sdk/idl so the SDK (and web/) never import from target/.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "target/idl/hub.json");
const srcTypes = join(root, "target/types/hub.ts");
const out = join(root, "sdk/idl");

if (!existsSync(src)) {
  console.error("target/idl/hub.json missing — run `anchor build` first");
  process.exit(1);
}
mkdirSync(out, { recursive: true });
copyFileSync(src, join(out, "hub.json"));
copyFileSync(srcTypes, join(out, "hub.ts"));
console.log("idl → sdk/idl/hub.json, sdk/idl/hub.ts");
