import { describe, expect, it } from "vitest";
import { metadataFor, parseNftRequest, pinNft, sniffImage } from "./ipfs";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const dataUrl = (b: Buffer, t = "image/png") => `data:${t};base64,${b.toString("base64")}`;
const base = { name: "My art", description: "hi", supply: 10, creator: "0xD517458c6b083B964342C604D35Be6afC2dCcb37" };

describe("ipfs upload checks", () => {
  it("sniffs real image types and rejects others", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeUndefined();
  });
  it("accepts a valid request", () => {
    const r = parseNftRequest({ ...base, image: dataUrl(PNG) });
    expect(r.ok).toBe(true);
  });
  it("rejects SVG/HTML disguised as PNG, bad supply, bad creator, missing name", () => {
    expect(parseNftRequest({ ...base, image: dataUrl(Buffer.from("<html></html>")) })).toEqual({ ok: false, reason: "not_an_image" });
    expect(parseNftRequest({ ...base, supply: 0, image: dataUrl(PNG) })).toMatchObject({ ok: false, reason: "bad_supply" });
    expect(parseNftRequest({ ...base, supply: 10_001, image: dataUrl(PNG) })).toMatchObject({ ok: false });
    expect(parseNftRequest({ ...base, creator: "qor1x", image: dataUrl(PNG) })).toMatchObject({ reason: "bad_creator" });
    expect(parseNftRequest({ ...base, name: "  ", image: dataUrl(PNG) })).toMatchObject({ reason: "name_required" });
  });
  it("builds ERC-1155 metadata pointing at ipfs://", () => {
    const r = parseNftRequest({ ...base, image: dataUrl(PNG) });
    if (!r.ok) throw new Error();
    expect(metadataFor(r.input, "bafyimg").image).toBe("ipfs://bafyimg");
  });
  it("pins image then metadata with the JWT as a bearer token", async () => {
    const r = parseNftRequest({ ...base, image: dataUrl(PNG) });
    if (!r.ok) throw new Error();
    const calls: string[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push(`${url} ${(init.headers as Record<string, string>).authorization}`);
      return new Response(JSON.stringify({ IpfsHash: calls.length === 1 ? "bafyimg" : "bafymeta" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await pinNft(r.input, "jwt123", fake)).toEqual({ imageCid: "bafyimg", metadataUri: "ipfs://bafymeta" });
    expect(calls[0]).toContain("pinFileToIPFS Bearer jwt123");
    expect(calls[1]).toContain("pinJSONToIPFS");
  });
});
