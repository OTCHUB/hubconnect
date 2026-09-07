// Proof of concept: Orquestra "sign and send" against the hub program on devnet.
// Orquestra only *builds* (encodes) an instruction from the indexed IDL; the key never leaves this
// machine — we sign with the devnet payer and send through our own RPC via `sendIxs`.
//   npx ts-node -T scripts/orquestra-send.ts                 # pause (authority-gated), simulate only
//   npx ts-node -T scripts/orquestra-send.ts --ix set_otc_rate --args '{"otc_per_sol":"1000","enabled":true}' --send
//   npx ts-node -T scripts/orquestra-send.ts --ix claim_yield --accounts '{"desk_asset":"…"}'
// Accounts: `authority`/`payer`-style signers default to the devnet payer; PDAs and fixed
// addresses are derived from the IDL (Orquestra's builder does not derive them); anything else
// comes from --accounts. Every run also encodes the same call with the Anchor client and diffs
// data + account metas, so this doubles as the check that Orquestra decodes our IDL exactly as
// Anchor does. Known upstream gap: enum args lose their borsh variant index (see enumArgInstructions).
import { BN } from "@anchor-lang/core";
import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { HUB_IDL } from "../sdk/src";
import { devnetCtx, explorer, sendIxs, type Ctx } from "./lib/devnet";
import { buildInstruction, findProject } from "./lib/orquestra";
import { enumArgInstructions } from "./orquestra-idl";

// Raw IDL (snake_case, what Orquestra indexes). `ctx.program.idl` is Anchor's camelCased copy.
const RAW_IDL = HUB_IDL as unknown as {
  instructions: { name: string; accounts: IdlAcct[]; args: { name: string; type: unknown }[] }[];
  types?: { name: string; type: { kind: string } }[];
};
function rawIx(name: string) {
  const ix = RAW_IDL.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`${name} not in IDL`);
  return ix;
}

function arg(name: string, dflt: string) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const camel = (s: string) => s.replace(/_(\w)/g, (_, c) => c.toUpperCase());

type IdlType = string | { defined: { name: string } } | { option: IdlType } | { vec: IdlType };
/** JSON → Anchor client value for the common IDL scalar types; defined/enum values pass through. */
function anchorArg(ty: IdlType, v: unknown): unknown {
  if (typeof ty === "string") {
    if (ty === "pubkey") return new PublicKey(v as string);
    if (/^[ui](64|128)$/.test(ty)) return new BN(String(v));
    return v;
  }
  if ("option" in ty) return v == null ? null : anchorArg(ty.option, v);
  if ("vec" in ty) return (v as unknown[]).map((x) => anchorArg(ty.vec, x));
  return v;
}

type Seed = { kind: "const" | "account" | "arg"; value?: number[]; path?: string };
type IdlAcct = {
  name: string;
  signer?: boolean;
  address?: string;
  pda?: { seeds: Seed[]; program?: { kind: string; value?: number[] } };
};
const SIGNER_ALIASES = new Set(["authority", "payer", "keeper", "treasury", "wallet", "claimer"]);

/**
 * Fill in what the caller did not pass: the payer for signer roles, fixed `address` accounts,
 * and PDAs whose seeds are const / already-known accounts / provided args. Repeats until no
 * progress so PDAs may depend on other PDAs. Unresolvable accounts stay missing and Orquestra
 * reports them by name (400), which is the right failure mode.
 */
export function fillAccounts(
  ctx: Ctx,
  ixName: string,
  given: Record<string, PublicKey>,
  args: Record<string, unknown>,
): Record<string, PublicKey> {
  const idlIx = rawIx(ixName);
  const out = { ...given };
  const seedBytes = (s: Seed): Buffer | null => {
    if (s.kind === "const") return Buffer.from(s.value ?? []);
    if (s.kind === "account") {
      const k = s.path ?? "";
      return !k.includes(".") && out[k] ? out[k].toBuffer() : null; // `config.x` needs a fetch
    }
    const a = idlIx.args.find((x) => x.name === s.path);
    const v = args[camel(s.path ?? "")] ?? args[s.path ?? ""];
    if (!a || v == null) return null;
    const m = /^([ui])(8|16|32|64)$/.exec(String(a.type));
    if (!m) return null;
    const b = Buffer.alloc(Number(m[2]) / 8);
    b.writeUIntLE(Number(v), 0, Math.min(b.length, 6));
    return b;
  };
  for (const a of idlIx.accounts) {
    if (!out[a.name] && a.signer && SIGNER_ALIASES.has(a.name)) out[a.name] = ctx.payer.publicKey;
    if (!out[a.name] && a.address) out[a.name] = new PublicKey(a.address);
  }
  for (let progress = true; progress;) {
    progress = false;
    for (const a of idlIx.accounts) {
      if (out[a.name] || !a.pda) continue;
      const seeds = a.pda.seeds.map(seedBytes);
      if (seeds.some((s) => s === null)) continue;
      const prog = a.pda.program?.value
        ? new PublicKey(Buffer.from(a.pda.program.value))
        : ctx.program.programId;
      out[a.name] = PublicKey.findProgramAddressSync(seeds as Buffer[], prog)[0];
      progress = true;
    }
  }
  return out;
}

/** Same instruction through the Anchor client — the reference encoding. */
export async function anchorReference(
  ctx: Ctx,
  name: string,
  accounts: Record<string, PublicKey>,
  args: Record<string, unknown>,
): Promise<TransactionInstruction> {
  const idlIx = rawIx(name);
  const ordered = idlIx.args.map((a) =>
    anchorArg(a.type as IdlType, args[camel(a.name)] ?? args[a.name]),
  );
  const camelAccounts = Object.fromEntries(Object.entries(accounts).map(([k, v]) => [camel(k), v]));
  const methods = ctx.program.methods as unknown as Record<
    string,
    (...a: unknown[]) => {
      accountsPartial: (x: object) => { instruction: () => Promise<TransactionInstruction> };
    }
  >;
  return methods[camel(name)](...ordered)
    .accountsPartial(camelAccounts)
    .instruction();
}

function diff(a: TransactionInstruction, b: TransactionInstruction): string[] {
  const out: string[] = [];
  if (!a.programId.equals(b.programId)) out.push("programId differs");
  if (!a.data.equals(b.data))
    out.push(
      `data differs\n  orquestra ${a.data.toString("hex")}\n  anchor    ${b.data.toString("hex")}`,
    );
  if (a.keys.length !== b.keys.length)
    out.push(`account count ${a.keys.length} vs ${b.keys.length}`);
  a.keys.forEach((k, i) => {
    const r = b.keys[i];
    if (!r) return;
    if (!k.pubkey.equals(r.pubkey))
      out.push(`account[${i}] ${k.pubkey.toBase58()} vs ${r.pubkey.toBase58()}`);
    if (k.isSigner !== r.isSigner || k.isWritable !== r.isWritable)
      out.push(
        `account[${i}] meta signer/writable ${k.isSigner}/${k.isWritable} vs ${r.isSigner}/${r.isWritable}`,
      );
  });
  return out;
}

async function main() {
  const ctx = await devnetCtx(0.01); // one tx: no need for the harness's 2 SOL funder floor
  const send = process.argv.includes("--send");
  const explicitIx = process.argv.includes("--ix");
  // Default `pause`: authority + config, no args, no enums — a clean encoding check. Simulation
  // is enough; broadcasting it would halt devnet, so --send needs an explicit --ix.
  const name = arg("--ix", "pause");
  if (send && !explicitIx)
    throw new Error("--send requires --ix <instruction> (default `pause` would halt the program)");
  const payer = ctx.payer.publicKey.toBase58();
  const accountsJson = JSON.parse(arg("--accounts", "{}")) as Record<string, string>;
  const args = JSON.parse(arg("--args", "{}")) as Record<string, unknown>;
  const accounts = fillAccounts(
    ctx,
    name,
    Object.fromEntries(Object.entries(accountsJson).map(([k, v]) => [k, new PublicKey(v)])),
    args,
  );

  const enumIxs = enumArgInstructions(RAW_IDL as Parameters<typeof enumArgInstructions>[0]);
  if (enumIxs.includes(`\`${name}\``))
    console.warn(
      `warning: ${name} takes an enum argument — Orquestra's builder drops the borsh variant index, expect PARITY FAIL (upstream bug; use the Anchor client for this instruction)`,
    );

  const project = await findProject(ctx.program.programId);
  if (!project)
    throw new Error("program not indexed on Orquestra — run `npm run orquestra:idl` first");
  console.log(
    `orquestra project ${project.id} · ix ${name} · fee payer ${payer} · accounts ${Object.keys(accounts).join(",")}`,
  );

  const { ix, raw } = await buildInstruction(
    project.id,
    name,
    accounts,
    args,
    ctx.payer.publicKey,
    "devnet",
  );
  console.log(
    `built: ${raw.message ?? name} · data ${ix.data.length} B · ${ix.keys.length} accounts`,
  );

  const ref = await anchorReference(ctx, name, accounts, args);
  const d = diff(ix, ref);
  console.log(
    d.length ? `PARITY FAIL\n- ${d.join("\n- ")}` : "parity: Orquestra encoding == Anchor encoding",
  );

  const tx = new Transaction().add(ix);
  tx.feePayer = ctx.payer.publicKey;
  tx.recentBlockhash = (await ctx.connection.getLatestBlockhash()).blockhash;
  tx.sign(ctx.payer);
  const sim = await ctx.connection.simulateTransaction(tx);
  console.log(
    `simulate: ${sim.value.err ? `ERR ${JSON.stringify(sim.value.err)}` : "ok"} · CU ${sim.value.unitsConsumed}`,
  );
  sim.value.logs?.slice(-4).forEach((l) => console.log(`  ${l}`));
  if (sim.value.err || d.length) process.exitCode = 1;

  if (send && !sim.value.err && !d.length) {
    const sig = await sendIxs(ctx, [ix]);
    console.log(`sent ${sig}\n  ${explorer(sig, "tx")}`);
  } else if (send) {
    console.log("not sent: fix parity/simulation first");
  } else {
    console.log("dry run — pass --send to broadcast");
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
