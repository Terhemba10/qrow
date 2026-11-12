import { describe, expect, it } from "vitest";
import { restPathAllowed } from "./relay.js";

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
