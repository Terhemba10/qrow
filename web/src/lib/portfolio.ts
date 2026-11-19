import { useQuery } from "@tanstack/react-query";
import { erc20Abi, type Address, type Hex, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { evmToQor, qoreAddresses } from "@qorechain/sdk";
import { qrowGenesisAbi } from "../abi/QrowGenesis";
import { qrowMarketAbi } from "../abi/QrowMarket";
import { CHAIN, REST } from "../config/network";
import { GENESIS, MARKET } from "../config/contracts";
import { TOKENS, type Token } from "../config/tokens";

// ---------------------------------------------------------------- balances (EVM + native lane + CosmWasm read)
export interface BalanceRow {
  token: Token;
  evm: bigint;
  bank: bigint;
}
/** CW20 tokens read on the CosmWasm lane (read only: Qrow can't deploy there on testnet). */
export const CW20 = [{ symbol: "WDT", name: "Wasm Deploy Test (CW20)", contract: "qor14hj2tavq8fpesdwxxcu44rty3hh90vhujrvcmstl4zr3txmfvw9s93uuqt", decimals: 6 }];

async function loadBalances(client: PublicClient, me: Address) {
  const qor = evmToQor(me);
  const bank = (await fetch(`${REST}/cosmos/bank/v1beta1/balances/${qor}`).then((r) => r.json())) as { balances?: { denom: string; amount: string }[] };
  const bankOf = (d: string) => BigInt(bank.balances?.find((b) => b.denom.toLowerCase() === d.toLowerCase())?.amount ?? "0");
  const rows: BalanceRow[] = await Promise.all(
    TOKENS.map(async (t) => ({
      token: t,
      evm: t.address ? await client.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [me] }) : await client.getBalance({ address: me }),
      // QOR is the same balance on both lanes (uqor); fest tokens show the unconverted bank coin.
      bank: t.address ? bankOf(t.bankDenom) : 0n,
    })),
  );
  const cw20 = await Promise.all(
    CW20.map(async (c) => {
      const q = btoa(JSON.stringify({ balance: { address: qor } }));
      const r = (await fetch(`${REST}/cosmwasm/wasm/v1/contract/${c.contract}/smart/${q}`).then((x) => x.json())) as { data?: { balance?: string } };
      return { ...c, balance: BigInt(r.data?.balance ?? "0") };
    }),
  );
  const addrs = qoreAddresses({ evm: me });
  return { rows, cw20, addresses: { evm: addrs.evm, cosmos: addrs.cosmos, svm: addrs.svm } };
}

export function useBalances(me: Address | undefined) {
  const client = usePublicClient({ chainId: CHAIN.id });
  return useQuery({ queryKey: ["portfolio-balances", me], enabled: !!me && !!client, refetchInterval: 30_000, queryFn: () => loadBalances(client!, me!) });
}

// ---------------------------------------------------------------- NFTs and listings
export interface OwnedNft {
  id: bigint;
  image?: string;
  name: string;
  listed?: { listingId: bigint; price: bigint; currency: Address };
}

export function parseTokenUri(uri: string): { name: string; image?: string } {
  try {
    const json = JSON.parse(atob(uri.replace(/^data:application\/json;base64,/, ""))) as { name?: string; image?: string };
    const image = typeof json.image === "string" && json.image.startsWith("data:image/svg+xml;base64,") ? json.image : undefined;
    return { name: String(json.name ?? "Qrow Genesis"), image };
  } catch {
    return { name: "Qrow Genesis" };
  }
}

/** Runs `fn` over `items`, a few at a time, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Genesis token ids, 1..totalMinted (the collection is capped at 256). */
export const genesisIds = (total: bigint): bigint[] => Array.from({ length: Number(total) }, (_, i) => BigInt(i + 1));

/**
 * NFTs are read from contract state, not events: QoreChain doesn't expose EVM logs from cross-VM
 * calls (how QoreX users mint, list and buy), so eth_getLogs finds nothing for them (19 Nov: a
 * user's Genesis #1 was missing from Portfolio). Genesis has at most 256 tokens, so every owner is
 * read; listings come from the market's activeListingIds.
 */
async function loadNfts(client: PublicClient, me: Address): Promise<OwnedNft[]> {
  const [total, listingIds] = await Promise.all([
    client.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "totalMinted" }),
    client.readContract({ address: MARKET, abi: qrowMarketAbi, functionName: "activeListingIds" }),
  ]);
  const listings = await mapLimit([...listingIds], 6, async (listingId) => ({ listingId, l: await client.readContract({ address: MARKET, abi: qrowMarketAbi, functionName: "getListing", args: [listingId] }) }));
  const mine = new Map<bigint, OwnedNft["listed"]>();
  for (const { listingId, l } of listings) if (l.active && l.seller.toLowerCase() === me.toLowerCase()) mine.set(l.tokenId, { listingId, price: l.price, currency: l.currency });
  const owners = await mapLimit(genesisIds(total), 8, (id) => client.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "ownerOf", args: [id] }).catch(() => undefined));
  const ids = genesisIds(total).filter((id, i) => owners[i]?.toLowerCase() === me.toLowerCase() || mine.has(id));
  return mapLimit(ids, 6, async (id) => ({ id, ...parseTokenUri(await client.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "tokenURI", args: [id] })), listed: mine.get(id) }));
}

export function useNfts(me: Address | undefined) {
  const client = usePublicClient({ chainId: CHAIN.id });
  return useQuery({ queryKey: ["portfolio-nfts", me], enabled: !!me && !!client, refetchInterval: 30_000, queryFn: () => loadNfts(client!, me!) });
}

// ---------------------------------------------------------------- activity + CSV
export interface ActivityRow {
  time: number; // unix seconds
  kind: string;
  ref: string;
  amount: string;
  counterparty: string;
  status: string;
  tx?: Hex;
}

export function toCsv(rows: ActivityRow[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["date_utc", "type", "reference", "amount", "counterparty", "status", "tx_hash"];
  const lines = rows.map((r) => [new Date(r.time * 1000).toISOString(), r.kind, r.ref, r.amount, r.counterparty, r.status, r.tx ?? ""].map(esc).join(","));
  return [header.join(","), ...lines].join("\n") + "\n";
}

export function downloadCsv(rows: ActivityRow[], filename: string) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1_000);
}
