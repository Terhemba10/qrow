/**
 * pay.ts — send one escrow payment from a script account, with exactly the calls the web app makes
 * (web/src/lib/pq.ts signCreate → simulateContract → createPayment). Native QOR only.
 *
 *   npm run pay -- --to 0x… --amount 1 [--freelancer] [--drill]
 *
 * Needs a live EVM window that admits the escrow (npm run window -- open ... --targets <escrow>).
 * Prints only public data: addresses, the payment id and transaction hashes.
 */
import { readFileSync } from "node:fs";
import { pqcSign } from "@qorechain/sdk";
import { type Abi, encodeAbiParameters, getAddress, keccak256, parseEther, parseEventLogs, toBytes, toHex, type Address, type Hex } from "viem";
import { evmClients, loadAccount } from "./lib.js";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? undefined : args[i + 1];
};

async function main() {
  const dep = JSON.parse(readFileSync("deployments/testnet.json", "utf8")) as { QrowEscrow: Address };
  const { abi } = JSON.parse(readFileSync("out/QrowEscrow.sol/QrowEscrow.json", "utf8")) as { abi: Abi };
  const escrow = dep.QrowEscrow;
  const to = getAddress(flag("to") ?? "");
  const amount = parseEther(flag("amount") ?? "");
  const mode = args.includes("--freelancer") ? 1 : 0;
  const acc = await loadAccount(args.includes("--drill") ? "DRILL_" : "");
  const { publicClient: c, walletClient: w, account } = evmClients(acc);
  const sender = account.address;
  console.log(`sender ${sender} → recipient ${to}, ${flag("amount")} QOR, mode ${mode ? "freelancer" : "direct"}`);

  const read = <T>(functionName: string, a: readonly unknown[] = []) =>
    c.readContract({ address: escrow, abi, functionName, args: a }) as Promise<T>;

  // Same digest and message the browser builds.
  const sealedNote: Hex = "0x";
  const [action, nonce, block] = await Promise.all([read<Hex>("ACTION_CREATE"), read<bigint>("pqNonce", [sender]), c.getBlock()]);
  const validUntil = block.timestamp + 30n * 60n;
  const paramsHash = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "bytes32" }],
      [to, "0x0000000000000000000000000000000000000000", amount, mode, keccak256(sealedNote)],
    ),
  );
  const digest = await read<Hex>("actionDigest", [action, sender, nonce, validUntil, paramsHash]);
  const message = await read<Hex>("pqMessage", [digest]);
  const signature = toHex(pqcSign(acc.pqc.secretKey, toBytes(message)));
  console.log(`ML-DSA-87 signature: ${(signature.length - 2) / 2} bytes over ${(message.length - 2) / 2}-byte QoreSign message (nonce ${nonce})`);

  const callArgs = [to, "0x0000000000000000000000000000000000000000", amount, mode, sealedNote, validUntil, signature] as const;
  const sim = await c.simulateContract({ account, address: escrow, abi, functionName: "createPayment", args: callArgs, value: amount });
  console.log(`simulation: OK, would create payment #${sim.result as bigint}`);

  const hash = await w.writeContract({ address: escrow, abi, functionName: "createPayment", args: callArgs, value: amount, chain: w.chain, account });
  console.log(`tx: ${hash}`);
  const r = await c.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("transaction reverted");
  const [ev] = parseEventLogs({ abi: abi as never, logs: r.logs, eventName: "PaymentCreated" }) as unknown as { args: { id: bigint; deadline: bigint } }[];
  console.log(`PaymentCreated #${ev.args.id} in block ${r.blockNumber}, gas used ${r.gasUsed}, refundable after ${new Date(Number(ev.args.deadline) * 1000).toISOString()}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
