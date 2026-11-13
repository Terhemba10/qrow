/**
 * Post-quantum signing for Qrow's contracts. The ML-DSA-87 key is this browser's Qrow device key
 * (lib/device.ts, unlocked with a passkey for each signature, wiped right after); the signed bytes
 * are QoreSign's message format, which the contracts verify with pqcVerify.
 */
import { pqcSign } from "@qorechain/sdk";
import { encodeAbiParameters, keccak256, toBytes, toHex, type Address, type Hex, type PublicClient } from "viem";
import { qrowEscrowAbi } from "../abi/QrowEscrow";
import { ESCROW } from "../config/network";

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


/** The account's ML-DSA-87 key registered on QoreChain (QoreX registers it with the first transfer). */
export async function chainKeyRegistered(client: PublicClient, account: Address): Promise<boolean> {
  const [registered, alg, , proven] = await client.readContract({ address: PQC_KEY_STATUS, abi: keyStatusAbi, functionName: "pqcKeyStatus", args: [account] });
  return registered && alg === 1 && proven;
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
