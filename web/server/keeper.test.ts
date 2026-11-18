import { describe, expect, it } from "vitest";
import { cronAuthorized } from "../api/keeper";
import { keeperConfig } from "./keeper";

describe("keeper", () => {
  const secret = "s".repeat(32);
  it("needs the exact cron secret", () => {
    expect(cronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(cronAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(cronAuthorized(secret, secret)).toBe(false);
    expect(cronAuthorized(undefined, secret)).toBe(false);
    expect(cronAuthorized("Bearer short", "short")).toBe(false); // too-short secrets are refused
    expect(cronAuthorized(`Bearer ${secret}`, undefined)).toBe(false);
  });
  it("names missing settings without their values", () => {
    const r = keeperConfig({ QROW_PERPS_ADDRESS: "0x4a4df4cdbb9c0ee0ae465124bc8b5caabf15bb85", PRICE_SIGNER_KEY: "0x12" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["PRICE_SIGNER_KEY", "KEEPER_PRIVATE_KEY", "KEEPER_QORE_PQC_RECOVERY_CODE"]);
  });
});
