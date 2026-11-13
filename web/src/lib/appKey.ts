/**
 * Setting up and using this browser's Qrow device account (QrowKeys v3 + the approved fallback):
 * QoreX authorises (fee top-up, authz grant, EVM windows), the device executes. The device's
 * ML-DSA-87 key is registered twice: on chain for its own account (hybrid signatures) and in QrowKeys
 * as the user's device key (pqcVerify in Qrow's contracts). Nothing is ever shown to the user.
 */
import { buildRegisterPqcKeyMsg, evmToQor, fetchPqcStatus, msg, pqcSign, signProofOfPossession, type UnifiedAccount } from "@qorechain/sdk";
import { concat, encodeFunctionData, keccak256, toBytes, toHex, type Address, type Hex, type PublicClient } from "viem";
import { qrowKeysAbi } from "../abi/QrowKeys";
import { KEYS } from "../config/contracts";
import { NATIVE_CHAIN_ID, REST } from "../config/network";
import { createDevice, deviceInfo, forgetDevice, unlockDevice, wipe } from "./device";
import { deviceBroadcast, deviceQor } from "./native";
import type { PqKey } from "./pq";
import { signInQorex } from "./staking";
import { ensureWindow, qorexFor, runAsUser, waitForNativeTx } from "./xvm";

export const XVM_TYPE = "/qorechain.crossvm.v1.MsgCrossVMCall";
/** The device account keeps about this much QOR for its own fees; topped up from QoreX when below MIN. */
export const DEVICE_TOPUP_UQOR = 1_000_000n; // 1 QOR
export const DEVICE_MIN_UQOR = 300_000n; // 0.3 QOR
const GRANT_DAYS = 30;

export type DeviceState =
  | { s: "none" }
  | { s: "otherDevices"; count: number }
  | { s: "pending"; dueAt: number }
  | { s: "ready"; slot: number; mode: "passkey" | "browser"; address: string };

/** Where this browser's device stands for `account`. */
export async function deviceState(client: PublicClient, account: Address): Promise<DeviceState> {
  const [local, [slots, hashes], [propHash, dueAt]] = await Promise.all([
    deviceInfo(account),
    client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "devices", args: [account] }),
    client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "proposal", args: [account] }),
  ]);
  if (local) {
    const i = hashes.findIndex((h) => h.toLowerCase() === local.keyHash.toLowerCase());
    if (i >= 0) return { s: "ready", slot: slots[i], mode: local.mode, address: local.address };
    if (propHash.toLowerCase() === local.keyHash.toLowerCase()) return { s: "pending", dueAt: Number(dueAt) };
  }
  return slots.length ? { s: "otherDevices", count: slots.length } : { s: "none" };
}

export async function hasGrant(granter: string, grantee: string, typeUrl: string = XVM_TYPE): Promise<boolean> {
  const r = await fetch(`${REST}/cosmos/authz/v1beta1/grants?granter=${granter}&grantee=${grantee}&msg_type_url=${encodeURIComponent(typeUrl)}`);
  if (!r.ok) return false;
  const j = (await r.json()) as { grants?: { expiration?: string }[] };
  return (j.grants ?? []).some((g) => !g.expiration || Date.parse(g.expiration) > Date.now() + 86_400_000);
}

/** GenericAuthorization { msg = 1 } as protobuf bytes. */
function genericAuth(typeUrl: string): Uint8Array {
  const b = new TextEncoder().encode(typeUrl);
  return new Uint8Array([0x0a, b.length, ...b]);
}

export function grantMsg(granter: string, grantee: string, typeUrl: string, seconds: number) {
  return msg.authz.grant({
    granter,
    grantee,
    grant: {
      authorization: { typeUrl: "/cosmos.authz.v1beta1.GenericAuthorization", value: genericAuth(typeUrl) },
      expiration: { seconds: BigInt(Math.floor(Date.now() / 1000) + seconds), nanos: 0 },
    },
  });
}

/** Sign one QrowKeys action as the user with a key (proof of possession for the new device key). */
export async function signOnKeys(client: PublicClient, key: PqKey, user: Address, params: Hex) {
  const [action, nonce, block] = await Promise.all([
    client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "ACTION_ADD_DEVICE" }),
    client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "pqNonce", args: [user] }),
    client.getBlock(),
  ]);
  const validUntil = block.timestamp + 30n * 60n;
  const digest = await client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "actionDigest", args: [action, user, nonce, validUntil, params] });
  const message = await client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "pqMessage", args: [digest] });
  return { validUntil, signature: toHex(pqcSign(key.secretKey, toBytes(message))) };
}

export type SetupStep = "device" | "qorex" | "deviceKey" | "window" | "register" | "done";

/**
 * Set up this browser for `user`. Steps already done on chain are skipped, so it can be resumed.
 * QoreX asks the user twice (top-up + permission, then the window); the device asks for the passkey.
 */
export async function setUpThisDevice(client: PublicClient, user: Address, onStep: (s: SetupStep) => void): Promise<{ instant: boolean; mode: "passkey" | "browser" }> {
  const userQor = await qorexFor(user);
  onStep("device");
  let local = await deviceInfo(user);
  if (!local) {
    const made = await createDevice(user);
    local = { keyHash: keccak256(made.publicKey), mode: made.mode, address: made.address };
  }

  // QoreX: fees for the device and the permission to act inside the user's windows.
  const [bal, granted] = await Promise.all([deviceQor(local.address), hasGrant(userQor, local.address)]);
  const msgs = [];
  if (bal < DEVICE_MIN_UQOR) msgs.push(msg.bank.send({ fromAddress: userQor, toAddress: local.address, amount: [{ denom: "uqor", amount: DEVICE_TOPUP_UQOR.toString() }] }));
  if (!granted) msgs.push(grantMsg(userQor, local.address, XVM_TYPE, GRANT_DAYS * 86_400));
  if (msgs.length) {
    onStep("qorex");
    const r = await signInQorex(msgs, "Qrow: set up this device", 200_000 * msgs.length);
    await waitForNativeTx(r.txHash);
  }

  const device = await unlockDevice(user);
  try {
    // The device's own quantum-safe key, so its transactions carry ML-DSA-87 signatures.
    const status = await fetchPqcStatus({ rest: REST, address: device.cosmos } as never).catch(() => undefined);
    if (!(status as { registered?: boolean } | undefined)?.registered) {
      onStep("deviceKey");
      const proofOfPossession = signProofOfPossession({ chainId: NATIVE_CHAIN_ID, account: device.cosmos, keypair: device.pqc });
      await deviceBroadcast(device, [buildRegisterPqcKeyMsg(device.cosmos, { pqcKeypair: device.pqc, proofOfPossession })], 600_000, "classical");
    }

    // Register this device's key in QrowKeys, as the user, inside a window QoreX opens.
    const count = await client.readContract({ address: KEYS, abi: qrowKeysAbi, functionName: "deviceCount", args: [user] });
    onStep("window");
    await ensureWindow(user, [KEYS], 1);
    onStep("register");
    const publicKey = toHex(device.pqc.publicKey);
    const { validUntil, signature } = await signOnKeys(client, device.pqc, user, keccak256(publicKey));
    const functionName = count === 0 ? "addFirstDevice" : "proposeDevice";
    const data = encodeFunctionData({ abi: qrowKeysAbi, functionName, args: [publicKey, validUntil, signature] });
    await runAsUser(client, user, device, [{ to: KEYS, data }]);
    onStep("done");
    return { instant: count === 0, mode: local.mode };
  } finally {
    wipe(device);
  }
}

/** Top the device account up from QoreX (when its fee balance runs low). */
export async function topUpDevice(user: Address) {
  const userQor = await qorexFor(user);
  const local = await deviceInfo(user);
  if (!local) throw new Error("Set up this device first.");
  const r = await signInQorex([msg.bank.send({ fromAddress: userQor, toAddress: local.address, amount: [{ denom: "uqor", amount: DEVICE_TOPUP_UQOR.toString() }] })], "Qrow: device fees", 200_000);
  await waitForNativeTx(r.txHash);
}

/** Finish or cancel a 3-day proposal (as the user, inside a window). */
async function keysCall(client: PublicClient, user: Address, functionName: "finishProposal" | "cancelProposal") {
  await ensureWindow(user, [KEYS], 1);
  const device = await unlockDevice(user);
  try {
    await runAsUser(client, user, device, [{ to: KEYS, data: encodeFunctionData({ abi: qrowKeysAbi, functionName }) }]);
  } finally {
    wipe(device);
  }
}
export const finishProposal = (client: PublicClient, user: Address) => keysCall(client, user, "finishProposal");
export const cancelProposal = (client: PublicClient, user: Address) => keysCall(client, user, "cancelProposal");

export const forgetThisDevice = forgetDevice;

/** Unlock this browser's device for one action: its account (to execute) and its slot (to sign). */
export async function unlockForSigning(client: PublicClient, user: Address): Promise<{ key: PqKey; slot: number; device: UnifiedAccount }> {
  const st = await deviceState(client, user);
  if (st.s !== "ready") throw new Error(st.s === "pending" ? "This device is still in its 3-day wait." : "Set up this device on the Start page first.");
  const device = await unlockDevice(user);
  if ((await deviceQor(device.cosmos)) < DEVICE_MIN_UQOR / 3n) {
    wipe(device);
    throw new Error("This device has almost no QOR left for fees. Top it up from QoreX on the Start page.");
  }
  return { key: device.pqc, slot: st.slot, device };
}

/** A device-key signature as the contracts expect it: slot byte, then the ML-DSA-87 signature. */
export const withSlot = (slot: number, signature: Hex): Hex => concat([toHex(slot, { size: 1 }), signature]);

/** Exposed for the readiness card. */
export const userQorOf = (user: Address) => evmToQor(user);
