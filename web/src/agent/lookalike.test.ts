import { describe, expect, it } from "vitest";
import { findLookalikes } from "./lookalike";

// Wallet 2 (docs/TEST_NOTES.md) and a poisoned copy: same first 4 and last 4 hex, different middle.
const real = "0x5B2d9c0F45AEf4AB45574aD8BCc7C7B1AB03304A";
const poisoned = "0x5b2d" + "0".repeat(32) + "304a";

describe("findLookalikes", () => {
  it("flags same head and tail with a different middle", () => {
    const hits = findLookalikes(poisoned, [real]);
    expect(hits).toHaveLength(1);
    expect(hits[0].pastRecipient).toBe(real);
    expect(hits[0].differsAt.length).toBeGreaterThan(0);
    expect(hits[0].differsAt.every((i) => i >= 4 && i < 36)).toBe(true);
  });
  it("does not flag the same address, in any letter case", () => {
    expect(findLookalikes(real.toLowerCase(), [real])).toEqual([]);
  });
  it("does not flag an unrelated address", () => {
    expect(findLookalikes("0xa99c92E2F1b4368eAFBC335478ac998E011a41fc", [real])).toEqual([]);
  });
  it("does not flag when only the head or only the tail matches", () => {
    expect(findLookalikes("0x5b2d" + "1".repeat(36), [real])).toEqual([]);
    expect(findLookalikes("0x" + "1".repeat(36) + "304a", [real])).toEqual([]);
  });
  it("ignores malformed input", () => {
    expect(findLookalikes("not an address", [real])).toEqual([]);
  });
});
