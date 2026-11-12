/**
 * The Qrow app key: a separate ML-DSA-87 key Qrow makes in this browser for accounts whose chain key
 * lives in QoreX (which can't sign messages). Registered once in QrowKeys; every Qrow contract then
 * verifies actions against it. The recovery code (QRC1) is shown once for the user to save; Qrow
 * never stores, logs or sends it, and the secret key is wiped from memory after registering.
 */
import { evmToQor, generatePqcRecoveryCode, pqcKeyFromRecoveryCode, pqcSign } from "@qorechain/sdk";
import { keccak256, toBytes, toHex, type Address, type Hex, type PublicClient } from "viem";
import { qrowKeysAbi } from "../abi/QrowKeys";
import { KEYS } from "../config/contracts";

export async function hasAppKey(client: PublicClient, account: Address): Promise<boolean> {
  return client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "hasAppKey", args: [account] });
}

/** A new code, and the public key it makes for this account (the code alone is the secret). */
export function newAppKeyCode(account: Address): { code: string; publicKey: Hex } {
  const code = generatePqcRecoveryCode();
  const kp = pqcKeyFromRecoveryCode(code, evmToQor(account));
  const publicKey = toHex(kp.publicKey);
  kp.secretKey.fill(0);
  return { code, publicKey };
}

/** Arguments for QrowKeys.register: the new key signs its own registration (proof of possession). */
export async function registerArgs(client: PublicClient, account: Address, code: string): Promise<readonly [Hex, bigint, Hex]> {
  const kp = pqcKeyFromRecoveryCode(code, evmToQor(account));
  try {
    const publicKey = toHex(kp.publicKey);
    const [action, nonce, block] = await Promise.all([
      client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "ACTION_REGISTER" }),
      client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "pqNonce", args: [account] }),
      client.getBlock(),
    ]);
    const validUntil = block.timestamp + 30n * 60n;
    const digest = await client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "actionDigest", args: [action, account, nonce, validUntil, keccak256(publicKey)] });
    const message = await client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "pqMessage", args: [digest] });
    return [publicKey, validUntil, toHex(pqcSign(kp.secretKey, toBytes(message)))] as const;
  } finally {
    kp.secretKey.fill(0);
  }
}
