import { describe, expect, it } from "vitest";
import { clockAlerts, ESCROW, eventAlerts, footer } from "./alerts.js";

const p = { id: 7n, sender: "0xD517458c6b083B964342C604D35Be6afC2dCcb37", recipient: "0x5B2d9c0F45AEf4AB45574aD8BCc7C7B1AB03304A", amount: "0.5 QOR", deadline: 1_800_604_800 };
const created = p.deadline - 7 * 86_400;

describe("eventAlerts", () => {
  it("sends both parties a created alert with tx, escrow and explorer link", () => {
    const [s, r] = eventAlerts("created", p, "0xabc", "2CDE");
    expect(s.to).toBe(p.sender);
    expect(r.to).toBe(p.recipient);
    expect(r.text).toContain("waiting for you");
    for (const a of [s, r]) {
      expect(a.text).toContain(`Escrow: ${ESCROW}`);
      expect(a.text).toContain("Tx: 0xabc");
      expect(a.text).toContain("https://explore.qore.network/tx/2CDE");
    }
  });
  it("covers every event kind with distinct idempotency keys", () => {
    const kinds = ["claimed", "released", "cancelled", "refunded"] as const;
    const keys = kinds.flatMap((k) => eventAlerts(k, p, "0x1").map((a) => a.key));
    expect(new Set(keys).size).toBe(keys.length);
    expect(eventAlerts("notified", p, "0x1")[0].to).toBe(p.sender);
    expect(eventAlerts("failure", p, "0x1", undefined, "BadPqSignature")[0].text).toContain("failed: BadPqSignature");
  });
  it("falls back to the escrow page when the Cosmos hash is unknown", () => {
    expect(footer("0x1", undefined)).toContain(`/address/${ESCROW}`);
  });
});

describe("clockAlerts", () => {
  it("is quiet in the first 5 days", () => {
    expect(clockAlerts(p, created, created + 4 * 86_400)).toEqual([]);
  });
  it("reminds the sender on day 5 and the receiver 24 h before expiry", () => {
    expect(clockAlerts(p, created, created + 5 * 86_400 + 1).map((a) => a.kind)).toEqual(["reminder_day5"]);
    const late = clockAlerts(p, created, p.deadline - 3_600).map((a) => a.kind);
    expect(late).toEqual(["reminder_day5", "expiry_24h"]);
  });
  it("flags an overdue refund an hour after the deadline", () => {
    expect(clockAlerts(p, created, p.deadline + 60)).toEqual([]);
    const o = clockAlerts(p, created, p.deadline + 3_601);
    expect(o.map((a) => a.kind)).toEqual(["refund_overdue"]);
    expect(o[0].to).toBe(p.sender);
  });
});
