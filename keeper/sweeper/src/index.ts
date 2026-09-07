// §B4 — treasury desk sweeper. Implemented in M4.
export async function main(): Promise<void> {
  throw new Error("sweeper: not implemented (M4)");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
