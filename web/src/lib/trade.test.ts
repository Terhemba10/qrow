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

import { encodeAbiParameters, keccak256 } from "viem";
import { tpSlProblem } from "./trade";

describe("take profit / stop loss checks (mirror QrowPerps._checkTpSl)", () => {
  const liqLong = (P * 90n) / 100n;
  it("long: TP above entry, SL below entry and above liquidation", () => {
    expect(tpSlProblem(true, P, liqLong, (P * 11n) / 10n, (P * 95n) / 100n)).toBeUndefined();
    expect(tpSlProblem(true, P, liqLong, (P * 9n) / 10n, 0n)).toMatch(/above the entry/);
    expect(tpSlProblem(true, P, liqLong, 0n, (P * 105n) / 100n)).toMatch(/below the entry/);
    expect(tpSlProblem(true, P, liqLong, 0n, (P * 80n) / 100n)).toMatch(/liquidation/);
  });
  it("short: the reverse; empty means none", () => {
    expect(tpSlProblem(false, P, (P * 110n) / 100n, (P * 9n) / 10n, (P * 105n) / 100n)).toBeUndefined();
    expect(tpSlProblem(false, P, (P * 110n) / 100n, (P * 11n) / 10n, 0n)).toMatch(/below the entry/);
    expect(tpSlProblem(false, P, (P * 110n) / 100n, 0n, 0n)).toBeUndefined();
  });
  it("hashing the order fields equals hashing the all-static OpenOrder struct (what the contract signs)", () => {
    const vals = ["0x" + "11".repeat(32), true, 10n, 5n, P, P * 2n, P / 2n] as const;
    const fields = keccak256(encodeAbiParameters(["bytes32", "bool", "uint256", "uint256", "uint256", "uint256", "uint256"].map((t) => ({ type: t })), [...vals]));
    const struct = keccak256(
      encodeAbiParameters(
        [{ type: "tuple", components: ["bytes32", "bool", "uint256", "uint256", "uint256", "uint256", "uint256"].map((t, i) => ({ type: t, name: `f${i}` })) }],
        [Object.fromEntries(vals.map((v, i) => [`f${i}`, v]))] as never,
      ),
    );
    expect(fields).toBe(struct);
  });
});
