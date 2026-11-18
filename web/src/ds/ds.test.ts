import { describe, expect, it } from "vitest";
import { formatUnits, shortAddr } from "./primitives";
import { explainTxError } from "./toast";

describe("formatUnits", () => {
  it("formats for people: separators, trimmed decimals, tiny amounts, negatives", () => {
    expect(formatUnits(1_234_567_890n, 6)).toBe("1,234.5678");
    expect(formatUnits(5_000_000n, 6)).toBe("5");
    expect(formatUnits(1n, 18)).toBe("<0.0001");
    expect(formatUnits(-2_500_000n, 6)).toBe("−2.5");
    expect(formatUnits(0n, 6)).toBe("0");
  });
});

describe("shortAddr (AddressChip)", () => {
  it("shows the first 6 and last 4 characters", () => {
    expect(shortAddr("0xD517458c6b083B964342C604D35Be6afC2dCcb37")).toBe("0xD517…cb37");
    expect(shortAddr("qor1tvkecr694m62k32hftvte378kx4sxvz2qjdd5f")).toBe("qor1tv…dd5f");
  });
});

describe("explainTxError: plain English plus one fix", () => {
  it("maps common failures", () => {
    expect(explainTxError(new Error("User rejected the request"))).toEqual({ text: "You cancelled in QoreX. Nothing was sent." });
    expect(explainTxError("insufficient fees; got 10uqor").fix?.to).toBe("/faucet");
    expect(explainTxError("Your EVM window closed").fix?.to).toBe("/help#window");
    expect(explainTxError("execution reverted").text).toMatch(/refused/);
  });
  it("keeps unknown errors, shortened", () => {
    expect(explainTxError("x".repeat(300)).text.length).toBeLessThanOrEqual(141);
  });
});
