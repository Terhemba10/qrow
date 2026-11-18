import { describe, expect, it, vi } from "vitest";

describe("qorexAccount: one QoreX connect per session", () => {
  it("asks QoreX to connect once, then reuses the account for every check (no repeated prompts)", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    let connected = false;
    let enables = 0;
    let getKeys = 0;
    const native = {
      enable: async () => {
        enables++;
        connected = true;
      },
      getKey: async () => {
        getKeys++;
        if (!connected) throw new Error("not connected");
        return { bech32Address: "qor1tvkecr694m62k32hftvte378kx4sxvz2qjdd5f" };
      },
      signAndBroadcast: async () => ({}),
    };
    vi.stubGlobal("window", { qorex: { native }, addEventListener: () => {}, dispatchEvent: () => true });
    const { qorexAccount, forgetQorexAccount } = await import("./staking");
    // Ten checks at once (the review screen re-checks on every focus): one connect request.
    const all = await Promise.all(Array.from({ length: 10 }, () => qorexAccount()));
    expect(new Set(all)).toEqual(new Set(["qor1tvkecr694m62k32hftvte378kx4sxvz2qjdd5f"]));
    expect(enables).toBe(1);
    await qorexAccount();
    await qorexAccount();
    expect(enables).toBe(1);
    expect(getKeys).toBe(2); // the failed first try + the one after connecting
    expect(store.get("qrow.qorex.account")).toBe("qor1tvkecr694m62k32hftvte378kx4sxvz2qjdd5f");
    // Account switch: forgotten, then read again silently (site already connected: no new connect).
    forgetQorexAccount();
    await qorexAccount();
    expect(enables).toBe(1);
    vi.unstubAllGlobals();
  }, 60_000);
});
