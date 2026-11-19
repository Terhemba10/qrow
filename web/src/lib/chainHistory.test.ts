import { describe as group, expect, it } from "vitest";
import { describe, contractName } from "./chainHistory";
import { GENESIS } from "../config/contracts";

const me = "qor1tvkecr694m62k32hftvte378kx4sxvz2qjdd5f";
const tx = (messages: object[], events: object[] = []) => ({ txhash: "AB", timestamp: "2026-11-18T23:51:34Z", code: 0, tx: { body: { messages } }, events }) as never;

group("chain history wording", () => {
  it("names a contract action by its contract", () => {
    const r = describe(tx([{ "@type": "/cosmos.authz.v1beta1.MsgExec" }], [{ type: "crossvm_request", attributes: [{ key: "target_contract", value: GENESIS }] }]), me);
    expect(r).toEqual({ kind: "Contract action", what: "Qrow Genesis NFTs" });
  });
  it("describes swaps, staking, approvals and transfers", () => {
    expect(describe(tx([{ "@type": "/qorechain.amm.v1.MsgSwapExactIn" }]), me).kind).toBe("Swap");
    expect(describe(tx([{ "@type": "/cosmos.staking.v1beta1.MsgDelegate", amount: { denom: "uqor", amount: "10000000" } }]), me).what).toBe("Staked 10 QOR");
    expect(describe(tx([{ "@type": "/cosmos.authz.v1beta1.MsgGrant" }]), me).what).toBe("Approved one Qrow action in QoreX");
    expect(describe(tx([{ "@type": "/cosmos.bank.v1beta1.MsgSend", from_address: me, to_address: "qor1kkkytv23u0", amount: [{ denom: "uqor", amount: "500000" }] }]), me).what).toBe("Sent 0.5 QOR to qor1kkkytv…");
  });
  it("labels unknown contracts by address", () => {
    expect(contractName("0x1234567890abcdef1234567890abcdef12345678")).toBe("contract 0x123456…5678");
  });
});
