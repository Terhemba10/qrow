/**
 * Generic post-quantum authorisation for any Qrow contract (QrowEscrow and every PqAuth contract
 * share actionDigest / pqNonce / pqMessage). Builds exactly the bytes the contract verifies.
 */
import { pqcSign } from "@qorechain/sdk";
import { toBytes, toHex, type Address, type Hex, type PublicClient } from "viem";
import type { PqKey } from "./pq";

export const pqAuthAbi = [
  {
    type: "function",
    name: "actionDigest",
    stateMutability: "view",
    inputs: [
      { name: "action", type: "bytes32" },
      { name: "signer", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "validUntil", type: "uint64" },
      { name: "paramsHash", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  { type: "function", name: "pqNonce", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pqMessage", stateMutability: "view", inputs: [{ name: "d", type: "bytes32" }], outputs: [{ type: "bytes" }] },
  { type: "function", name: "hasPqKey", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "bool" }] },
] as const;

const actionConstAbi = (name: string) =>
  [{ type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }] as const;

/** Read an action constant such as ACTION_CLAIM from the contract itself (never hard-coded). */
export function readAction(client: PublicClient, contract: Address, name: string): Promise<Hex> {
  return client.readContract({ address: contract, abi: actionConstAbi(name), functionName: name }) as Promise<Hex>;
}

export async function signPqAction(
  client: PublicClient,
  key: PqKey,
  contract: Address,
  actionName: string,
  signer: Address,
  paramsHash: Hex,
): Promise<{ validUntil: bigint; signature: Hex }> {
  const [action, nonce, block] = await Promise.all([
    readAction(client, contract, actionName),
    client.readContract({ address: contract, abi: pqAuthAbi, functionName: "pqNonce", args: [signer] }),
    client.getBlock(),
  ]);
  const validUntil = block.timestamp + 30n * 60n;
  const digest = await client.readContract({
    address: contract,
    abi: pqAuthAbi,
    functionName: "actionDigest",
    args: [action, signer, nonce, validUntil, paramsHash],
  });
  const message = await client.readContract({ address: contract, abi: pqAuthAbi, functionName: "pqMessage", args: [digest] });
  return { validUntil, signature: toHex(pqcSign(key.secretKey, toBytes(message))) };
}
