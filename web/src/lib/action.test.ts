import { describe, expect, it } from "vitest";
import { qorexRefusal } from "./action";

describe("qorexRefusal", () => {
  it("does not mistake a message type containing 'pqc' for a missing key (owner's demo run)", () => {
    expect(qorexRefusal("QoreX cannot show what /qorechain.pqc.v1.MsgOpenEVMWindow does, so it will not sign it")).toBe("cannot-show");
  });
  it("recognises cancels and a real missing key", () => {
    expect(qorexRefusal("User rejected the request")).toBe("cancelled");
    expect(qorexRefusal("PQC key not registered for this account")).toBe("no-key");
    expect(qorexRefusal("account qor1… not registered")).toBe("no-key");
    expect(qorexRefusal("network error")).toBe("other");
  });
});
