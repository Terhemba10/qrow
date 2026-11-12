import { describe, expect, it } from "vitest";
import { findLookalikes } from "../agent/lookalike";
import { buildPayload, explainParseError, parsePayload } from "./qrPayload";

const W2 = "0x5B2d9c0F45AEf4AB45574aD8BCc7C7B1AB03304A";
const W2_QOR = "qor1tvkecr694m62k32hftvte378kx4sxvz2qjdd5f";
const T = 9800;

describe("parsePayload (QR rules, docs/PLAN.md)", () => {
  it("accepts a valid request and round-trips the builder", () => {
    const p = buildPayload({ to: W2, token: "fUSD", amountUnits: 12_500_000n, note: "Lunch, thanks!", chainId: T });
    expect(p).toBe("qrow:pay?to=0x5B2d9c0F45AEf4AB45574aD8BCc7C7B1AB03304A&amount=12.5&token=fUSD&note=Lunch%2C%20thanks!&chain=9800&v=1");
    const r = parsePayload(p, T);
    expect(r).toEqual({ ok: true, request: { to: W2, toQor: W2_QOR, amountUnits: 12_500_000n, token: "fUSD", note: "Lunch, thanks!", kind: "qr" } });
  });
  it("accepts fields in any order", () => {
    expect(parsePayload(`qrow:pay?v=1&chain=9800&to=${W2}`, T).ok).toBe(true);
  });
  it("accepts a plain qor1 address (QoreX Receive) as the current network", () => {
    expect(parsePayload(W2_QOR, T)).toEqual({ ok: true, request: { to: W2, toQor: W2_QOR, kind: "address" } });
  });
  it("rejects malformed codes", () => {
    expect(parsePayload("hello", T)).toEqual({ ok: false, error: { code: "scheme" } });
    expect(parsePayload("", T)).toEqual({ ok: false, error: { code: "empty" } });
    expect(parsePayload(`qrow:pay?to=0x1234&chain=9800&v=1`, T)).toEqual({ ok: false, error: { code: "address" } });
  });
  it("rejects wrong or missing versions", () => {
    expect(parsePayload(`qrow:pay?to=${W2}&chain=9800&v=2`, T)).toEqual({ ok: false, error: { code: "version" } });
    expect(explainParseError({ code: "version" })).toBe("Unsupported QR version.");
    expect(parsePayload(`qrow:pay?to=${W2}&chain=9800`, T)).toEqual({ ok: false, error: { code: "missing", field: "v" } });
  });
  it("blocks a mainnet request on testnet without switching", () => {
    const r = parsePayload(`qrow:pay?to=${W2}&chain=9801&v=1`, T);
    expect(r).toEqual({ ok: false, error: { code: "network", theirs: "mainnet", ours: "testnet" } });
    if (!r.ok) expect(explainParseError(r.error)).toBe("This request is for mainnet, you’re on testnet. Qrow won’t switch networks for you.");
    expect(parsePayload(`qrow:pay?to=${W2}&chain=1&v=1`, T)).toEqual({ ok: false, error: { code: "unknown_network", chain: "1" } });
  });
  it("rejects unknown tokens, including a contract address as the token", () => {
    expect(parsePayload(`qrow:pay?to=${W2}&amount=1&token=USDT&chain=9800&v=1`, T)).toEqual({ ok: false, error: { code: "token" } });
    expect(parsePayload(`qrow:pay?to=${W2}&amount=1&token=0x97143B771D34ddb9130b807b135Ae675A5a963CA&chain=9800&v=1`, T)).toEqual({ ok: false, error: { code: "token" } });
  });
  it("rejects too many decimals, zero, negative and exponent amounts", () => {
    expect(parsePayload(`qrow:pay?to=${W2}&amount=1.1234567&token=fUSD&chain=9800&v=1`, T)).toEqual({ ok: false, error: { code: "amount", reason: "decimals" } });
    expect(parsePayload(`qrow:pay?to=${W2}&amount=0.000000001&token=fBTC&chain=9800&v=1`, T)).toEqual({ ok: false, error: { code: "amount", reason: "decimals" } });
    for (const a of ["0", "-1", "1e3"]) expect(parsePayload(`qrow:pay?to=${W2}&amount=${a}&token=QOR&chain=9800&v=1`, T).ok).toBe(false);
    expect(parsePayload(`qrow:pay?to=${W2}&amount=5&chain=9800&v=1`, T)).toEqual({ ok: false, error: { code: "token_required" } });
  });
  it("rejects an overlong note and keeps HTML/script as inert text", () => {
    const long = "x".repeat(141);
    expect(parsePayload(`qrow:pay?to=${W2}&note=${long}&chain=9800&v=1`, T)).toEqual({ ok: false, error: { code: "note_length" } });
    const html = encodeURIComponent('<img src=x onerror=alert(1)><script>alert(2)</script>');
    const r = parsePayload(`qrow:pay?to=${W2}&note=${html}&chain=9800&v=1`, T);
    expect(r.ok && r.request.note).toBe('<img src=x onerror=alert(1)><script>alert(2)</script>'); // returned as a string, rendered as text
    expect(parsePayload(`qrow:pay?to=${W2}&note=%E0%A4%A&chain=9800&v=1`, T)).toEqual({ ok: false, error: { code: "note_encoding" } });
  });
  it("rejects duplicate and unknown fields", () => {
    expect(parsePayload(`qrow:pay?to=${W2}&to=${W2}&chain=9800&v=1`, T)).toEqual({ ok: false, error: { code: "duplicate", field: "to" } });
    expect(parsePayload(`qrow:pay?to=${W2}&chain=9800&v=1&fee=1`, T)).toEqual({ ok: false, error: { code: "unknown_field", field: "fee" } });
    expect(parsePayload(`qrow:pay?chain=9800&v=1`, T)).toEqual({ ok: false, error: { code: "missing", field: "to" } });
  });
  it("a lookalike address in a request still parses, so the agent's scam check can catch it", () => {
    const poisoned = "0x5b2d" + "0".repeat(32) + "304a";
    const r = parsePayload(`qrow:pay?to=${poisoned}&chain=9800&v=1`, T);
    expect(r.ok).toBe(true);
    if (r.ok) expect(findLookalikes(r.request.to, [W2])).toHaveLength(1);
  });
});
