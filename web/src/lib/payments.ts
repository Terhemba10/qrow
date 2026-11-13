import { useQuery } from "@tanstack/react-query";
import { getLogsChunked } from "./logs";
import { parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { qrowEscrowAbi } from "../abi/QrowEscrow";
import { ESCROW_DEPLOY_BLOCK } from "../agent/recipients";
import { CHAIN, ESCROW } from "../config/network";
import { tokenByAddress, type Token } from "../config/tokens";

export const STATUS = ["None", "Pending", "Claimed", "Released", "Cancelled", "Refunded"] as const;
export type Status = (typeof STATUS)[number];

export interface Payment {
  id: bigint;
  sender: Address;
  recipient: Address;
  token: Token;
  amount: bigint;
  createdAt: number; // unix seconds
  deadline: number; // unix seconds
  freelancer: boolean;
  status: Status;
  /** Unknown for payments made through QoreX (cross-VM calls emit no EVM logs the RPC can see). */
  createdTx?: Hex;
  /** QoreSeal envelope from the PaymentNote event, if the sender attached one. */
  sealedNote?: Hex;
}

const noteEvent = parseAbiItem("event PaymentNote(uint256 indexed id, address indexed recipient, bytes sealedNote)");

const tokenFor = (addr: string): Token =>
  tokenByAddress(addr) ??
  // Unknown token (e.g. a launched coin): still shown, with 18 decimals and its address as symbol.
  ({ symbol: addr.slice(0, 8) as never, name: addr, address: addr as Address, decimals: 18, bankDenom: "" } as Token);

/**
 * Payments are read from the escrow's state, not its events: QoreChain doesn't expose EVM logs from
 * cross-VM calls (how QoreX users act), so eth_getLogs misses them (found 13 Nov, docs/TEST_NOTES.md).
 * This browser keeps a small index of who-paid-whom by payment number and tops it up from
 * paymentCount; only the viewer's own payments are re-read each time. A server indexer replaces this
 * at scale (docs/PLAN.md, Scale to 3k).
 */
type Index = { escrow: string; scannedTo: number; parties: Record<string, [string, string]> };
const INDEX_KEY = "qrow.paymentIndex.v1";
function readIndex(): Index {
  try {
    const i = JSON.parse(localStorage.getItem(INDEX_KEY) ?? "null") as Index | null;
    if (i && i.escrow === ESCROW.toLowerCase()) return i;
  } catch {
    /* fall through */
  }
  return { escrow: ESCROW.toLowerCase(), scannedTo: 0, parties: {} };
}
function writeIndex(i: Index) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(i));
  } catch {
    /* storage blocked: rescans next time */
  }
}

async function inBatches<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** Top up the who-paid-whom index from the escrow's paymentCount (state reads only). */
export async function paymentIndex(client: PublicClient): Promise<{ idx: Index; fresh: (readonly [bigint, Awaited<ReturnType<typeof readPayment>>])[] }> {
  const idx = readIndex();
  const count = Number(await client.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "paymentCount" }));
  const newIds = Array.from({ length: Math.max(0, count - idx.scannedTo) }, (_, k) => BigInt(idx.scannedTo + k + 1));
  const fresh = await inBatches(newIds, 10, async (id) => [id, await readPayment(client, id)] as const);
  for (const [id, p] of fresh) idx.parties[id.toString()] = [p.sender.toLowerCase(), p.recipient.toLowerCase()];
  idx.scannedTo = count;
  writeIndex(idx);
  return { idx, fresh };
}

const readPayment = (client: PublicClient, id: bigint) => client.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "getPayment", args: [id] });

/** Everyone `sender` has paid (from escrow state), lowercase. */
export async function recipientsOf(client: PublicClient, sender: Address): Promise<string[]> {
  const { idx } = await paymentIndex(client);
  const me = sender.toLowerCase();
  return [...new Set(Object.values(idx.parties).filter(([s]) => s === me).map(([, r]) => r))];
}

async function load(client: PublicClient, me: Address): Promise<{ incoming: Payment[]; outgoing: Payment[] }> {
  const { idx, fresh } = await paymentIndex(client);
  const lower = me.toLowerCase();
  const mineIds = Object.entries(idx.parties)
    .filter(([, [s, r]]) => s === lower || r === lower)
    .map(([id]) => BigInt(id));
  const freshById = new Map(fresh.map(([id, p]) => [id.toString(), p]));
  const rows = await inBatches(mineIds, 10, async (id) => {
    const p = freshById.get(id.toString()) ?? (await readPayment(client, id));
    return {
      id,
      sender: p.sender,
      recipient: p.recipient,
      token: tokenFor(p.token),
      amount: p.amount,
      createdAt: Number(p.createdAt),
      deadline: Number(p.deadline),
      freelancer: p.mode === 1,
      status: STATUS[p.status] ?? "None",
    } as Payment;
  });
  const incoming = rows.filter((p) => p.recipient.toLowerCase() === lower);
  const outgoing = rows.filter((p) => p.sender.toLowerCase() === lower);

  // Sealed notes are only in the PaymentNote event; payments made with an EVM wallet still have them.
  if (incoming.length) {
    const latest = await client.getBlockNumber();
    const notes = await getLogsChunked(ESCROW_DEPLOY_BLOCK, latest, (fromBlock, toBlock) =>
      client.getLogs({ address: ESCROW, event: noteEvent, args: { recipient: me }, fromBlock, toBlock }),
    ).catch(() => []);
    const byId = new Map(notes.map((n) => [n.args.id!.toString(), n.args.sealedNote!]));
    for (const p of incoming) p.sealedNote = byId.get(p.id.toString());
  }
  const newestFirst = (a: Payment, b: Payment) => Number(b.id - a.id);
  return { incoming: incoming.sort(newestFirst), outgoing: outgoing.sort(newestFirst) };
}

export function usePayments(me: Address | undefined) {
  const client = usePublicClient({ chainId: CHAIN.id });
  return useQuery({
    queryKey: ["payments", me],
    enabled: !!me && !!client,
    refetchInterval: 15_000,
    queryFn: () => load(client!, me!),
  });
}

/** What can happen to a payment right now, from one person's point of view. */
export function actionsFor(p: Payment, me: Address, nowSec: number) {
  const pending = p.status === "Pending";
  const expired = nowSec >= p.deadline;
  const isRecipient = p.recipient.toLowerCase() === me.toLowerCase();
  const isSender = p.sender.toLowerCase() === me.toLowerCase();
  return {
    claim: pending && !expired && isRecipient && !p.freelancer,
    release: pending && !expired && isSender && p.freelancer,
    cancel: pending && isSender,
    refund: pending && expired,
  };
}
