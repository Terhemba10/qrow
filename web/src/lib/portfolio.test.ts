import { describe, expect, it } from "vitest";
import { parseTokenUri, toCsv } from "./portfolio";

describe("toCsv", () => {
  it("writes a header and escapes commas and quotes", () => {
    const csv = toCsv([{ time: 1_794_500_000, kind: "Payment sent", ref: "#4", amount: "0.1 QOR", counterparty: "0xdBA1…e78d", status: "Waiting, unclaimed", tx: "0xabc" }]);
    const [h, row] = csv.trim().split("\n");
    expect(h).toBe("date_utc,type,reference,amount,counterparty,status,tx_hash");
    expect(row).toContain('"Waiting, unclaimed"');
    expect(row.startsWith("2026-")).toBe(true);
  });
});

describe("parseTokenUri", () => {
  it("accepts only an on-chain SVG image", () => {
    const ok = "data:application/json;base64," + btoa(JSON.stringify({ name: "Qrow Genesis #1", image: "data:image/svg+xml;base64,PHN2Zy8+" }));
    expect(parseTokenUri(ok)).toEqual({ name: "Qrow Genesis #1", image: "data:image/svg+xml;base64,PHN2Zy8+" });
    const remote = "data:application/json;base64," + btoa(JSON.stringify({ name: "x", image: "https://evil.example/track.png" }));
    expect(parseTokenUri(remote).image).toBeUndefined();
    expect(parseTokenUri("garbage")).toEqual({ name: "Qrow Genesis" });
  });
});
