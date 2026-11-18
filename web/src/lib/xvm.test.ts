import { afterEach, describe, expect, it, vi } from "vitest";
import { readWindow, windowCovers } from "./xvm";

afterEach(() => vi.unstubAllGlobals());

describe("readWindow / windowCovers (a window opened by hand in QoreX)", () => {
  it("reads a QoreX-opened window: any contract, remaining actions, blocks and value", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ live: true, remaining_txs: "100", remaining_blocks: "17000", allowed_targets: [], remaining_value: "20000000uqor" })));
    const w = await readWindow("0x5b2d9c0f45aef4ab45574ad8bcc7c7b1ab03304a");
    expect(w).toMatchObject({ live: true, remainingTxs: 100, remainingBlocks: 17000, remainingValue: 20_000_000n });
    // No contract list = every contract: covers a first-time Create NFT (QrowKeys + QrowEditions, 2 calls).
    expect(windowCovers(w, ["0xa5242cb348eddef0deb9599f81e55a64d186fd14", "0x463e5c38523a0f22264380bc2eeed10615d185c0"], 2)).toBe(true);
  });
  it("treats a closed or used-up window as not covering", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ found: false, live: false, remaining_txs: "0", remaining_blocks: "0", allowed_targets: [], remaining_value: "" })));
    const w = await readWindow("0x5b2d9c0f45aef4ab45574ad8bcc7c7b1ab03304a");
    expect(w.remainingValue).toBeUndefined();
    expect(windowCovers(w, [], 1)).toBe(false);
  });
});
