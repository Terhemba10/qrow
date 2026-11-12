/**
 * QoreSeal (ML-KEM-1024) payment notices.
 *
 * - Seal keys: derived from the account's ML-DSA-87 secret key (itself from the PQC recovery code),
 *   so the one secret a recipient already uses to claim also opens their notes:
 *     seed = SHA-256("qrow-qoreseal-seed-v1|" || ML-DSA-87 secret key)
 *   The same derivation lives in contracts/scripts/seal.ts (the CLI registers the public key).
 * - Mode: ML-KEM-only (needs just the recipient's registered ML-KEM key, no recipient card).
 * - Authenticity: QoreSeal envelopes aren't signed by themselves, but QrowEscrow binds
 *   keccak256(sealedNote) into the sender's ML-DSA-87 authorisation for createPayment, so a
 *   notice in a PaymentNote event is post-quantum signed by the sender.
 * - Only the payload is confidential; amounts, addresses and timing are public on chain anyway.
 */
import { open, seal, sealKeysFromSeed, type SealKeyPair } from "@qorechain/qoreseal";
import { fetchKemKey } from "@qorechain/qoreseal/network";
import { sha256, toBytes, toHex, type Address, type Hex } from "viem";
import { NATIVE_CHAIN_ID, REST } from "../config/network";

export const NOTE_PURPOSE = "qrow-payment-notice-v1";
const SEED_DOMAIN = "qrow-qoreseal-seed-v1|";

export interface PaymentNotice {
  v: 1;
  /** "You have <amount> <token> waiting from <from>, claim before <claimBefore>" */
  amount: string;
  token: string;
  from: Address;
  claimBefore: string; // ISO time (approximate; the exact deadline is on chain)
  note?: string;
}

export function sealKeysFromPqSecret(pqSecretKey: Uint8Array): SealKeyPair {
  const prefix = new TextEncoder().encode(SEED_DOMAIN);
  const buf = new Uint8Array(prefix.length + pqSecretKey.length);
  buf.set(prefix);
  buf.set(pqSecretKey, prefix.length);
  return sealKeysFromSeed(toBytes(sha256(buf)));
}

export const wipeSealKeys = (k?: SealKeyPair) => {
  k?.seed.fill(0);
  k?.mlkemSecretKey.fill(0);
  k?.x25519SecretKey.fill(0);
};

/** The recipient's registered ML-KEM-1024 key, or undefined when they haven't set up notes. */
export async function recipientKemKey(recipient: Address): Promise<Uint8Array | undefined> {
  const rest = new URL(REST, window.location.origin).toString().replace(/\/$/, "");
  const k = await fetchKemKey({ rest, address: recipient });
  return k.registered && k.publicKey && k.algorithmId === 2 ? k.publicKey : undefined;
}

export function sealNotice(recipientMlkemKey: Uint8Array, notice: PaymentNotice): Hex {
  const plaintext = new TextEncoder().encode(JSON.stringify(notice));
  return toHex(seal({ chainId: NATIVE_CHAIN_ID, purpose: NOTE_PURPOSE, recipients: [{ mlkemPublicKey: recipientMlkemKey }], plaintext, mode: "mlkem" }));
}

/** Decrypt and strictly parse a notice. Any malformed field means "unreadable", never partial trust. */
export function openNotice(envelope: Hex, keys: SealKeyPair): PaymentNotice | undefined {
  try {
    const bytes = open({ chainId: NATIVE_CHAIN_ID, purpose: NOTE_PURPOSE, envelope: toBytes(envelope), keys });
    const o = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (o.v !== 1 || typeof o.amount !== "string" || typeof o.token !== "string" || typeof o.from !== "string" || typeof o.claimBefore !== "string") return undefined;
    if (o.note !== undefined && (typeof o.note !== "string" || [...o.note].length > 140)) return undefined;
    return { v: 1, amount: o.amount, token: o.token, from: o.from as Address, claimBefore: o.claimBefore, note: o.note as string | undefined };
  } catch {
    return undefined;
  }
}
