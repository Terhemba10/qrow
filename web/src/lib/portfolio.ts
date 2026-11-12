import { useQuery } from "@tanstack/react-query";
import { erc20Abi, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { evmToQor, qoreAddresses } from "@qorechain/sdk";
import { qrowGenesisAbi } from "../abi/QrowGenesis";
import { qrowMarketAbi } from "../abi/QrowMarket";
import { CHAIN, REST } from "../config/network";
import { GENESIS, GENESIS_DEPLOY_BLOCK, MARKET } from "../config/contracts";
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

const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const listed = parseAbiItem("event Listed(uint256 indexed listingId, address indexed seller, uint256 indexed tokenId, address currency, uint256 price)");

export function parseTokenUri(uri: string): { name: string; image?: string } {
  try {
    const json = JSON.parse(atob(uri.replace(/^data:application\/json;base64,/, ""))) as { name?: string; image?: string };
    const image = typeof json.image === "string" && json.image.startsWith("data:image/svg+xml;base64,") ? json.image : undefined;
    return { name: String(json.name ?? "Qrow Genesis"), image };
  } catch {
    return { name: "Qrow Genesis" };
  }
}

async function loadNfts(client: PublicClient, me: Address): Promise<OwnedNft[]> {
  const latest = await client.getBlockNumber();
  const [inLogs, listLogs] = await Promise.all([
    client.getLogs({ address: GENESIS, event: transfer, args: { to: me }, fromBlock: GENESIS_DEPLOY_BLOCK, toBlock: latest }),
    client.getLogs({ address: MARKET, event: listed, args: { seller: me }, fromBlock: GENESIS_DEPLOY_BLOCK, toBlock: latest }),
  ]);
  const candidates = [...new Set([...inLogs.map((l) => l.args.tokenId!), ...listLogs.map((l) => l.args.tokenId!)])];
  const out: OwnedNft[] = [];
  for (const id of candidates) {
    const owner = await client.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "ownerOf", args: [id] }).catch(() => undefined);
    let listing: OwnedNft["listed"];
    if (owner?.toLowerCase() === MARKET.toLowerCase()) {
      const ll = listLogs.filter((l) => l.args.tokenId === id).at(-1);
      if (ll) {
        const l = await client.readContract({ address: MARKET, abi: qrowMarketAbi, functionName: "getListing", args: [ll.args.listingId!] });
        if (l.active && l.seller.toLowerCase() === me.toLowerCase()) listing = { listingId: ll.args.listingId!, price: l.price, currency: l.currency };
      }
    }
    if (owner?.toLowerCase() !== me.toLowerCase() && !listing) continue;
    const meta = parseTokenUri(await client.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "tokenURI", args: [id] }));
    out.push({ id, ...meta, listed: listing });
  }
  return out.sort((a, b) => Number(a.id - b.id));
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
  tx: Hex;
}

export function toCsv(rows: ActivityRow[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["date_utc", "type", "reference", "amount", "counterparty", "status", "tx_hash"];
  const lines = rows.map((r) => [new Date(r.time * 1000).toISOString(), r.kind, r.ref, r.amount, r.counterparty, r.status, r.tx].map(esc).join(","));
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
