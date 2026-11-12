import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { RateLimiter, clientIp } from "./limits.js";

describe("RateLimiter", () => {
  it("allows max per window per key, then resets", () => {
    const l = new RateLimiter(2, 1000);
    expect([l.take("a", 0), l.take("a", 10), l.take("a", 20)]).toEqual([true, true, false]);
    expect(l.take("b", 20)).toBe(true);
    expect(l.take("a", 1500)).toBe(true);
  });
});

describe("clientIp", () => {
  const req = (xff?: string) => ({ headers: xff ? { "x-forwarded-for": xff } : {}, socket: { remoteAddress: "10.0.0.1" } }) as unknown as IncomingMessage;
  it("ignores X-Forwarded-For unless a proxy is trusted, then takes the proxy-added last hop", () => {
    expect(clientIp(req("1.2.3.4"), false)).toBe("10.0.0.1");
    expect(clientIp(req("6.6.6.6, 1.2.3.4"), true)).toBe("1.2.3.4");
    expect(clientIp(req(), true)).toBe("10.0.0.1");
  });
});
