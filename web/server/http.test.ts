import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { originAllowed } from "./http";

const req = (h: Record<string, string>) => ({ headers: { host: "qrow-app.vercel.app", ...h } }) as unknown as IncomingMessage;

describe("originAllowed (upload and AI routes)", () => {
  it("allows Qrow's own site", () => {
    expect(originAllowed(req({ origin: "https://qrow-app.vercel.app", "sec-fetch-site": "same-origin" }))).toBe(true);
  });
  it("refuses other sites, and requests with no Origin (scripts outside a browser)", () => {
    expect(originAllowed(req({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(originAllowed(req({}))).toBe(false);
  });
});
