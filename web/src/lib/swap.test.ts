import { describe, expect, it } from "vitest";
import { maxSwappable, minReceived, partnersOf, poolFor, quoteErrorText, SWAP_COINS, swapFromEvents, swapProblems, usablePools } from "./swap";

const FUSD = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const FETH = "erc20:0x02292293c13880a26242690eb70a0e42B8E91c28";
const FBTC = "erc20:0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A";
const [QOR, fUSD] = SWAP_COINS;

// The live pools on 13 Nov (pool 5 empty; a pool with an unknown coin must be ignored).
const RAW = [
  { id: "1", token_a: FETH, token_b: "uqor", reserve_a: "979173", reserve_b: "1021318", status: "active" },
  { id: "2", token_a: FUSD, token_b: "uqor", reserve_a: "601095260", reserve_b: "5989113819", status: "active" },
  { id: "3", token_a: FETH, token_b: FUSD, reserve_a: "150000000000000000", reserve_b: "338170000", status: "active" },
  { id: "5", token_a: FBTC, token_b: FUSD, reserve_a: "0", reserve_b: "0", status: "active" },
  { id: "9", token_a: "erc20:0x000000000000000000000000000000000000dEaD", token_b: "uqor", reserve_a: "5", reserve_b: "5", status: "active" },
  { id: "8", token_a: FBTC, token_b: "uqor", reserve_a: "10", reserve_b: "10", status: "paused" },
];

describe("pools", () => {
  const pools = usablePools(RAW);
  it("keeps only active, funded pools of configured coins", () => {
    expect(pools.map((p) => p.id)).toEqual(["1", "2", "3"]);
  });
  it("finds the direct pool in either direction, case-insensitively", () => {
    expect(poolFor(pools, "uqor", FUSD)?.id).toBe("2");
    expect(poolFor(pools, FUSD.toLowerCase(), "uqor")?.id).toBe("2");
    expect(poolFor(pools, FBTC, FUSD)).toBeUndefined(); // empty pool
  });
  it("lists only coins with a direct pool", () => {
    expect(partnersOf(pools, "uqor").map((c) => c.symbol)).toEqual(["fUSD", "fETH"]);
    expect(partnersOf(pools, FBTC)).toEqual([]);
  });
});

describe("amounts", () => {
  it("rounds the minimum down and never above the quote", () => {
    expect(minReceived(100_046n, 50)).toBe(99_545n);
    expect(minReceived(1n, 50)).toBe(0n);
  });
  it("keeps 0.1 QOR for the fee on Max", () => {
    expect(maxSwappable(QOR, 5_000_000n)).toBe(4_900_000n);
    expect(maxSwappable(QOR, 50_000n)).toBe(0n);
    expect(maxSwappable(fUSD, 7n)).toBe(7n);
  });
});

describe("swapProblems", () => {
  const quote = { amountOut: 100_046n, fee: 3_000n, impactBps: 2 };
  it("passes a normal swap", () => {
    expect(swapProblems({ coinIn: QOR, amountIn: 1_000_000n, balanceIn: 5_000_000n, balanceQor: 5_000_000n, quote, slippageBps: 50 })).toEqual([]);
  });
  it("blocks what the chain would refuse", () => {
    const ids = (a: Parameters<typeof swapProblems>[0]) => swapProblems(a).map((p) => p.id);
    expect(ids({ coinIn: QOR, amountIn: 6_000_000n, balanceIn: 5_000_000n, balanceQor: 5_000_000n, quote, slippageBps: 50 })).toEqual(["balance"]);
    expect(ids({ coinIn: QOR, amountIn: 4_950_000n, balanceIn: 5_000_000n, balanceQor: 5_000_000n, quote, slippageBps: 50 })).toEqual(["fee"]);
    expect(ids({ coinIn: fUSD, amountIn: 1n, balanceIn: 9n, balanceQor: 0n, quote, slippageBps: 50 })).toEqual(["fee"]);
    expect(ids({ coinIn: QOR, amountIn: 1_000_000n, balanceIn: 5_000_000n, balanceQor: 5_000_000n, quote: { ...quote, impactBps: 501 }, slippageBps: 50 })).toEqual(["impact"]);
    expect(ids({ coinIn: QOR, amountIn: 10n, balanceIn: 5_000_000n, balanceQor: 5_000_000n, quote: { amountOut: 0n, fee: 0n, impactBps: 0 }, slippageBps: 50 })).toEqual(["tiny"]);
  });
});

describe("quoteErrorText", () => {
  it("explains the chain's impact refusal", () => {
    expect(quoteErrorText("impact 625 bps over the pool price, cap 500 bps: swap price impact exceeds max_swap_impact_bps", 500)).toBe(
      "This trade would move the pool price by 6.25%. The chain refuses anything above 5%: try a smaller amount.",
    );
  });
});

describe("swapFromEvents", () => {
  it("reads what the chain actually swapped", () => {
    const ev = [{ type: "amm_swap", attributes: [{ key: "amount_in", value: "10000" }, { key: "amount_out", value: "1000" }] }];
    expect(swapFromEvents(ev)).toEqual({ amountIn: 10_000n, amountOut: 1_000n });
    expect(swapFromEvents([])).toBeUndefined();
  });
});
