import { expect } from "chai";
import {
  planBasketConsolidation,
  hasAnythingToFund,
  BUCKETS,
  SWAP_STOCKS,
  ROTATION_STOCKS,
  NATIVE_BUCKET_STOCK,
  type StockBalance,
  type RotationStock,
} from "./basketConsolidation";

describe("keeper/sweeper basketConsolidation — §A5.1 HUB Pot basket planning", () => {
  it("rotation layout is exactly 13 stocks: 4 native + 9 swap", () => {
    expect(ROTATION_STOCKS.length).to.equal(13);
    expect(SWAP_STOCKS.length).to.equal(9);
    expect(new Set(Object.values(NATIVE_BUCKET_STOCK)).size).to.equal(4);
  });

  it("passes the 4 native basket stocks straight through with no swap", () => {
    const balances: Partial<Record<RotationStock, StockBalance>> = {
      OTC: { units: 1_000n, lamportsPerUnit: 50 },
      CRCLx: { units: 2_000n, lamportsPerUnit: 10 },
      NVDAx: { units: 300n, lamportsPerUnit: 100 },
      SPCXx: { units: 40n, lamportsPerUnit: 900 },
    };
    const plan = planBasketConsolidation(balances);
    expect(plan.passThrough).to.deep.equal({
      otc: 1_000n,
      crclx: 2_000n,
      nvdax: 300n,
      spcxx: 40n,
    });
    expect(plan.stockToSolSwaps).to.have.length(0);
    expect(plan.totalSolLamports).to.equal(0);
  });

  it("swaps only the 9 non-basket stocks to SOL and skips zero/missing balances", () => {
    const balances: Partial<Record<RotationStock, StockBalance>> = {
      AAPLx: { units: 10n, lamportsPerUnit: 1_000_000 },
      MSFTx: { units: 0n, lamportsPerUnit: 1_000_000 }, // zero — skipped
      ANTHROPIC: { units: 5n, lamportsPerUnit: 2_000_000 },
      // AMZNx, OPENAI, POLYMARKET, KALSHI, NEURALINK, ANDURIL omitted entirely — skipped
    };
    const plan = planBasketConsolidation(balances);
    expect(plan.stockToSolSwaps).to.have.length(2);
    expect(plan.stockToSolSwaps.map((s) => s.stock)).to.deep.equal(["AAPLx", "ANTHROPIC"]);
    const expectedTotal = 10 * 1_000_000 + 5 * 2_000_000;
    expect(plan.totalSolLamports).to.equal(expectedTotal);
  });

  it("splits swap-derived SOL evenly 25/25/25/25 across the 4 buckets, floor division", () => {
    const balances: Partial<Record<RotationStock, StockBalance>> = {
      AAPLx: { units: 1n, lamportsPerUnit: 101 }, // 101 lamports total, not divisible by 4
    };
    const plan = planBasketConsolidation(balances);
    expect(plan.totalSolLamports).to.equal(101);
    for (const b of BUCKETS) {
      expect(plan.bucketSolLamports[b]).to.equal(25); // floor(101/4)
    }
  });

  it("combines pass-through units and swap-derived SOL budgets in the same plan", () => {
    const balances: Partial<Record<RotationStock, StockBalance>> = {
      OTC: { units: 500n, lamportsPerUnit: 50 },
      AAPLx: { units: 2n, lamportsPerUnit: 1_000 },
    };
    const plan = planBasketConsolidation(balances);
    expect(plan.passThrough.otc).to.equal(500n);
    expect(plan.totalSolLamports).to.equal(2_000);
    expect(hasAnythingToFund(plan)).to.equal(true);
  });

  it("hasAnythingToFund is false for an all-zero/empty snapshot", () => {
    expect(hasAnythingToFund(planBasketConsolidation({}))).to.equal(false);
    const allZero: Partial<Record<RotationStock, StockBalance>> = {
      OTC: { units: 0n, lamportsPerUnit: 50 },
      AAPLx: { units: 0n, lamportsPerUnit: 1_000 },
    };
    expect(hasAnythingToFund(planBasketConsolidation(allZero))).to.equal(false);
  });
});
