/**
 * Registering and using this browser's Qrow device key (QrowKeys v3). All transactions go through
 * QoreX (lib/xvm.ts); the key itself lives in lib/device.ts and is never shown.
 */
import { pqcSign } from "@qorechain/sdk";
import { concat, encodeFunctionData, keccak256, toBytes, toHex, type Address, type Hex, type PublicClient } from "viem";
import { qrowKeysAbi } from "../abi/QrowKeys";
import { KEYS } from "../config/contracts";
import { createDevice, deviceInfo, forgetDevice, unlockDevice } from "./device";
import type { PqKey } from "./pq";
import { sendViaQorex } from "./xvm";

export type DeviceState =
  | { s: "none" } // no device key in this browser, account has none either
  | { s: "otherDevices"; count: number } // the account has keys on other devices, not this one
  | { s: "pending"; dueAt: number } // this browser's key was proposed and is waiting out the delay
  | { s: "ready"; slot: number; mode: "passkey" | "browser" };

/** Where this browser's key stands for `account`. */
export async function deviceState(client: PublicClient, account: Address): Promise<DeviceState> {
  const [local, [slots, hashes], [propHash, dueAt]] = await Promise.all([
    deviceInfo(account),
    client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "devices", args: [account] }),
    client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "proposal", args: [account] }),
  ]);
  if (local) {
    const i = hashes.findIndex((h) => h.toLowerCase() === local.keyHash.toLowerCase());
    if (i >= 0) return { s: "ready", slot: slots[i], mode: local.mode };
    if (propHash.toLowerCase() === local.keyHash.toLowerCase()) return { s: "pending", dueAt: Number(dueAt) };
  }
  return slots.length ? { s: "otherDevices", count: slots.length } : { s: "none" };
}

/** Sign one QrowKeys action with a key (proof of possession for a new key). */
async function signOnKeys(client: PublicClient, key: PqKey, account: Address, actionName: "ACTION_ADD_DEVICE", params: Hex) {
  const [action, nonce, block] = await Promise.all([
    client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: actionName }),
    client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "pqNonce", args: [account] }),
    client.getBlock(),
  ]);
  const validUntil = block.timestamp + 30n * 60n;
  const digest = await client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "actionDigest", args: [action, account, nonce, validUntil, params] });
  const message = await client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "pqMessage", args: [digest] });
  return { validUntil, signature: toHex(pqcSign(key.secretKey, toBytes(message))) };
}

/**
 * Set up this browser: create its key (passkey prompt), then register it through QoreX. The first
 * device registers instantly; with keys on other devices it becomes a 3-day proposal the owner can
 * cancel (and is alerted about).
 */
export async function setUpThisDevice(client: PublicClient, account: Address): Promise<{ instant: boolean; mode: "passkey" | "browser" }> {
  let local = await deviceInfo(account);
  if (!local) {
    const made = await createDevice(account);
    local = { keyHash: keccak256(made.publicKey), mode: made.mode };
  }
  const key = await unlockDevice(account);
  try {
    const publicKey = toHex(key.publicKey);
    const count = await client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "deviceCount", args: [account] });
    const { validUntil, signature } = await signOnKeys(client, key, account, "ACTION_ADD_DEVICE", keccak256(publicKey));
    const functionName = count === 0 ? "addFirstDevice" : "proposeDevice";
    const data = encodeFunctionData({ abi: qrowKeysAbi, functionName, args: [publicKey, validUntil, signature] });
    await client.simulateContract({ account, address: KEYS, abi: qrowKeysAbi, functionName, args: [publicKey, validUntil, signature] });
    await sendViaQorex(client, account, KEYS, data);
    return { instant: count === 0, mode: local.mode };
  } finally {
    key.secretKey.fill(0);
  }
}

/** Finish a 3-day proposal once it's due. */
export async function finishProposal(client: PublicClient, account: Address) {
  await sendViaQorex(client, account, KEYS, encodeFunctionData({ abi: qrowKeysAbi, functionName: "finishProposal" }));
}

/** Cancel a proposal you didn't make. */
export async function cancelProposal(client: PublicClient, account: Address) {
  await sendViaQorex(client, account, KEYS, encodeFunctionData({ abi: qrowKeysAbi, functionName: "cancelProposal" }));
}

/** Forget this browser's key locally (the on-chain slot stays until removed). */
export const forgetThisDevice = forgetDevice;

/** Unlock this browser's key for one signature, with its slot. Throws if it isn't registered yet. */
export async function unlockForSigning(client: PublicClient, account: Address): Promise<{ key: PqKey; slot: number }> {
  const st = await deviceState(client, account);
  if (st.s !== "ready") throw new Error(st.s === "pending" ? "This browser’s device key is still in its 3-day wait." : "Set up this device on the Start page first.");
  const key = await unlockDevice(account);
  return { key, slot: st.slot };
}

/** A device-key signature as the contracts expect it: slot byte, then the ML-DSA-87 signature. */
export const withSlot = (slot: number, signature: Hex): Hex => concat([toHex(slot, { size: 1 }), signature]);
