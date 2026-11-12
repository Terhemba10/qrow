import type { Address } from "viem";
import { validateAddress } from "../vendor/custody-kit/address";

export type ParsedRecipient =
  | { ok: true; evm: Address; qor: string; typed: "0x" | "qor1" }
  | { ok: false; reason: "empty" | "format" | "checksum" | "bech32" };

/**
 * Accepts a 0x (EIP-55 checksummed, or all lower/upper case) or a qor1 account address and returns
 * both spellings of the same 20 bytes. Validation is the QoreChain custody kit's validateAddress
 * (vendored, Apache-2.0); this only maps its error codes to the form's messages.
 */
export function parseRecipient(input: string): ParsedRecipient {
  const s = input.trim();
  if (s === "") return { ok: false, reason: "empty" };
  // The custody kit expects canonical lowercase bech32; people paste either case.
  const r = validateAddress(/^qor1/i.test(s) ? s.toLowerCase() : s);
  if (r.valid) return { ok: true, evm: r.hex as Address, qor: r.bech32, typed: r.format === "hex" ? "0x" : "qor1" };
  switch (r.error) {
    case "BAD_EIP55":
      return { ok: false, reason: "checksum" };
    case "BAD_CHECKSUM":
    case "BAD_BECH32":
    case "BAD_LENGTH":
    case "MIXED_CASE":
      return { ok: false, reason: /^qor/i.test(s) ? "bech32" : "format" };
    default:
      return { ok: false, reason: "format" };
  }
}

/** Split an address for the confirm screen: the first 4 and last 4 hex characters set large. */
export function splitForDisplay(evm: string): { prefix: string; head: string; middle: string; tail: string } {
  return { prefix: "0x", head: evm.slice(2, 6), middle: evm.slice(6, -4), tail: evm.slice(-4) };
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
