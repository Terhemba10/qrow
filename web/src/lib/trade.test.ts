import { describe, expect, it } from "vitest";
import { limitFor, pnlAt, quotePerp } from "./trade";

const U = 1_000_000n;
const P = 3000n * 100_000_000n;

describe("perp maths (mirrors QrowPerps)", () => {
  it("10x long: size, fee and a liquidation price about 9.5% below entry", () => {
    const q = quotePerp(P, 100n * U, 10, true);
    expect(q.size).toBe(1000n * U);
    expect(q.fee).toBe(500_000n);
    expect(q.liqPrice).toBeLessThan(P);
    expect(Number(P - q.liqPrice) / Number(P)).toBeCloseTo(0.0945, 3);
  });
  it("100x short liquidates under 1% above entry", () => {
    const q = quotePerp(P, 100n * U, 100, false);
    expect(q.liqPrice).toBeGreaterThan(P);
    expect(Number(q.liqPrice - P) / Number(P)).toBeLessThan(0.01);
  });
  it("PnL sign follows the side", () => {
    expect(pnlAt(1000n * U, P, (P * 11n) / 10n, true)).toBe(100n * U);
    expect(pnlAt(1000n * U, P, (P * 11n) / 10n, false)).toBe(-100n * U);
  });
  it("price protection: worse fills are refused", () => {
    expect(limitFor(P, true, true)).toBe((P * 10_100n) / 10_000n); // long open: at most +1%
    expect(limitFor(P, true, false)).toBe((P * 9_900n) / 10_000n); // long close: at least -1%
    expect(limitFor(P, false, true)).toBe((P * 9_900n) / 10_000n);
  });
});
