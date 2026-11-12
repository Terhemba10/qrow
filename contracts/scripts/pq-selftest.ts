/**
 * pq-selftest.ts — prove, against the LIVE testnet precompiles, that an ML-DSA-87 signature made
 * in JS with the account's registered key is accepted by pqcVerify over the exact bytes
 * QrowEscrow asks for. Read-only (eth_call): no window, no gas, no funds move.
 *
 *   pnpm pq:selftest            uses a stand-in digest
 *   (with QROW_ESCROW_ADDRESS)  also asks the deployed escrow for a real CLAIM digest
 */
import { pqcSign } from "@qorechain/sdk";
import { messagePqSignBytes } from "@qorechain/qoresign";
import { encodeAbiParameters, keccak256, toBytes, toHex, type Hex } from "viem";
import { evmClients, loadAccount } from "./lib.js";

const PQC_VERIFY = "0x0000000000000000000000000000000000000A01";
const PQC_KEY_STATUS = "0x0000000000000000000000000000000000000A02";

const pqcAbi = [
  {
    type: "function",
    name: "pqcVerify",
    stateMutability: "view",
    inputs: [
      { name: "pubkey", type: "bytes" },
      { name: "signature", type: "bytes" },
      { name: "message", type: "bytes" },
    ],
    outputs: [{ name: "valid", type: "bool" }],
  },
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

const escrowAbi = [
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
  { type: "function", name: "ACTION_CLAIM", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  {
    type: "function",
    name: "pqMessage",
    stateMutability: "view",
    inputs: [{ name: "digest", type: "bytes32" }],
    outputs: [{ type: "bytes" }],
  },
  {
    type: "function",
    name: "hasPqKey",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

async function main() {
  const acc = await loadAccount(process.argv.includes("--drill") ? "DRILL_" : "");
  const { publicClient } = evmClients(acc);
  console.log(`account: ${acc.evm}`);

  const [registered, alg, pubkey, proven] = await publicClient.readContract({
    address: PQC_KEY_STATUS,
    abi: pqcAbi,
    functionName: "pqcKeyStatus",
    args: [acc.evm as Hex],
  });
  console.log(`key status: registered=${registered} alg=${alg} proven=${proven} pubkeyLen=${(pubkey.length - 2) / 2}`);
  if (!registered) throw new Error("No PQC key registered: run `pnpm window register` first");
  if (pubkey.toLowerCase() !== toHex(acc.pqc.publicKey).toLowerCase()) {
    throw new Error("The registered key is not the key derived from .env (wrong recovery code?)");
  }

  let digest: Hex = keccak256(toBytes("qrow pq self-test"));
  const escrow = process.env.QROW_ESCROW_ADDRESS?.trim() as Hex | undefined;
  if (escrow) {
    const action = await publicClient.readContract({ address: escrow, abi: escrowAbi, functionName: "ACTION_CLAIM" });
    const params = keccak256(encodeAbiParameters([{ type: "uint256" }], [1n]));
    const validUntil = BigInt(Math.floor(Date.now() / 1000) + 600);
    digest = await publicClient.readContract({
      address: escrow,
      abi: escrowAbi,
      functionName: "actionDigest",
      args: [action, acc.evm as Hex, 0n, validUntil, params],
    });
    const has = await publicClient.readContract({
      address: escrow,
      abi: escrowAbi,
      functionName: "hasPqKey",
      args: [acc.evm as Hex],
    });
    console.log(`escrow.hasPqKey: ${has}`);
  }

  // The bytes QrowEscrow verifies: QoreSign's message format over the digest as 0x-hex text.
  let message: Hex = toHex(messagePqSignBytes("qorechain-diana", digest));
  if (escrow) {
    const onChain = await publicClient.readContract({ address: escrow, abi: escrowAbi, functionName: "pqMessage", args: [digest] });
    console.log(`escrow.pqMessage matches QoreSign: ${onChain.toLowerCase() === message.toLowerCase()}`);
    message = onChain;
  }
  const sig = pqcSign(acc.pqc.secretKey, toBytes(message));
  const ok = await publicClient.readContract({
    address: PQC_VERIFY,
    abi: pqcAbi,
    functionName: "pqcVerify",
    args: [pubkey, toHex(sig), message],
  });
  const tampered = Uint8Array.from(sig);
  tampered[100] ^= 0x01;
  const bad = await publicClient.readContract({
    address: PQC_VERIFY,
    abi: pqcAbi,
    functionName: "pqcVerify",
    args: [pubkey, toHex(tampered), message],
  });
  console.log(`pqcVerify(real signature):     ${ok}   (expect true)`);
  console.log(`pqcVerify(tampered signature): ${bad}  (expect false)`);
  if (!ok || bad) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
