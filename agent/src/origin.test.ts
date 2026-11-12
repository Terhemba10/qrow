import { describe, expect, it } from "vitest";
import { makeOriginCheck } from "./limits.js";

describe("makeOriginCheck", () => {
  it("allows the Pages site, its previews and listed origins only", () => {
    const ok = makeOriginCheck("https://qrow.example/", "qrow");
    expect(ok("https://qrow.pages.dev")).toBe(true);
    expect(ok("https://abc123.qrow.pages.dev")).toBe(true);
    expect(ok("https://qrow.example")).toBe(true);
    expect(ok("https://evil.qrow.pages.dev.attacker.com")).toBe(false);
    expect(ok("https://a.b.qrow.pages.dev")).toBe(false);
    expect(ok("https://notqrow.pages.dev")).toBe(false);
    expect(ok("http://qrow.pages.dev")).toBe(false);
    expect(makeOriginCheck("", "")("https://qrow.pages.dev")).toBe(false);
  });
});
