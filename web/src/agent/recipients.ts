import type { Address, PublicClient } from "viem";
import { getLogsChunked } from "../lib/logs";
import { parseAbiItem } from "viem";
import { ESCROW } from "../config/network";

/** Block the escrow was deployed in (contracts/deployments/testnet.json). Logs start here. */
export const ESCROW_DEPLOY_BLOCK = 9_978_060n;

const paymentCreated = parseAbiItem(
  "event PaymentCreated(uint256 indexed id, address indexed sender, address indexed recipient, address token, uint256 amount, uint64 deadline, uint8 mode)",
);

interface IndexFile {
  /** lowercase recipient → first seen (ms) */
  recipients: Record<string, number>;
  /** next block to scan from */
  scannedTo: string;
}

const key = (sender: Address) => `qrow.recipients.${sender.toLowerCase()}`;

function readIndex(sender: Address): IndexFile {
  try {
    const raw = localStorage.getItem(key(sender));
    if (raw) return JSON.parse(raw) as IndexFile;
  } catch {
    /* private mode or corrupted: rebuild from chain */
  }
  return { recipients: {}, scannedTo: ESCROW_DEPLOY_BLOCK.toString() };
}

function writeIndex(sender: Address, idx: IndexFile) {
  try {
    localStorage.setItem(key(sender), JSON.stringify(idx));
  } catch {
    /* not persisted; still correct for this session */
  }
}

/**
 * The sender's past recipients: a local index (instant), topped up from the escrow's
 * PaymentCreated logs since the last scan. The chain is the source of truth; the local copy only
 * makes the new-recipient and lookalike checks fast.
 */
export async function pastRecipients(client: PublicClient, sender: Address): Promise<Map<string, number>> {
  const idx = readIndex(sender);
  const from = BigInt(idx.scannedTo);
  const latest = await client.getBlockNumber();
  if (latest >= from) {
    const logs = await getLogsChunked(from, latest, (fromBlock, toBlock) => client.getLogs({ address: ESCROW, event: paymentCreated, args: { sender }, fromBlock, toBlock }));
    for (const l of logs) {
      const r = l.args.recipient?.toLowerCase();
      if (r && !(r in idx.recipients)) idx.recipients[r] = Date.now();
    }
    idx.scannedTo = (latest + 1n).toString();
    writeIndex(sender, idx);
  }
  return new Map(Object.entries(idx.recipients));
}

/** Record a recipient right after a payment is sent (the next log scan confirms it). */
export function rememberRecipient(sender: Address, recipient: Address) {
  const idx = readIndex(sender);
  const r = recipient.toLowerCase();
  if (!(r in idx.recipients)) idx.recipients[r] = Date.now();
  writeIndex(sender, idx);
}
