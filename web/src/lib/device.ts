/**
 * The Qrow device key: an ML-DSA-87 key this browser holds for one account, registered in QrowKeys.
 * Users never see it, copy it or save it.
 *
 * Storage: a random 32-byte seed, encrypted with AES-GCM and kept in this browser's IndexedDB.
 * - Preferred: the AES key comes from a passkey (WebAuthn PRF), so every signature asks for the
 *   device's fingerprint, face or PIN, and nothing in the browser alone can decrypt the seed.
 * - Fallback (no PRF support): a non-extractable AES key kept in IndexedDB. Scripts in this page can
 *   use it but never export it; weaker against a compromised page, and the UI says so.
 * The seed and the ML-DSA secret key exist in memory only while signing and are wiped right after.
 */
import { generatePqcKeypair } from "@qorechain/sdk";
import { keccak256, toHex, type Address, type Hex } from "viem";
import type { PqKey } from "./pq";

type Mode = "passkey" | "browser";
interface Rec {
  account: string;
  mode: Mode;
  credId?: ArrayBuffer;
  salt?: ArrayBuffer;
  wrapKey?: CryptoKey;
  iv: ArrayBuffer;
  enc: ArrayBuffer;
  keyHash: Hex;
}

const DB = "qrow";
const STORE = "devices";

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "account" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("This browser can’t store a device key (storage blocked)."));
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const getRec = (account: Address) => tx<Rec | undefined>("readonly", (s) => s.get(account.toLowerCase()) as IDBRequest<Rec | undefined>);
const putRec = (r: Rec) => tx("readwrite", (s) => s.put(r));
export const forgetDevice = (account: Address) => tx("readwrite", (s) => s.delete(account.toLowerCase()));

const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

async function aesFromPrf(prf: ArrayBuffer): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("qrow-device-key-v1"), info: new Uint8Array() },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

type PrfResults = { enabled?: boolean; results?: { first?: ArrayBuffer } };
const prfOf = (c: Credential | null) => ((c as PublicKeyCredential | null)?.getClientExtensionResults() as { prf?: PrfResults } | undefined)?.prf;

async function prfSecret(credId: ArrayBuffer, salt: ArrayBuffer): Promise<ArrayBuffer> {
  const got = await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: "public-key", id: credId }],
      userVerification: "required",
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  });
  const first = prfOf(got)?.results?.first;
  if (!first) throw new Error("Your passkey didn’t unlock the device key. Try again.");
  return first;
}

/** Whether this browser has a device key for `account`, and how it's protected. */
export async function deviceInfo(account: Address): Promise<{ keyHash: Hex; mode: Mode } | undefined> {
  try {
    const r = await getRec(account);
    return r ? { keyHash: r.keyHash, mode: r.mode } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Create this browser's device key for `account`: a passkey if the device supports PRF, otherwise a
 * browser key. Returns the public key to register. Nothing secret leaves this function.
 */
export async function createDevice(account: Address): Promise<{ publicKey: Hex; mode: Mode }> {
  const seed = rand(32);
  try {
    let mode: Mode = "browser";
    let aes: CryptoKey | undefined;
    let credId: ArrayBuffer | undefined;
    const salt = buf(rand(32));
    if (window.PublicKeyCredential && navigator.credentials?.create) {
      try {
        const cred = await navigator.credentials.create({
          publicKey: {
            challenge: rand(32),
            rp: { name: "Qrow" },
            user: { id: rand(16), name: `Qrow device key ${account.slice(0, 6)}…${account.slice(-4)}`, displayName: "Qrow" },
            pubKeyCredParams: [
              { type: "public-key", alg: -7 },
              { type: "public-key", alg: -257 },
            ],
            authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
            extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
          },
        });
        const prf = prfOf(cred);
        if (cred && prf?.enabled) {
          credId = (cred as PublicKeyCredential).rawId;
          aes = await aesFromPrf(prf.results?.first ?? (await prfSecret(credId, salt)));
          mode = "passkey";
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "NotAllowedError") throw new Error("You cancelled the passkey prompt. Nothing was set up.");
        // Passkeys unavailable here (no authenticator, no PRF): fall back to a browser key.
      }
    }
    let wrapKey: CryptoKey | undefined;
    if (!aes) {
      wrapKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      aes = wrapKey;
    }
    const iv = rand(12);
    const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, seed);
    const kp = generatePqcKeypair(seed);
    const publicKey = toHex(kp.publicKey);
    kp.secretKey.fill(0);
    await putRec({ account: account.toLowerCase(), mode, credId, salt: mode === "passkey" ? salt : undefined, wrapKey, iv: buf(iv), enc, keyHash: keccak256(publicKey) });
    return { publicKey, mode };
  } finally {
    seed.fill(0);
  }
}

/** Decrypt the device key for one signature (asks for the passkey in passkey mode). Wipe it after use. */
export async function unlockDevice(account: Address): Promise<PqKey & { keyHash: Hex }> {
  const r = await getRec(account);
  if (!r) throw new Error("This browser has no Qrow device key for this account. Set it up on the Start page.");
  const aes = r.mode === "passkey" ? await aesFromPrf(await prfSecret(r.credId!, r.salt!)) : r.wrapKey!;
  const seed = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(r.iv) }, aes, r.enc));
  try {
    const kp = generatePqcKeypair(seed);
    return { secretKey: kp.secretKey, publicKey: kp.publicKey, keyHash: r.keyHash };
  } finally {
    seed.fill(0);
  }
}
