import { describe, expect, it } from "vitest";
import { looksLikeFaucet, received } from "./faucet";

const FUSD = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const FETH = "erc20:0x02292293c13880a26242690eb70a0e42B8E91c28";
const FBTC = "erc20:0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A";

describe("looksLikeFaucet", () => {
  it("recognises the 100 QOR payment and the fest-token bundle, nothing else", () => {
    expect(looksLikeFaucet("100000000uqor")).toBe(true);
    expect(looksLikeFaucet(`1000000000${FUSD},500000000000000000${FETH},2000000${FBTC}`)).toBe(true);
    expect(looksLikeFaucet("100000uqor")).toBe(false); // a 0.1 QOR transfer from a friend
    expect(looksLikeFaucet(`1000000000${FUSD}`)).toBe(false); // fUSD alone
    expect(looksLikeFaucet("561uqor")).toBe(false); // a fee refund
  });
});

describe("received", () => {
  it("reports only increases, per coin, with its decimals", () => {
    const base = { uqor: 5_000_000n, [FUSD]: 0n, [FETH]: 0n, [FBTC]: 0n };
    const now = { uqor: 104_000_000n, [FUSD]: 1_000_000_000n, [FETH]: 0n, [FBTC]: 2_000_000n };
    expect(received(base, now)).toEqual([
      { symbol: "QOR", units: 99_000_000n, decimals: 6 },
      { symbol: "fUSD", units: 1_000_000_000n, decimals: 6 },
      { symbol: "fBTC", units: 2_000_000n, decimals: 8 },
    ]);
    expect(received(now, base)).toEqual([]); // spending isn't "received"
  });
});
