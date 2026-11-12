import { describe, expect, it } from "vitest";
import { marketChecks } from "./marketChecks";

const fmt = (u: bigint) => `${u} wei`;
const me = "0xD517458c6b083B964342C604D35Be6afC2dCcb37";
const known = "0x5B2d9c0F45AEf4AB45574aD8BCc7C7B1AB03304A";
const base = { me, pastCounterparties: [known], fmt };
const lv = (rs: ReturnType<typeof marketChecks>, id: string) => rs.find((r) => r.id === id)?.level;

describe("marketChecks", () => {
  it("warns a buyer when the price is over 3x the floor", () => {
    expect(lv(marketChecks({ ...base, side: "buy", price: 31n, floor: 10n, counterparty: known }), "floor")).toBe("warn");
    expect(lv(marketChecks({ ...base, side: "buy", price: 30n, floor: 10n, counterparty: known }), "floor")).toBe("ok");
  });
  it("warns a seller listing below half the floor", () => {
    expect(lv(marketChecks({ ...base, side: "list", price: 4n, floor: 10n }), "floor")).toBe("warn");
    expect(lv(marketChecks({ ...base, side: "list", price: 5n, floor: 10n }), "floor")).toBe("ok");
  });
  it("flags a lookalike seller and blocks buying your own listing", () => {
    const poisoned = "0x5b2d" + "0".repeat(32) + "304a";
    expect(lv(marketChecks({ ...base, side: "buy", price: 1n, floor: 1n, counterparty: poisoned }), "seller")).toBe("danger");
    expect(lv(marketChecks({ ...base, side: "buy", price: 1n, floor: 1n, counterparty: me }), "seller")).toBe("block");
  });
  it("blocks when the buyer can't pay, and when the price is zero", () => {
    expect(lv(marketChecks({ ...base, side: "buy", price: 5n, floor: 5n, counterparty: known, balance: 4n }), "balance")).toBe("block");
    expect(lv(marketChecks({ ...base, side: "list", price: 0n, floor: undefined }), "price")).toBe("block");
  });
});
