import { describe, expect, it } from "vitest";
import { toHex } from "viem";
import { encodeConvertCoin, encodeConvertErc20 } from "./convert";

describe("convert message encoding (cosmos.evm.erc20.v1)", () => {
  it("MsgConvertCoin: coin{denom=1, amount=2} = 1, receiver = 2, sender = 3", () => {
    // 0a 06 [0a 01 'a' 12 01 '1']  12 01 'r'  1a 01 's'
    expect(toHex(encodeConvertCoin({ coin: { denom: "a", amount: "1" }, receiver: "r", sender: "s" }))).toBe("0x0a060a01611201311201721a0173");
  });
  it("MsgConvertERC20: contract = 1, amount = 2, receiver = 3, sender = 4", () => {
    // 0a 01 'c'  12 01 '5'  1a 01 'r'  22 01 's'
    expect(toHex(encodeConvertErc20({ contract: "c", amount: "5", receiver: "r", sender: "s" }))).toBe("0x0a01631201351a01722201" + "73");
  });
});
