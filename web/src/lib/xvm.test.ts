import { describe, expect, it } from "vitest";
import { withSlot } from "./appKey";
import { crossVmGas, feeQor } from "./xvm";

describe("withSlot", () => {
  it("prefixes the device slot as one byte, as QrowKeys v3 expects", () => {
    expect(withSlot(0, "0xabcd")).toBe("0x00abcd");
    expect(withSlot(7, "0x01")).toBe("0x0701");
  });
});

describe("crossVmGas", () => {
  // Measured on testnet 13 Nov (docs/TEST_NOTES.md): EVM estimate, payload bytes, gas actually used.
  const measured = [
    { what: "launch", evm: 2_232_783n, bytes: 7_400, used: 3_046_787 },
    { what: "claim coin", evm: 468_741n, bytes: 4_760, used: 939_181 },
    { what: "approve", evm: 46_434n, bytes: 68, used: 299_998 },
    { what: "createPayment", evm: 662_816n, bytes: 4_920, used: 1_248_854 },
    { what: "claim payment", evm: 305_351n, bytes: 4_760, used: 719_754 },
  ];
  it("covers every measured transaction without overshooting by more than 60%", () => {
    for (const m of measured) {
      const gas = crossVmGas(m.evm, m.bytes);
      expect(gas, m.what).toBeGreaterThan(m.used);
      expect(gas / m.used, m.what).toBeLessThan(1.6);
    }
  });
  it("prices at the chain minimum of 0.1 uqor per gas", () => {
    expect(feeQor(3_000_000)).toBeCloseTo(0.3);
  });
});
