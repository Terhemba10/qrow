import { describe, expect, it } from "vitest";
import { displayAmount, formatUnitsExact, parseAmount } from "./amount";
import { parseRecipient } from "./address";

describe("parseAmount", () => {
  it("parses exact decimals", () => {
    expect(parseAmount("1", 6)).toEqual({ ok: true, units: 1_000_000n });
    expect(parseAmount("0.000001", 6)).toEqual({ ok: true, units: 1n });
    expect(parseAmount(".5", 18)).toEqual({ ok: true, units: 500_000_000_000_000_000n });
    expect(parseAmount("12.34567891", 8)).toEqual({ ok: true, units: 1_234_567_891n });
  });
  it("rejects bad input", () => {
    expect(parseAmount("", 6)).toEqual({ ok: false, reason: "empty" });
    expect(parseAmount("1e3", 6)).toEqual({ ok: false, reason: "format" });
    expect(parseAmount("-1", 6)).toEqual({ ok: false, reason: "format" });
    expect(parseAmount("1,000", 6)).toEqual({ ok: false, reason: "format" });
    expect(parseAmount("1.", 6)).toEqual({ ok: false, reason: "format" });
    expect(parseAmount("0", 6)).toEqual({ ok: false, reason: "zero" });
    expect(parseAmount("1.1234567", 6)).toEqual({ ok: false, reason: "decimals" });
    expect(parseAmount("0.000000001", 8)).toEqual({ ok: false, reason: "decimals" });
  });
  it("formats without rounding", () => {
    expect(formatUnitsExact(1_234_567_891n, 8)).toBe("12.34567891");
    expect(formatUnitsExact(10n ** 18n, 18)).toBe("1");
    expect(displayAmount(1_234_567_000_000n, 6)).toBe("1,234,567");
  });
});

describe("parseRecipient", () => {
  // Owner's testnet Wallet 2 (docs/TEST_NOTES.md); conversion verified with the SDK.
  const evm = "0x5B2d9c0F45AEf4AB45574aD8BCc7C7B1AB03304A";
  const qor = "qor1tvkecr694m62k32hftvte378kx4sxvz2qjdd5f";
  it("accepts both forms of one account", () => {
    expect(parseRecipient(qor)).toEqual({ ok: true, evm, qor, typed: "qor1" });
    expect(parseRecipient(evm.toLowerCase())).toEqual({ ok: true, evm, qor, typed: "0x" });
    expect(parseRecipient(evm)).toEqual({ ok: true, evm, qor, typed: "0x" });
  });
  it("rejects a bad checksum and junk", () => {
    expect(parseRecipient("0x5B2d9c0F45AEf4AB45574aD8BCc7C7B1AB03304a")).toEqual({ ok: false, reason: "checksum" });
    expect(parseRecipient("hello")).toEqual({ ok: false, reason: "format" });
    expect(parseRecipient("qor1tvkecr694m62k32hftvte378kx4sxvz2qjdd5q")).toEqual({ ok: false, reason: "bech32" });
  });
});
