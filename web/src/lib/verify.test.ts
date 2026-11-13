import { encodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import { qrowKeysAbi } from "../abi/QrowKeys";
import { KEYS } from "../config/contracts";
import { describeCall, describeNative, nftRef, parseVerifyInput, paymentRef } from "./verify";

const H = "4A676D5F2346E9958211407068819C534FBB87164A11273B52F09E2DF7C8E3CD";
const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";

describe("parseVerifyInput", () => {
  it("accepts hashes in every shape people paste", () => {
    expect(parseVerifyInput(H)).toEqual({ kind: "hash", hash: H });
    expect(parseVerifyInput(` 0x${H.toLowerCase()} `)).toEqual({ kind: "hash", hash: H });
    expect(parseVerifyInput(`https://explore.qore.network/tx/${H}`)).toEqual({ kind: "hash", hash: H });
  });
  it("accepts Qrow references", () => {
    expect(parseVerifyInput("QRW-PAY-000002")).toEqual({ kind: "payment", id: 2n });
    expect(parseVerifyInput("qrw-nft-45")).toEqual({ kind: "nft", id: 45n });
    expect(paymentRef(123n)).toBe("QRW-PAY-000123");
    expect(nftRef(45)).toBe("QRW-NFT-000045");
  });
  it("explains malformed input", () => {
    expect(parseVerifyInput(H.slice(0, 60)).kind).toBe("malformed");
    expect(parseVerifyInput("qor1tvkecr694m62k32hftvte378kx4sxvz2qjdd5f").kind).toBe("malformed");
    expect(parseVerifyInput("QRW-SWP-1").kind).toBe("malformed");
    expect(parseVerifyInput("hello").kind).toBe("malformed");
  });
});

describe("describeCall", () => {
  it("names Qrow contract actions and token calls", () => {
    const data = encodeFunctionData({ abi: qrowKeysAbi, functionName: "removeDevice", args: [1] as never });
    expect(describeCall(KEYS, data)).toMatchObject({ qrow: true, contract: "Qrow device keys", action: "Remove a device key" });
    const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [KEYS, 0n] });
    expect(describeCall(FUSD, approve)).toMatchObject({ qrow: false, contract: "fUSD token", action: "Allow a contract to use a token" });
  });
});

describe("describeNative", () => {
  it("reads a device-run Qrow call with its quantum-safe signature", () => {
    const payload = btoa(String.fromCharCode(...Buffer.from(encodeFunctionData({ abi: qrowKeysAbi, functionName: "removeDevice", args: [1] as never }).slice(2), "hex")));
    const r = describeNative({
      hash: H,
      code: 0,
      height: 10,
      time: "2026-11-13T09:26:26Z",
      gasUsed: 1,
      rawLog: "",
      events: [{ type: "pqc_hybrid_verify", attributes: [{ key: "address", value: "qor1device" }, { key: "algorithm_id", value: "dilithium5" }, { key: "status", value: "verified" }] }],
      body: {
        memo: "",
        messages: [{ "@type": "/cosmos.authz.v1beta1.MsgExec", grantee: "qor1device", msgs: [{ "@type": "/qorechain.crossvm.v1.MsgCrossVMCall", sender: "qor1user", target_contract: KEYS, payload }] }],
      },
    });
    expect(r.qrow).toBe(true);
    expect(r.signer).toBe("qor1device");
    expect(r.quantumSafe).toEqual({ algorithm: "ML-DSA-87 (Dilithium5)", verified: true });
    expect(r.steps[0]).toMatchObject({ title: "Remove a device key", asUser: "qor1user" });
  });
});
