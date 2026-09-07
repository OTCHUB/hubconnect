// §B4 — treasury exit service (90% floor; HUB leg burned / SOL leg → pot). Implemented in M4.
export async function main(): Promise<void> {
  throw new Error("treasury: not implemented (M4)");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
