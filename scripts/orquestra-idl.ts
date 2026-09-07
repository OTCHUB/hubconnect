// Sync the hub IDL to Orquestra so its dashboard / REST builders / MCP tools decode our
// instructions, and record the verified-build state beside it (Orquestra has no notion of
// "verified"; we publish hash + commit + security.txt into the project's CPI notes).
//   npx ts-node -T scripts/orquestra-idl.ts [--dry-run] [--private]
// Idempotent: upload when no project exists for the program ID, else push a new IDL version.
// Needs ORQUESTRA_TOKEN (JWT) — API keys cannot create/update IDLs. Run by verify-build.sh after
// deploy/verify; safe to run by hand after `anchor build`.
import { Connection, PublicKey } from "@solana/web3.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { redactRpc } from "./lib/devnet";
import { clusterRpc, findProject, hasOrquestraAuth, updateIdl, uploadIdl } from "./lib/orquestra";

const ROOT = path.join(__dirname, "..");
const IDL_PATH = path.join(ROOT, "target/idl/hub.json");
const SO_PATH = path.join(ROOT, "target/deploy/hub.so");
const REPO = process.env.HUB_REPO_URL || "https://github.com/OTCHUB/hubconnect";
const PROGRAMDATA_HEADER = 45; // UpgradeableLoaderState::ProgramData metadata

/** solana-verify's hash: sha256 over the bytes with trailing zero padding removed. */
export function executableHash(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return createHash("sha256").update(bytes.subarray(0, end)).digest("hex");
}

export async function onchainHash(conn: Connection, programId: PublicKey): Promise<string | null> {
  const prog = await conn.getAccountInfo(programId);
  if (!prog || prog.data.length < 36) return null;
  const programData = new PublicKey(prog.data.subarray(4, 36));
  const pd = await conn.getAccountInfo(programData);
  return pd ? executableHash(pd.data.subarray(PROGRAMDATA_HEADER)) : null;
}

/** Parse the solana-security-txt block embedded in the .so (NUL-separated key/value pairs). */
export function securityTxt(so: Buffer): Record<string, string> {
  const s = so.indexOf("=======BEGIN SECURITY.TXT V1=======\0");
  const e = so.indexOf("=======END SECURITY.TXT V1=======\0");
  if (s < 0 || e < 0) return {};
  const parts = so
    .subarray(s + 36, e)
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < parts.length; i += 2) out[parts[i]] = parts[i + 1];
  return out;
}

type Seed = { kind: string; value?: number[]; path?: string };
type IdlAccount = { name: string; pda?: { seeds: Seed[] }; accounts?: IdlAccount[] };
const seedText = (s: Seed) =>
  s.kind === "const"
    ? (() => {
        const b = Buffer.from(s.value ?? []);
        return /^[\x20-\x7e]+$/.test(b.toString()) ? `"${b}"` : `0x${b.toString("hex")}`;
      })()
    : `${s.kind}:${s.path}`;

/** One line per PDA account in the IDL, deduped by name — the seeds an integrator must derive. */
export function pdaNotes(idl: { instructions: { accounts: IdlAccount[] }[] }): string[] {
  const seen = new Map<string, string>();
  const walk = (a: IdlAccount) => {
    if (a.pda && !seen.has(a.name)) seen.set(a.name, a.pda.seeds.map(seedText).join(", "));
    a.accounts?.forEach(walk);
  };
  idl.instructions.forEach((ix) => ix.accounts.forEach(walk));
  return [...seen].map(([n, s]) => `- \`${n}\` — seeds [${s}]`);
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim();
  } catch {
    return "unknown";
  }
}

export function verificationMd(o: {
  programId: PublicKey;
  cluster: string;
  commit: string;
  local: string | null;
  onchain: string | null;
  sec: Record<string, string>;
  pdas: string[];
}): string {
  const status =
    o.local && o.onchain
      ? o.local === o.onchain
        ? "✅ MATCH — on-chain bytes equal the reproducible build"
        : "❌ MISMATCH — redeploy pending"
      : "unknown (no local .so or program not found)";
  const sec = Object.entries(o.sec).map(([k, v]) => `- ${k}: ${v}`);
  return [
    "## Verified build",
    `- program: \`${o.programId.toBase58()}\` (${o.cluster})`,
    `- source: ${REPO}/tree/${o.commit}`,
    `- executable hash (local): \`${o.local ?? "n/a"}\``,
    `- executable hash (on-chain): \`${o.onchain ?? "n/a"}\``,
    `- status: ${status}`,
    "",
    `Reproduce: \`solana-verify verify-from-repo --program-id ${o.programId.toBase58()} ${REPO} --commit-hash ${o.commit} --library-name hub\``,
    "",
    "## security.txt (embedded in the program binary)",
    ...(sec.length ? sec : ["- not present in this build"]),
    "",
    "## PDA seeds",
    ...o.pdas,
    "",
    "## Notes",
    "- `config` must be initialised (`initialize_config`) before any other instruction.",
    "- `authority`-gated instructions (`update_config`, `pause`, `set_*`) require Config.authority to sign.",
  ].join("\n");
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const isPublic = !process.argv.includes("--private");
  if (!dry && !hasOrquestraAuth()) throw new Error("set ORQUESTRA_TOKEN (dashboard JWT) in .env");
  if (!fs.existsSync(IDL_PATH)) throw new Error("target/idl/hub.json missing — run `anchor build`");

  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  const programId = new PublicKey(idl.address);
  const cluster = process.env.HUB_CLUSTER || "devnet";
  const rpc = clusterRpc();
  const conn = new Connection(rpc, "confirmed");
  const so = fs.existsSync(SO_PATH) ? fs.readFileSync(SO_PATH) : null;
  const cpiMd = verificationMd({
    programId,
    cluster,
    commit: gitCommit(),
    local: so ? executableHash(so) : null,
    onchain: await onchainHash(conn, programId),
    sec: so ? securityTxt(so) : {},
    pdas: pdaNotes(idl),
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  console.log(
    `rpc ${redactRpc(rpc)} · program ${programId.toBase58()} · ${idl.instructions.length} ix`,
  );
  if (dry) return console.log(cpiMd);

  const existing = await findProject(programId);
  if (existing) {
    const r = await updateIdl(existing.id, idl, cpiMd);
    console.log(
      `orquestra: updated project ${existing.id} → IDL v${r.version} (${r.instructionCount} ix)`,
    );
    r.warnings?.forEach((w) => console.warn(`  warning: ${w}`));
  } else {
    const r = await uploadIdl({
      name: "HUB Protocol",
      programId,
      idl,
      description: pkg.description,
      cpiMd,
      isPublic,
    });
    console.log(
      `orquestra: created project ${r.project.id} (${r.project.slug}) → IDL v${r.idl.version}`,
    );
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
