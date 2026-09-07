// §B4 — LP manager (depth monitor, fee harvest → source F). Implemented in M4.
export async function main(): Promise<void> {
  throw new Error("lp: not implemented (M4)");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
