import { getAddress, isAddress, type Address } from "viem";
import { evmToQor, qorToEvm } from "@qorechain/sdk";

export type ParsedRecipient =
  | { ok: true; evm: Address; qor: string; typed: "0x" | "qor1" }
  | { ok: false; reason: "empty" | "format" | "checksum" | "bech32" };

/**
 * Accepts a 0x (EIP-55 checksummed, or all lower/upper case) or a qor1 address and returns both
 * forms of the same 20-byte account. Deterministic; the checking agent adds the deeper checks.
 */
export function parseRecipient(input: string): ParsedRecipient {
  const s = input.trim();
  if (s === "") return { ok: false, reason: "empty" };
  if (/^qor1[02-9ac-hj-np-z]{38}$/i.test(s)) {
    try {
      const evm = getAddress(qorToEvm(s.toLowerCase()));
      return { ok: true, evm, qor: evmToQor(evm), typed: "qor1" };
    } catch {
      return { ok: false, reason: "bech32" };
    }
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) {
    const mixed = s !== s.toLowerCase() && s.slice(2) !== s.slice(2).toUpperCase();
    if (mixed && !isAddress(s, { strict: true })) return { ok: false, reason: "checksum" };
    const evm = getAddress(s);
    return { ok: true, evm, qor: evmToQor(evm), typed: "0x" };
  }
  return { ok: false, reason: "format" };
}

/** Split an address for the confirm screen: first 4 and last 4 characters (after 0x) highlighted. */
export function splitForDisplay(evm: Address): { head: string; middle: string; tail: string } {
  return { head: evm.slice(0, 6), middle: evm.slice(6, -4), tail: evm.slice(-4) };
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
