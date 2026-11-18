/**
 * Create-your-own NFTs (QrowEditions, ERC-1155 editions): IPFS upload through Qrow's server route, metadata
 * reads through a public gateway, holdings for Portfolio and listings for the NFT Market.
 */
import { useQuery } from "@tanstack/react-query";
import { encodeAbiParameters, keccak256, toBytes, type Address, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { qrowEditionsAbi } from "../abi/QrowEditions";
import { EDITIONS } from "../config/contracts";
import { CHAIN } from "../config/network";

/** Public IPFS gateway used to show images (VITE_IPFS_GATEWAY to change it). */
export const GATEWAY = ((import.meta.env.VITE_IPFS_GATEWAY as string | undefined) ?? "https://gateway.pinata.cloud/ipfs/").replace(/\/?$/, "/");

/** ipfs://CID[/path] → gateway URL. Anything else is refused (no http(s) or data: from metadata). */
export function ipfsToHttp(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const m = /^ipfs:\/\/(?:ipfs\/)?([a-zA-Z0-9]{46,100})(\/[\w.\-/]*)?$/.exec(uri.trim());
  return m ? `${GATEWAY}${m[1]}${m[2] ?? ""}` : undefined;
}

/** The hash QrowEditions.create signs over: keccak256(abi.encode(keccak256(bytes(uri)), supply)). */
export const createParams = (uri: string, supply: bigint) =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [keccak256(toBytes(uri)), supply]));

export interface EditionMeta {
  id: bigint;
  name: string;
  description: string;
  image?: string;
  creator: Address;
  supply: bigint;
  uri: string;
}

const metaCache = new Map<string, Promise<{ name: string; description: string; image?: string }>>();
async function fetchMeta(uri: string) {
  if (!metaCache.has(uri)) {
    metaCache.set(
      uri,
      (async () => {
        const url = ipfsToHttp(uri);
        if (!url) return { name: "Untitled", description: "" };
        try {
          const r = await fetch(url);
          const j = (await r.json()) as { name?: unknown; description?: unknown; image?: unknown };
          return {
            name: typeof j.name === "string" ? j.name.slice(0, 60) : "Untitled",
            description: typeof j.description === "string" ? j.description.slice(0, 500) : "",
            image: typeof j.image === "string" ? ipfsToHttp(j.image) : undefined,
          };
        } catch {
          return { name: "Untitled", description: "" };
        }
      })(),
    );
  }
  return metaCache.get(uri)!;
}

export async function readEdition(c: PublicClient, id: bigint): Promise<EditionMeta> {
  const e = (await c.readContract({ address: EDITIONS!, abi: qrowEditionsAbi, functionName: "getEdition", args: [id] })) as { creator: Address; supply: bigint; uri: string };
  return { id, creator: e.creator, supply: e.supply, uri: e.uri, ...(await fetchMeta(e.uri)) };
}

export function useEdition(id: bigint | undefined) {
  const client = usePublicClient({ chainId: CHAIN.id });
  return useQuery({ queryKey: ["edition", id?.toString()], enabled: !!client && !!EDITIONS && id !== undefined, queryFn: () => readEdition(client!, id!) });
}

/** Editions `me` holds (scans the newest 500 ids, enough for the testnet). */
export function useHeldEditions(me: Address | undefined) {
  const client = usePublicClient({ chainId: CHAIN.id });
  return useQuery({
    queryKey: ["editions-held", me],
    enabled: !!client && !!EDITIONS && !!me,
    refetchInterval: 30_000,
    queryFn: async () => {
      const c = client!;
      const count = await c.readContract({ address: EDITIONS!, abi: qrowEditionsAbi, functionName: "editionCount" });
      const from = count > 500n ? count - 499n : 1n;
      const [ids, bals] = await c.readContract({ address: EDITIONS!, abi: qrowEditionsAbi, functionName: "holdings", args: [me!, from, 500n] });
      return Promise.all(ids.map(async (id, i) => ({ ...(await readEdition(c, id)), balance: bals[i] })));
    },
  });
}

export interface EditionListing {
  id: bigint;
  seller: Address;
  editionId: bigint;
  amount: bigint;
  price: bigint;
  edition: EditionMeta;
}

export function useEditionListings() {
  const client = usePublicClient({ chainId: CHAIN.id });
  return useQuery({
    queryKey: ["edition-listings"],
    enabled: !!client && !!EDITIONS,
    refetchInterval: 20_000,
    queryFn: async (): Promise<EditionListing[]> => {
      const c = client!;
      const ids = await c.readContract({ address: EDITIONS!, abi: qrowEditionsAbi, functionName: "activeListingIds" });
      return Promise.all(
        [...ids].reverse().slice(0, 60).map(async (id) => {
          const l = (await c.readContract({ address: EDITIONS!, abi: qrowEditionsAbi, functionName: "getListing", args: [id] })) as { seller: Address; editionId: bigint; amount: bigint; price: bigint };
          return { id, seller: l.seller, editionId: l.editionId, amount: l.amount, price: l.price, edition: await readEdition(c, l.editionId) };
        }),
      );
    },
  });
}

/** Read a picked file as a data URL (the upload route checks the real type and size again). */
export const fileToDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

const REASONS: Record<string, string> = {
  ipfs_not_configured: "Image uploads aren’t switched on yet on this site (the owner adds the IPFS key).",
  slow_down: "Too many uploads from this connection. Try again in an hour.",
  image_too_large: "The image is over 3 MB. Pick a smaller one.",
  not_an_image: "That file isn’t a PNG, JPEG, GIF or WebP image.",
  bad_supply: "Copies must be between 1 and 10,000.",
  name_required: "Give your NFT a name.",
  too_large: "The image is too large.",
};

export async function uploadNft(input: { name: string; description: string; supply: number; creator: Address; image: string }): Promise<{ metadataUri: string; imageCid: string }> {
  const r = await fetch("/api/ipfs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; reason?: string; metadataUri?: string; imageCid?: string };
  if (!r.ok || !j.ok || !j.metadataUri) throw new Error(REASONS[j.reason ?? ""] ?? `Upload failed (${j.reason ?? r.status}). Try again.`);
  return { metadataUri: j.metadataUri, imageCid: j.imageCid! };
}
