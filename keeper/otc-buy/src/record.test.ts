import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { utils } from "@anchor-lang/core";
import { findUnresolvedSwap, signatureToBuyTx } from "./record";
import type { JournalEntry } from "../../shared/src/journal";

const fakeSignature = () => utils.bytes.bs58.encode(Keypair.generate().secretKey); // 64 raw bytes

const base = { ts: "2025-01-01T00:00:00.000Z", service: "otc-buy" as const };

describe("keeper/otc-buy record", () => {
  describe("signatureToBuyTx", () => {
    it("round-trips a 64-byte signature into a plain byte array", () => {
      const raw = Keypair.generate().secretKey; // 64 bytes, same width as a real tx signature
      const sig = utils.bytes.bs58.encode(raw);
      expect(signatureToBuyTx(sig)).to.deep.equal(Array.from(raw));
    });

    it("throws on a signature that doesn't decode to exactly 64 bytes", () => {
      expect(() => signatureToBuyTx(utils.bytes.bs58.encode(Buffer.from([1, 2, 3])))).to.throw(/64-byte/);
    });
  });

  describe("findUnresolvedSwap", () => {
    it("returns null on an empty journal", () => {
      expect(findUnresolvedSwap([])).to.equal(null);
    });

    it("returns null when the newest otc-buy entry is a confirmed `sent`", () => {
      const entries: JournalEntry[] = [
        { ...base, status: "sent", detail: "recorded", signature: fakeSignature() },
      ];
      expect(findUnresolvedSwap(entries)).to.equal(null);
    });

    it("resumes from a `swap-sent` entry with no later resolution", () => {
      const sig = fakeSignature();
      const entries: JournalEntry[] = [
        { ...base, status: "swap-sent", detail: "swapped", signature: sig, meta: { otcBought: "123", lamportsSpent: "456" } },
      ];
      expect(findUnresolvedSwap(entries)).to.deep.equal({ otcBought: 123n, lamportsSpent: 456n, signature: sig });
    });

    it("resumes from a `confirm-error` entry, recovering the original swap signature from meta", () => {
      const swapSig = fakeSignature();
      const entries: JournalEntry[] = [
        { ...base, status: "swap-sent", detail: "swapped", signature: swapSig, meta: { otcBought: "10", lamportsSpent: "20" } },
        {
          ...base,
          status: "confirm-error",
          detail: "record_otc_buy failed",
          error: "boom",
          meta: { otcBought: "10", lamportsSpent: "20", swapSignature: swapSig },
        },
      ];
      expect(findUnresolvedSwap(entries)).to.deep.equal({ otcBought: 10n, lamportsSpent: 20n, signature: swapSig });
    });

    it("ignores entries from other services", () => {
      const entries: JournalEntry[] = [
        { ts: base.ts, service: "creator-fee", status: "sent", detail: "unrelated", signature: fakeSignature() },
      ];
      expect(findUnresolvedSwap(entries)).to.equal(null);
    });

    it("returns null after a plain `error` (swap itself failed) — nothing landed to resume", () => {
      const entries: JournalEntry[] = [
        { ...base, status: "error", detail: "Jupiter swap failed", error: "no route" },
      ];
      expect(findUnresolvedSwap(entries)).to.equal(null);
    });

    it("returns null on a malformed swap-sent entry missing meta", () => {
      const entries: JournalEntry[] = [
        { ...base, status: "swap-sent", detail: "swapped", signature: fakeSignature() },
      ];
      expect(findUnresolvedSwap(entries)).to.equal(null);
    });
  });
});
