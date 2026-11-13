import type { Address, PublicClient } from "viem";
import { recipientsOf } from "../lib/payments";

/** Block the escrow was deployed in (contracts/deployments/testnet.json). Logs start here. */
export const ESCROW_DEPLOY_BLOCK = 9_978_060n;


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
 * The sender's past recipients: a local index (instant), topped up from the escrow's state
 * (lib/payments.ts recipientsOf). The chain is the source of truth; the local copy only
 * makes the new-recipient and lookalike checks fast.
 */
export async function pastRecipients(client: PublicClient, sender: Address): Promise<Map<string, number>> {
  const idx = readIndex(sender);
  const from = BigInt(idx.scannedTo);
  const latest = await client.getBlockNumber();
  if (latest >= from) {
    // From escrow state, not events: payments made through QoreX emit no EVM logs the RPC can see.
    for (const r of await recipientsOf(client, sender)) if (!(r in idx.recipients)) idx.recipients[r] = Date.now();
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
