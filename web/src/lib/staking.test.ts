import { describe, expect, it } from "vitest";
import { captureReferral, earlyUnlockQuote, REF_MEMO, storedReferral, type Lock } from "./staking";

const lock: Lock = { id: "7", validator: "qorvaloper1x", amount: 100_000_000n, months: 12, bonusBps: 500, startTime: 1_800_000_000, endTime: 1_800_000_000 + 365 * 86_400, accruedBonus: 1_234_567n, released: false };

describe("earlyUnlockQuote (chain params: 500 bps burn)", () => {
  it("burns 5%, forfeits the accrued bonus and counts days staked", () => {
    const q = earlyUnlockQuote(lock, 500, lock.startTime + 40 * 86_400 + 3_600);
    expect(q.penalty).toBe(5_000_000n); // 5 of 100 QOR
    expect(q.keep).toBe(95_000_000n);
    expect(q.bonusForfeited).toBe(1_234_567n);
    expect(q.daysStaked).toBe(40);
    expect(q.daysTotal).toBe(365);
  });
});

describe("referrals (tracking only)", () => {
  it("builds the memo tag and ignores self-referral", () => {
    expect(REF_MEMO("qor1abc")).toBe("qrow-ref:qor1abc");
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const ref = "qor1tvkecr694m62k32hftvte378kx4sxvz2qjdd5f";
    captureReferral(`?ref=${ref}`, ref);
    expect(storedReferral()).toBeUndefined();
    captureReferral(`?ref=${ref}`, "qor1someoneelse");
    expect(storedReferral()).toBe(ref);
  });
});
