// §B4 — treasury desk sweeper. The acquisition decision (§A6: sweep vs mint,
// SOL-reserve-preserving) is implemented in `./arbitrage` and ready to consume; wiring
// it to live ME listings, an OTC/SOL price feed, and treasury balances lands in M4.
export { decideAcquisition, type AcquisitionInputs, type AcquisitionPlan } from "./arbitrage";

export async function main(): Promise<void> {
  throw new Error("sweeper: not implemented (M4)");
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
