/**
 * Post-quantum signing for escrow actions.
 *
 * Today QoreX can't sign arbitrary messages, so the ML-DSA-87 key is derived in this tab from the
 * account's PQC recovery code (QRC1). The code and the key live only in memory while you sign and
 * are dropped right after. They are never stored, logged or sent anywhere.
 *
 * The signed bytes are QoreSign's message format, the same bytes QoreX's planned signArbitrary
 * will sign, so the QoreX path drops in here later without contract changes.
 */
import { isValidRecoveryCode, pqcKeyFromRecoveryCode, pqcSign } from "@qorechain/sdk";
import { encodeAbiParameters, keccak256, toBytes, toHex, type Address, type Hex, type PublicClient } from "viem";
import { evmToQor } from "@qorechain/sdk";
import { qrowEscrowAbi } from "../abi/QrowEscrow";
import { ESCROW, REST } from "../config/network";

const PQC_KEY_STATUS: Address = "0x0000000000000000000000000000000000000a02";
const keyStatusAbi = [
  {
    type: "function",
    name: "pqcKeyStatus",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "registered", type: "bool" },
      { name: "algorithmId", type: "uint8" },
      { name: "pubkey", type: "bytes" },
      { name: "possessionProven", type: "bool" },
    ],
  },
] as const;

export interface PqKey {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export type UnlockError = "format" | "mismatch" | "noKey";

/** Derive the account's ML-DSA-87 key from its recovery code and check it's the registered one. */
export async function unlockPqKey(
  client: PublicClient,
  account: Address,
  code: string,
): Promise<{ ok: true; key: PqKey } | { ok: false; reason: UnlockError }> {
  if (!isValidRecoveryCode(code.trim())) return { ok: false, reason: "format" };
  const [registered, alg, pubkey, proven] = await client.readContract({
    address: PQC_KEY_STATUS,
    abi: keyStatusAbi,
    functionName: "pqcKeyStatus",
    args: [account],
  });
  if (!registered || alg !== 1 || !proven) return { ok: false, reason: "noKey" };
  const kp = pqcKeyFromRecoveryCode(code.trim(), evmToQor(account));
  if (toHex(kp.publicKey).toLowerCase() !== pubkey.toLowerCase()) {
    kp.secretKey.fill(0);
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, key: kp };
}

/** Wipe a key from memory (best effort in JS). */
export const forget = (k?: PqKey) => k?.secretKey.fill(0);

/** Build and sign the PQ authorisation for createPayment, exactly as QrowEscrow verifies it. */
export async function signCreate(
  client: PublicClient,
  key: PqKey,
  sender: Address,
  p: { recipient: Address; token: Address; amount: bigint; mode: 0 | 1; sealedNote: Hex },
): Promise<{ validUntil: bigint; signature: Hex }> {
  const [action, nonce, block] = await Promise.all([
    client.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "ACTION_CREATE" }),
    client.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "pqNonce", args: [sender] }),
    client.getBlock(),
  ]);
  // Valid for 30 minutes from chain time (the contract allows at most 1 hour).
  const validUntil = block.timestamp + 30n * 60n;
  const paramsHash = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "bytes32" }],
      [p.recipient, p.token, p.amount, p.mode, keccak256(p.sealedNote)],
    ),
  );
  const digest = await client.readContract({
    address: ESCROW,
    abi: qrowEscrowAbi,
    functionName: "actionDigest",
    args: [action, sender, nonce, validUntil, paramsHash],
  });
  const message = await client.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "pqMessage", args: [digest] });
  const signature = toHex(pqcSign(key.secretKey, toBytes(message)));
  return { validUntil, signature };
}

export interface WindowStatus {
  found: boolean;
  live: boolean;
  remainingTxs: number;
  remainingBlocks: number;
  allowedTargets: string[];
}

/** The sender's EVM authorisation window (native lane), read over REST. */
export async function readWindow(account: Address): Promise<WindowStatus> {
  const res = await fetch(`${REST}/qorechain/pqc/v1/evm_window/${evmToQor(account)}`);
  if (!res.ok) throw new Error(`window: HTTP ${res.status}`);
  const w = (await res.json()) as {
    found: boolean;
    live: boolean;
    remaining_txs: string;
    remaining_blocks: string;
    allowed_targets: string[];
  };
  return {
    found: w.found,
    live: w.live,
    remainingTxs: Number(w.remaining_txs || 0),
    remainingBlocks: Number(w.remaining_blocks || 0),
    allowedTargets: (w.allowed_targets ?? []).map((t) => t.toLowerCase()),
  };
}
