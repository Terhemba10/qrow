/**
 * action.ts — claim / cancel / release / refund an escrow payment from a script account, with the
 * same calls the web app's PqActionPanel makes (PQ digest → pqMessage → ML-DSA → simulate → send).
 *
 *   npm run action -- claim --id 2 --drill
 *   npm run action -- cancel --id 3
 *   npm run action -- refund --id 1          (after the deadline; no PQ signature needed)
 *
 * Needs a live EVM window that admits the escrow. Prints only public data.
 */
import { readFileSync } from "node:fs";
import { pqcSign } from "@qorechain/sdk";
import { encodeAbiParameters, formatEther, keccak256, toBytes, toHex, type Abi, type Address, type Hex } from "viem";
import { evmClients, loadAccount } from "./lib.js";
import { contractSecretKey } from "./lib.js";

const STATUS = ["None", "Pending", "Claimed", "Released", "Cancelled", "Refunded"];
const args = process.argv.slice(2);
const act = args[0] as "claim" | "cancel" | "release" | "refund";
const idArg = args[args.indexOf("--id") + 1];

async function main() {
  if (!["claim", "cancel", "release", "refund"].includes(act) || !idArg) throw new Error("Use: claim|cancel|release|refund --id N [--drill]");
  const id = BigInt(idArg);
  const demo = args.includes("--demo");
  const dep = JSON.parse(readFileSync("deployments/testnet.json", "utf8")) as { QrowEscrow: Address; QrowEscrowDemo?: Address };
  const escrow = demo ? dep.QrowEscrowDemo! : dep.QrowEscrow;
  if (demo) console.log(`DEMO escrow ${escrow} (10-minute refund period)`);
  const { abi } = JSON.parse(readFileSync(demo ? "out/QrowEscrowDemo.sol/QrowEscrowDemo.json" : "out/QrowEscrow.sol/QrowEscrow.json", "utf8")) as { abi: Abi };
  const acc = await loadAccount(args.includes("--drill") ? "DRILL_" : "");
  const { publicClient: c, walletClient: w, account } = evmClients(acc);
  const me = account.address;
  const read = <T>(fn: string, a: readonly unknown[] = []) => c.readContract({ address: escrow, abi, functionName: fn, args: a }) as Promise<T>;

  const before = await read<{ status: number; amount: bigint; sender: Address; recipient: Address }>("getPayment", [id]);
  console.log(`${act} #${id} as ${me}: status ${STATUS[before.status]}, ${formatEther(before.amount)} QOR, ${before.sender} → ${before.recipient}`);

  let callArgs: readonly unknown[] = [id];
  if (act !== "refund") {
    const actionName = { claim: "ACTION_CLAIM", cancel: "ACTION_CANCEL", release: "ACTION_RELEASE" }[act];
    const [action, nonce, block] = await Promise.all([read<Hex>(actionName), read<bigint>("pqNonce", [me]), c.getBlock()]);
    const validUntil = block.timestamp + 30n * 60n;
    const paramsHash = keccak256(encodeAbiParameters([{ type: "uint256" }], [id]));
    const digest = await read<Hex>("actionDigest", [action, me, nonce, validUntil, paramsHash]);
    const message = await read<Hex>("pqMessage", [digest]);
    const signature = toHex(pqcSign(contractSecretKey(acc), toBytes(message)));
    console.log(`ML-DSA-87 signature: ${(signature.length - 2) / 2} bytes (nonce ${nonce})`);
    callArgs = [id, validUntil, signature];
  }
  const fn = act === "refund" ? "refundExpired" : act;
  await c.simulateContract({ account, address: escrow, abi, functionName: fn, args: callArgs });
  console.log("simulation: OK");
  const hash = await w.writeContract({ address: escrow, abi, functionName: fn, args: callArgs, chain: w.chain, account });
  const r = await c.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted: ${hash}`);
  const after = await read<{ status: number }>("getPayment", [id]);
  console.log(`tx ${hash} (block ${r.blockNumber}, gas ${r.gasUsed}) → status ${STATUS[after.status]}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
