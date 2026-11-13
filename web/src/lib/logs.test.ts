import { describe, expect, it } from "vitest";
import { blockRanges, getLogsChunked } from "./logs";

describe("blockRanges", () => {
  it("never asks for more than 9,000 blocks and covers the range exactly", () => {
    const r = blockRanges(100n, 20_099n);
    expect(r).toEqual([
      [100n, 9_099n],
      [9_100n, 18_099n],
      [18_100n, 20_099n],
    ]);
    for (const [a, b] of r) expect(b - a + 1n <= 9_000n).toBe(true);
    expect(blockRanges(5n, 5n)).toEqual([[5n, 5n]]);
    expect(blockRanges(6n, 5n)).toEqual([]);
  });
});

describe("getLogsChunked", () => {
  it("returns every window's logs in block order", async () => {
    const got = await getLogsChunked(0n, 25_000n, async (a, b) => [`${a}-${b}`]);
    expect(got).toEqual(["0-8999", "9000-17999", "18000-25000"]);
  });
});
