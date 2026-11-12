import { useQuery } from "@tanstack/react-query";
import { parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { qrowEscrowAbi } from "../abi/QrowEscrow";
import { ESCROW_DEPLOY_BLOCK } from "../agent/recipients";
import { CHAIN, ESCROW } from "../config/network";
import { TOKENS, type Token } from "../config/tokens";

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
  createdTx: Hex;
  createdBlock: bigint;
  /** QoreSeal envelope from the PaymentNote event, if the sender attached one. */
  sealedNote?: Hex;
}

const noteEvent = parseAbiItem("event PaymentNote(uint256 indexed id, address indexed recipient, bytes sealedNote)");
const created = parseAbiItem(
  "event PaymentCreated(uint256 indexed id, address indexed sender, address indexed recipient, address token, uint256 amount, uint64 deadline, uint8 mode)",
);

const tokenFor = (addr: string): Token =>
  TOKENS.find((t) => (t.address ?? "0x0000000000000000000000000000000000000000").toLowerCase() === addr.toLowerCase()) ??
  // Unknown token (e.g. a launched coin): still shown, with 18 decimals and its address as symbol.
  ({ symbol: addr.slice(0, 8) as never, name: addr, address: addr as Address, decimals: 18, bankDenom: "" } as Token);

async function load(client: PublicClient, me: Address): Promise<{ incoming: Payment[]; outgoing: Payment[] }> {
  const latest = await client.getBlockNumber();
  const [inLogs, outLogs] = await Promise.all([
    client.getLogs({ address: ESCROW, event: created, args: { recipient: me }, fromBlock: ESCROW_DEPLOY_BLOCK, toBlock: latest }),
    client.getLogs({ address: ESCROW, event: created, args: { sender: me }, fromBlock: ESCROW_DEPLOY_BLOCK, toBlock: latest }),
  ]);
  const enrich = async (logs: typeof inLogs) =>
    Promise.all(
      logs.map(async (l) => {
        const p = await client.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "getPayment", args: [l.args.id!] });
        return {
          id: l.args.id!,
          sender: p.sender,
          recipient: p.recipient,
          token: tokenFor(p.token),
          amount: p.amount,
          createdAt: Number(p.createdAt),
          deadline: Number(p.deadline),
          freelancer: p.mode === 1,
          status: STATUS[p.status] ?? "None",
          createdTx: l.transactionHash,
          createdBlock: l.blockNumber,
        } as Payment;
      }),
    );
  const [incoming, outgoing, notes] = await Promise.all([
    enrich(inLogs),
    enrich(outLogs),
    client.getLogs({ address: ESCROW, event: noteEvent, args: { recipient: me }, fromBlock: ESCROW_DEPLOY_BLOCK, toBlock: latest }),
  ]);
  const byId = new Map(notes.map((n) => [n.args.id!.toString(), n.args.sealedNote!]));
  for (const p of incoming) p.sealedNote = byId.get(p.id.toString());
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
