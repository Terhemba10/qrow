/**
 * deploy-demo.ts: deploy QrowEscrowDemo (10-minute refund period, demo only).
 *   npm run window -- open --txs 1 --blocks 120 --value 3000000
 *   npm run deploy:demo
 *   npm run window -- close
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { Abi, Hex } from "viem";
import { evmClients, loadAccount } from "./lib.js";

async function main() {
  const a = JSON.parse(readFileSync("out/QrowEscrowDemo.sol/QrowEscrowDemo.json", "utf8")) as { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
  const acc = await loadAccount();
  const { publicClient: c, walletClient: w, account } = evmClients(acc);
  const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args: ["qorechain-diana"], account, chain: w.chain });
  const r = await c.waitForTransactionReceipt({ hash });
  if (r.status !== "success" || !r.contractAddress) throw new Error(`deploy failed ${hash}`);
  const code = await c.getCode({ address: r.contractAddress });
  console.log(`QrowEscrowDemo: ${r.contractAddress} (tx ${hash}, block ${r.blockNumber}, gas ${r.gasUsed}, bytecode ${code?.toLowerCase() === a.deployedBytecode.object.toLowerCase() ? "matches build" : "differs"})`);
  const dep = JSON.parse(readFileSync("deployments/testnet.json", "utf8"));
  dep.QrowEscrowDemo = r.contractAddress;
  dep.demo = { note: "DEMO ONLY: QrowEscrow with a 10-minute refund period, to show refunds in the video", tx: hash, block: Number(r.blockNumber) };
  writeFileSync("deployments/testnet.json", JSON.stringify(dep, null, 2) + "\n");
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
