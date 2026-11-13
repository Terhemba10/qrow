/**
 * Receipts: after every transaction, what was done and its hash, kept in this browser per account so
 * people can find and verify it later (Portfolio, Verify). Public data only (hashes, amounts, the
 * other party's address); nothing secret. Capped at the 100 most recent per account.
 */
import { useSyncExternalStore } from "react";

export interface Receipt {
  hash: string;
  /** "Swap", "Payment", "Claim", "Stake", … */
  kind: string;
  title: string;
  lines: { name: string; value: string }[];
  /** ISO time the receipt was written (the block time is on the Verify page). */
  at: string;
  /** Qrow reference, e.g. QRW-PAY-000003. */
  ref?: string;
  /** Set-up or helper transactions that ran in the same flow. */
  steps?: { label: string; hash: string }[];
}

const KEY = (account: string) => `qrow.receipts.v1.${account.toLowerCase()}`;
const MAX = 100;
const listeners = new Set<() => void>();
const cache = new Map<string, Receipt[]>();

function read(account: string): Receipt[] {
  const hit = cache.get(account.toLowerCase());
  if (hit) return hit;
  let list: Receipt[] = [];
  try {
    list = JSON.parse(localStorage.getItem(KEY(account)) ?? "[]") as Receipt[];
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
  cache.set(account.toLowerCase(), list);
  return list;
}

export function addReceipt(account: string, r: Omit<Receipt, "at"> & { at?: string }) {
  const list = [{ ...r, at: r.at ?? new Date().toISOString() }, ...read(account).filter((x) => x.hash !== r.hash)].slice(0, MAX);
  cache.set(account.toLowerCase(), list);
  try {
    localStorage.setItem(KEY(account), JSON.stringify(list));
  } catch {
    /* storage blocked: the receipt still shows for this visit */
  }
  listeners.forEach((l) => l());
}

const EMPTY: Receipt[] = [];

/** This account's receipts, newest first; re-renders when one is added. */
export function useReceipts(account: string | undefined): Receipt[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (account ? read(account) : EMPTY),
  );
}
