import { describe, expect, it } from "vitest";
import { debit, idOf, memoFor, memoryStore, parseChat, refund, topUp, balanceOf, verifyTopUp } from "./ai";

const KEY = "a".repeat(64);
const ID = idOf(KEY);
const TREASURY = "qor1treasuryxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const HASH = "AB".repeat(32);
const tx = (over: Partial<{ code: number; memo: string; to: string; amount: string; denom: string }> = {}) =>
  (async () =>
    new Response(
      JSON.stringify({
        tx_response: { code: over.code ?? 0, txhash: HASH },
        tx: { body: { memo: over.memo ?? memoFor(ID), messages: [{ "@type": "/cosmos.bank.v1beta1.MsgSend", from_address: "qor1user", to_address: over.to ?? TREASURY, amount: [{ denom: over.denom ?? "uqor", amount: over.amount ?? "3000000" }] }] } },
      }),
    )) as unknown as typeof fetch;

describe("AI credits", () => {
  it("credits a valid QoreX payment once", async () => {
    const s = memoryStore();
    const r = await topUp(s, HASH, ID, TREASURY, tx());
    expect(r).toMatchObject({ ok: true, credited: 3_000_000n, balance: 3_000_000n });
    expect(await topUp(s, HASH, ID, TREASURY, tx())).toMatchObject({ ok: false, reason: "already_used" });
  });
  it("refuses a payment with someone else's memo, wrong recipient, failed tx or other denom", async () => {
    expect(await verifyTopUp(HASH, ID, TREASURY, tx({ memo: memoFor(idOf("b".repeat(64))) }))).toMatchObject({ reason: "wrong_memo" });
    expect(await verifyTopUp(HASH, ID, TREASURY, tx({ to: "qor1other" }))).toMatchObject({ reason: "no_payment" });
    expect(await verifyTopUp(HASH, ID, TREASURY, tx({ code: 5 }))).toMatchObject({ reason: "tx_failed" });
    expect(await verifyTopUp(HASH, ID, TREASURY, tx({ denom: "erc20:0xabc" }))).toMatchObject({ reason: "no_payment" });
    expect(await verifyTopUp("nothex", ID, TREASURY, tx())).toMatchObject({ reason: "bad_hash" });
  });
  it("never lets a balance go negative, and refunds", async () => {
    const s = memoryStore();
    await topUp(s, HASH, ID, TREASURY, tx({ amount: "1000000" }));
    expect(await debit(s, ID, 500_000n)).toBe(true);
    expect(await debit(s, ID, 3_000_000n)).toBe(false);
    expect(await balanceOf(s, ID)).toBe(500_000n);
    await refund(s, ID, 500_000n);
    expect(await balanceOf(s, ID)).toBe(1_000_000n);
  });
  it("validates chat input", () => {
    expect(parseChat([{ role: "user", content: "hi" }])).toHaveLength(1);
    expect(parseChat([{ role: "assistant", content: "hi" }])).toBeUndefined();
    expect(parseChat([{ role: "system", content: "x" }])).toBeUndefined();
    expect(parseChat([{ role: "user", content: "x".repeat(2001) }])).toBeUndefined();
  });
});
