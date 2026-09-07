// Proof of concept: Orquestra "sign and send" against the hub program on devnet.
// Orquestra only *builds* (encodes) an instruction from the indexed IDL; the key never leaves this
// machine — we sign with the devnet payer and send through our own RPC via `sendIxs`.
//   npx ts-node -T scripts/orquestra-send.ts                 # update_config(opsWallet → payer), simulate
//   npx ts-node -T scripts/orquestra-send.ts --send          # …and broadcast
//   npx ts-node -T scripts/orquestra-send.ts --ix pause --accounts '{"authority":"…","config":"…"}' --args '{}'
// Every run also encodes the same call with the Anchor client and diffs data + account metas, so
// this doubles as the check that Orquestra decodes our IDL exactly as Anchor does.
import { BN } from "@anchor-lang/core";
import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { devnetCtx, explorer, sendIxs, type Ctx } from "./lib/devnet";
import { buildInstruction, findProject } from "./lib/orquestra";

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

/** Same instruction through the Anchor client — the reference encoding. */
async function anchorReference(
  ctx: Ctx,
  name: string,
  accounts: Record<string, PublicKey>,
  args: Record<string, unknown>,
): Promise<TransactionInstruction> {
  const idlIx = ctx.program.idl.instructions.find((i) => i.name === name);
  if (!idlIx) throw new Error(`${name} not in IDL`);
  const ordered = idlIx.args.map((a) =>
    anchorArg(a.type as IdlType, args[camel(a.name)] ?? args[a.name]),
  );
  const methods = ctx.program.methods as unknown as Record<
    string,
    (...a: unknown[]) => {
      accountsPartial: (x: object) => { instruction: () => Promise<TransactionInstruction> };
    }
  >;
  return methods[camel(name)](...ordered)
    .accountsPartial(accounts)
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
  const name = arg("--ix", "update_config");
  const payer = ctx.payer.publicKey.toBase58();
  // Default: re-point Config.ops_wallet at the payer — authority-gated, idempotent on state.
  const accountsJson = JSON.parse(
    arg("--accounts", JSON.stringify({ authority: payer, config: ctx.config.toBase58() })),
  ) as Record<string, string>;
  const args = JSON.parse(
    arg("--args", JSON.stringify({ field: { opsWallet: {} }, value: { pubkey: [payer] } })),
  ) as Record<string, unknown>;
  const accounts = Object.fromEntries(
    Object.entries(accountsJson).map(([k, v]) => [k, new PublicKey(v)]),
  );

  const project = await findProject(ctx.program.programId);
  if (!project)
    throw new Error("program not indexed on Orquestra — run `npm run orquestra:idl` first");
  console.log(`orquestra project ${project.id} · ix ${name} · fee payer ${payer}`);

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
