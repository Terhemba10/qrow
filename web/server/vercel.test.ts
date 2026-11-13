import { describe, expect, it } from "vitest";
import { rewrittenPath } from "./vercel.js";

describe("rewrittenPath", () => {
  it("rebuilds the original path and query from Vercel's rewrite", () => {
    expect(rewrittenPath("/api/agent?p=health")).toBe("/health");
    expect(rewrittenPath("/api/agent?p=market/news")).toBe("/market/news");
    expect(rewrittenPath("/api/agent?p=referrals/qor1abc")).toBe("/referrals/qor1abc");
    expect(rewrittenPath("/api/lcd?p=cosmos/tx/v1beta1/txs&query=a%3D%27b%27&pagination.limit=1")).toBe("/cosmos/tx/v1beta1/txs?query=a%3D%27b%27&pagination.limit=1");
    expect(rewrittenPath("/api/lcd?p=cosmos%2Ftx%2Fv1beta1%2Ftxs")).toBe("/cosmos/tx/v1beta1/txs");
    // POSTs can arrive with the original URL
    expect(rewrittenPath("/lcd-testnet/cosmos/tx/v1beta1/txs")).toBe("/cosmos/tx/v1beta1/txs");
    expect(rewrittenPath("/agent/explain")).toBe("/explain");
    expect(rewrittenPath("/lcd-testnet-evil/x")).toBe("/lcd-testnet-evil/x");
  });
});
