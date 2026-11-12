import { describe, expect, it } from "vitest";
import { evmToQor, isValidRecoveryCode, pqcKeyFromRecoveryCode } from "@qorechain/sdk";
import { toHex } from "viem";
import { newAppKeyCode } from "./appKey";

describe("newAppKeyCode", () => {
  it("makes a valid QRC1 code whose key is bound to the account (the contracts' 2,592-byte ML-DSA-87 key)", () => {
    const a = "0xdBA1B390218aF72ACFD5E262850C90c079F0e78d" as const;
    const b = "0xD517458c6b083B964342C604D35Be6afC2dCcb37" as const;
    const { code, publicKey } = newAppKeyCode(a);
    expect(isValidRecoveryCode(code)).toBe(true);
    expect((publicKey.length - 2) / 2).toBe(2592);
    expect(toHex(pqcKeyFromRecoveryCode(code, evmToQor(a)).publicKey)).toBe(publicKey);
    // The same code gives a different key for another account, so a code can't be reused across accounts.
    expect(toHex(pqcKeyFromRecoveryCode(code, evmToQor(b)).publicKey)).not.toBe(publicKey);
    expect(newAppKeyCode(a).code).not.toBe(code);
  });
});
