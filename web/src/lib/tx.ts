/**
 * The every-transaction-hash rule: a native transaction is "pending" from the moment it has a hash,
 * and "confirmed" or "failed" only once the chain says so. Read from the chain (through Qrow's relay),
 * never from a database.
 */
import { REST } from "../config/network";

export const EXPLORER_TX = (hash: string) => `https://explore.qore.network/tx/${hash}`;
export const EXPLORER_NOTE = "Explorer: switch to Testnet if it opens on mainnet.";

export type TxEvent = { type: string; attributes: { key: string; value: string }[] };

export interface ChainTx {
  hash: string;
  code: number;
  height: number;
  time: string;
  gasUsed: number;
  rawLog: string;
  events: TxEvent[];
}

/** One look at the chain: the transaction if it's in a block, undefined if not (yet). */
export async function fetchTx(hash: string): Promise<ChainTx | undefined> {
  const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${hash}`).catch(() => undefined);
  if (!r?.ok) return undefined;
  const j = (await r.json().catch(() => ({}))) as { tx_response?: { code: number; height: string; timestamp: string; gas_used: string; raw_log: string; events?: TxEvent[] } };
  const t = j.tx_response;
  if (!t) return undefined;
  return { hash, code: t.code, height: Number(t.height), time: t.timestamp, gasUsed: Number(t.gas_used), rawLog: t.raw_log, events: t.events ?? [] };
}

/** Poll until the transaction is in a block (gentle back-off), or give up after `timeoutMs`. */
export async function waitForTx(hash: string, timeoutMs = 90_000): Promise<ChainTx | undefined> {
  const deadline = Date.now() + timeoutMs;
  let wait = 1500;
  while (Date.now() < deadline) {
    const t = await fetchTx(hash);
    if (t) return t;
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 1.5, 6000);
  }
  return undefined;
}

/** First and last 6 characters, the way people compare hashes. */
export const shortHash = (hash: string) => (hash.length > 14 ? `${hash.slice(0, 6)}…${hash.slice(-6)}` : hash);
