import { describe, expect, it } from "vitest";
import { quoteBuy, quoteSell, withSlippage, yesPriceE6 } from "./predict";

const U = 1_000_000n;

describe("prediction market maths (mirrors QrowPredict)", () => {
  it("starts at 50% and a YES buy raises the YES price", () => {
    expect(yesPriceE6(100n * U, 100n * U)).toBe(500_000n);
    const shares = quoteBuy(100n * U, 100n * U, true, 10n * U);
    // After the buy: no pool +net, yes pool = ceil(k / newNo).
    const net = 10n * U - (10n * U) / 100n;
    const newNo = 100n * U + net;
    const newYes = (100n * U * 100n * U + newNo - 1n) / newNo;
    expect(shares).toBe(100n * U + net - newYes);
    expect(yesPriceE6(newYes, newNo)).toBeGreaterThan(500_000n);
  });
  it("buy then sell returns a bit less than spent (two 1% fees)", () => {
    const shares = quoteBuy(100n * U, 100n * U, true, 20n * U);
    const net = 20n * U - (20n * U) / 100n;
    const newNo = 100n * U + net;
    const newYes = (100n * U * 100n * U + newNo - 1n) / newNo;
    const out = quoteSell(newYes, newNo, true, shares);
    expect(out).toBeLessThan(20n * U);
    expect(out).toBeGreaterThan(19n * U);
  });
  it("applies slippage", () => {
    expect(withSlippage(10_000n)).toBe(9_800n);
  });
});
