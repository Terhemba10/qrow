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

describe("NFT reads from contract state", () => {
  it("lists Genesis ids 1..totalMinted", async () => {
    const { genesisIds } = await import("./portfolio");
    expect(genesisIds(0n)).toEqual([]);
    expect(genesisIds(3n)).toEqual([1n, 2n, 3n]);
  });
  it("maps a few at a time and keeps order", async () => {
    const { mapLimit } = await import("./portfolio");
    let running = 0, peak = 0;
    const out = await mapLimit([5, 1, 3, 2], 2, async (n) => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20]);
    expect(peak).toBe(2);
  });
});
