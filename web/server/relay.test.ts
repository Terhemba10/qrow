import { describe, expect, it } from "vitest";
import { mainnetCheckHash, postPathAllowed, restPathAllowed } from "./relay.js";

describe("restPathAllowed", () => {
  it("allows only the read paths the app uses, never traversal", () => {
    expect(restPathAllowed("/cosmos/bank/v1beta1/balances/qor1abc")).toBe(true);
    expect(restPathAllowed("/qorechain/pqc/v1/evm_window/qor1abc?x=1")).toBe(true);
    expect(restPathAllowed("/cosmos/tx/v1beta1/txs?query=a")).toBe(true);
    expect(restPathAllowed("/cosmos/tx/v1beta1/../../node_info")).toBe(false);
    expect(restPathAllowed("/cosmos/bank/%2e%2e/x")).toBe(false);
    expect(restPathAllowed("/cosmos/gov/v1/proposals")).toBe(false);
    expect(restPathAllowed("/")).toBe(false);
  });
});

describe("postPathAllowed", () => {
  it("allows only broadcasting and simulating signed transactions", () => {
    expect(postPathAllowed("/cosmos/tx/v1beta1/txs")).toBe(true);
    expect(postPathAllowed("/cosmos/tx/v1beta1/simulate")).toBe(true);
    expect(postPathAllowed("/cosmos/tx/v1beta1/txs?x=1")).toBe(false);
    expect(postPathAllowed("/cosmos/gov/v1/proposals")).toBe(false);
    expect(postPathAllowed("/cosmos/tx/v1beta1/txs/../x")).toBe(false);
  });
});

describe("mainnetCheckHash", () => {
  it("accepts only an upper-case 64-hex hash, nothing else", () => {
    const h = "4A676D5F2346E9958211407068819C534FBB87164A11273B52F09E2DF7C8E3CD";
    expect(mainnetCheckHash(`/mainnet-check/${h}`)).toBe(h);
    expect(mainnetCheckHash(`/mainnet-check/${h}?path=x`)).toBe(h); // Vercel's rewrite adds a query
    expect(mainnetCheckHash(`/mainnet-check/${h}/x`)).toBeUndefined();
    expect(mainnetCheckHash(`/mainnet-check/${h.toLowerCase()}`)).toBeUndefined();
    expect(mainnetCheckHash("/mainnet-check/../cosmos/bank")).toBeUndefined();
  });
});
