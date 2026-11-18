import { describe, expect, it } from "vitest";
import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getPrices, pairId, qorFromPool, reportHash, signReport, toE8 } from "./price";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const PERPS = "0x1111111111111111111111111111111111111111" as const;

describe("price service", () => {
  it("parses decimal prices to 1e8 without floats", () => {
    expect(toE8("1766.96000000")).toBe(176_696_000_000n);
    expect(toE8("0.1")).toBe(10_000_000n);
    expect(() => toE8("1e5")).toThrow();
  });
  it("prices QOR from the testnet QOR/fUSD pool", () => {
    const pools = [{ token_a: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA", token_b: "uqor", reserve_a: "537041010", reserve_b: "8445449851", status: "active" }];
    expect(qorFromPool(pools)).toBe((537041010n * 10n ** 8n) / 8445449851n);
  });
  it("derives QOR/ETH and QOR/SOL and reads Binance", async () => {
    const fake = (async (url: string) => {
      if (url.includes("binance")) return new Response(JSON.stringify([{ symbol: "ETHUSDT", price: "2000" }, { symbol: "SOLUSDT", price: "100" }, { symbol: "BNBUSDT", price: "500" }]));
      return new Response(JSON.stringify({ pools: [{ token_a: "uqor", token_b: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA", reserve_a: "1000000", reserve_b: "2000000", status: "active" }] }));
    }) as unknown as typeof fetch;
    const p = await getPrices(fake, 1);
    expect(p.prices["QOR/USDT"]).toBe(200_000_000n); // 2 fUSD
    expect(p.prices["QOR/ETH"]).toBe(100_000n); // 0.001 ETH
    expect(p.prices["QOR/SOL"]).toBe(2_000_000n); // 0.02 SOL
  });
  it("signs reports QrowPerps can verify (EIP-191 over reportHash)", async () => {
    const r = await signReport("ETH/USDT", 300_000_000_000n, PERPS, KEY, 1_800_000_000);
    const who = await recoverMessageAddress({ message: { raw: reportHash(PERPS, pairId("ETH/USDT"), 300_000_000_000n, 1_800_000_000n) }, signature: r.signature });
    expect(who).toBe(privateKeyToAccount(KEY).address);
    expect(r.pair).toBe(pairId("ETH/USDT"));
  });
});
