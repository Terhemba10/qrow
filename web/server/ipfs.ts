/**
 * Create NFT: pin the image and its ERC-1155 metadata to IPFS through Pinata, server-side, so the API key
 * (PINATA_JWT) never reaches the browser. Images only (PNG, JPEG, GIF, WebP), checked by their magic bytes,
 * at most 3 MB (Vercel's request limit is 4.5 MB and base64 adds a third).
 */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const PINATA = "https://api.pinata.cloud";

export type ImageType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** The real type of an image from its first bytes (never trust the name or the claimed type). */
export function sniffImage(b: Uint8Array): ImageType | undefined {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return undefined;
}

export interface NftInput {
  name: string;
  description: string;
  supply: number;
  creator: string;
  image: Uint8Array;
  type: ImageType;
}

const clean = (s: unknown, max: number) =>
  typeof s === "string"
    ? s
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
        .trim()
        .slice(0, max)
    : "";

export function parseNftRequest(v: unknown): { ok: true; input: NftInput } | { ok: false; reason: string } {
  const o = (v ?? {}) as Record<string, unknown>;
  const name = clean(o.name, 60);
  const description = clean(o.description, 500);
  const supply = Number(o.supply);
  const creator = typeof o.creator === "string" && /^0x[0-9a-fA-F]{40}$/.test(o.creator) ? o.creator : "";
  if (name.length < 1) return { ok: false, reason: "name_required" };
  if (!Number.isInteger(supply) || supply < 1 || supply > 10_000) return { ok: false, reason: "bad_supply" };
  if (!creator) return { ok: false, reason: "bad_creator" };
  const m = typeof o.image === "string" ? /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/.exec(o.image) : null;
  if (!m) return { ok: false, reason: "image_required" };
  const image = Uint8Array.from(Buffer.from(m[1], "base64"));
  if (image.length === 0 || image.length > MAX_IMAGE_BYTES) return { ok: false, reason: "image_too_large" };
  const type = sniffImage(image);
  if (!type) return { ok: false, reason: "not_an_image" };
  return { ok: true, input: { name, description, supply, creator, image, type } };
}

export const metadataFor = (i: NftInput, imageCid: string) => ({
  name: i.name,
  description: i.description,
  image: `ipfs://${imageCid}`,
  properties: { supply: i.supply, creator: i.creator, network: "QoreChain testnet", app: "Qrow" },
});

/** Pin image then metadata; returns the metadata URI for QrowEditions.create. */
export async function pinNft(i: NftInput, jwt: string, fetchImpl: typeof fetch = fetch): Promise<{ imageCid: string; metadataUri: string }> {
  const ext = i.type.split("/")[1];
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(i.image) as Uint8Array<ArrayBuffer>], { type: i.type }), `qrow-nft.${ext}`);
  form.append("pinataMetadata", JSON.stringify({ name: `qrow:${i.creator}:${i.name}`.slice(0, 90) }));
  const img = await fetchImpl(`${PINATA}/pinning/pinFileToIPFS`, { method: "POST", headers: { authorization: `Bearer ${jwt}` }, body: form });
  if (!img.ok) throw new Error(`pinata_image_${img.status}`);
  const imageCid = ((await img.json()) as { IpfsHash: string }).IpfsHash;
  const meta = await fetchImpl(`${PINATA}/pinning/pinJSONToIPFS`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ pinataContent: metadataFor(i, imageCid), pinataMetadata: { name: `qrow-meta:${i.name}`.slice(0, 90) } }),
  });
  if (!meta.ok) throw new Error(`pinata_meta_${meta.status}`);
  return { imageCid, metadataUri: `ipfs://${((await meta.json()) as { IpfsHash: string }).IpfsHash}` };
}
