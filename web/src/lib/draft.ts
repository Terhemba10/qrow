import type { Address } from "viem";
import type { TokenSymbol } from "../config/tokens";

/** A payment the sender has filled in but not yet checked or signed. Never contains secrets. */
export interface PaymentDraft {
  recipient: Address;
  recipientQor: string;
  /** How the address was entered: typed/pasted now, or (later) scanned from a QR. */
  source: "typed" | "qr";
  token: TokenSymbol;
  /** Exact base units as a decimal string (bigint isn't serialisable). */
  amountUnits: string;
  freelancer: boolean;
  note: string;
}

export const NOTE_MAX = 140;

const KEY = "qrow.draft";

export function saveDraft(d: PaymentDraft) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* private mode: the draft simply isn't remembered across reloads */
  }
}

export function loadDraft(): PaymentDraft | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PaymentDraft) : undefined;
  } catch {
    return undefined;
  }
}

export function clearDraft() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
