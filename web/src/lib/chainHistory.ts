import { useQuery } from "@tanstack/react-query";
import { evmToQor } from "@qorechain/sdk";
import type { Address } from "viem";
import { COIN_FACTORY, EDITIONS, GENESIS, KEYS, MARKET, PERPS, PREDICT } from "../config/contracts";
import { ESCROW_DEMO, ESCROW_REAL, REST } from "../config/network";
import { TOKENS } from "../config/tokens";

/**
 * The account's transactions read from the chain, so History shows them in any browser (receipts made here
 * add their own wording). Two searches: what the account signed itself (swaps, staking, transfers, QoreX
 * approvals), and the contract calls run for it through Qrow (cross-VM calls whose sender is the account).
 */
export interface ChainTx {
  hash: string;
  time: number; // ms
  kind: string;
  what: string;
  failed: boolean;
}

interface TxResponse {
  txhash: string;
  timestamp: string;
  code: number;
  tx: { body: { messages: Msg[] } };
  events?: { type: string; attributes: { key: string; value: string }[] }[];
}
interface Msg {
  "@type": string;
  [k: string]: unknown;
}

const NAMES: [Address | undefined, string][] = [
  [GENESIS, "Qrow Genesis NFTs"],
  [MARKET, "NFT Market"],
  [ESCROW_REAL, "Payments (escrow)"],
  [ESCROW_DEMO, "Payments (demo escrow)"],
  [KEYS, "Qrow device keys"],
  [COIN_FACTORY, "Coin launcher"],
  [EDITIONS, "Your own NFTs"],
  [PREDICT, "Predictions"],
  [PERPS, "Trade (perps)"],
];

export function contractName(addr: string): string {
  const a = addr.toLowerCase();
  const n = NAMES.find(([x]) => x && x.toLowerCase() === a)?.[1];
  if (n) return n;
  const t = TOKENS.find((x) => x.address?.toLowerCase() === a);
  return t ? `${t.symbol} token (allowance)` : `contract ${a.slice(0, 8)}…${a.slice(-4)}`;
}

const qor = (uqor: string) => `${(Number(uqor) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 })} QOR`;
const coins = (list: unknown): string => {
  const arr = (Array.isArray(list) ? list : [list]) as { denom?: string; amount?: string }[];
  return arr.filter((c) => c?.denom).map((c) => (c.denom === "uqor" ? qor(c.amount ?? "0") : `${c.amount} ${c.denom!.replace(/^erc20:/, "token ")}`)).join(" + ");
};
const typeName = (m: Msg) => m["@type"].split(".").pop() ?? m["@type"];

/** One row per transaction: what it did, in plain words. */
export function describe(tx: TxResponse, me: string): Omit<ChainTx, "hash" | "time" | "failed"> {
  const m = tx.tx.body.messages;
  const t = m.map(typeName);
  const xvm = tx.events?.find((e) => e.type === "crossvm_request")?.attributes.find((a) => a.key === "target_contract")?.value;
  if (xvm) return { kind: "Contract action", what: contractName(xvm) };
  if (t.includes("MsgSwapExactIn")) return { kind: "Swap", what: "Swap on QoreChain’s exchange" };
  if (t.includes("MsgDelegate")) return { kind: "Staking", what: `Staked ${coins(m[t.indexOf("MsgDelegate")].amount)}` };
  if (t.includes("MsgUndelegate")) return { kind: "Staking", what: `Unstaked ${coins(m[t.indexOf("MsgUndelegate")].amount)}` };
  if (t.includes("MsgWithdrawDelegatorReward")) return { kind: "Staking", what: "Claimed staking rewards" };
  if (t.includes("MsgOpenEVMWindow")) return { kind: "Approval", what: "Opened Qrow’s access window in QoreX" };
  if (t.includes("MsgGrant")) return { kind: "Approval", what: t.includes("MsgSend") ? "Approved in QoreX, with device fees" : "Approved one Qrow action in QoreX" };
  if (t.includes("MsgRegisterPQCKeyV2") || t.includes("MsgRegisterPQCKey")) return { kind: "Key", what: "Registered a quantum-safe key" };
  if (t.includes("MsgExec")) return { kind: "Set-up step", what: "Converted tokens for a contract" };
  if (t.includes("MsgSend")) {
    const s = m[t.indexOf("MsgSend")] as Msg & { from_address?: string; to_address?: string; amount?: unknown };
    return s.from_address === me ? { kind: "Transfer", what: `Sent ${coins(s.amount)} to ${String(s.to_address).slice(0, 10)}…` } : { kind: "Transfer", what: `Received ${coins(s.amount)}` };
  }
  return { kind: "Other", what: t.join(", ") };
}

async function search(query: string): Promise<TxResponse[]> {
  const u = `${REST}/cosmos/tx/v1beta1/txs?${new URLSearchParams({ query, order_by: "ORDER_BY_DESC", "pagination.limit": "50" })}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return ((await r.json()) as { tx_responses?: TxResponse[] }).tx_responses ?? [];
}

export async function loadChainHistory(account: Address): Promise<ChainTx[]> {
  const me = evmToQor(account);
  const [own, viaQrow] = await Promise.all([search(`message.sender='${me}'`), search(`crossvm_request.sender='${me}'`)]);
  const seen = new Map<string, ChainTx>();
  for (const tx of [...own, ...viaQrow]) {
    if (seen.has(tx.txhash)) continue;
    seen.set(tx.txhash, { hash: tx.txhash, time: Date.parse(tx.timestamp), failed: tx.code !== 0, ...describe(tx, me) });
  }
  return [...seen.values()].sort((a, b) => b.time - a.time);
}

export function useChainHistory(account: Address | undefined) {
  return useQuery({ queryKey: ["chain-history", account], enabled: !!account, staleTime: 30_000, refetchInterval: 60_000, queryFn: () => loadChainHistory(account!) });
}
