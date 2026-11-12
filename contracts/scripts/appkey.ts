/**
 * appkey.ts: the account's Qrow app key in QrowKeys (the same flow the web app runs for QoreX users).
 *
 *   npm run appkey -- status [--drill]
 *   npm run window -- open --txs 1 --blocks 120 --targets <QrowKeys>
 *   npm run appkey -- register [--drill]      creates a QRC1 code if none, saves it to .env (never printed)
 *   npm run window -- close
 */
import { appendFileSync, readFileSync } from "node:fs";
import { generatePqcRecoveryCode, pqcKeyFromRecoveryCode, pqcSign } from "@qorechain/sdk";
import { keccak256, toBytes, toHex, type Abi, type Address, type Hex } from "viem";
import { appKeyEnv, evmClients, loadAccount } from "./lib.js";

const args = process.argv.slice(2);
const prefix = args.includes("--drill") ? "DRILL_" : "";
const dep = JSON.parse(readFileSync("deployments/testnet.json", "utf8")) as { QrowKeys: Address };
const { abi } = JSON.parse(readFileSync("out/QrowKeys.sol/QrowKeys.json", "utf8")) as { abi: Abi };

async function main() {
  const acc = await loadAccount(prefix);
  const { publicClient: c, walletClient: w, account } = evmClients(acc);
  const me = account.address;
  const read = <T>(fn: string, a: readonly unknown[] = []) => c.readContract({ address: dep.QrowKeys, abi, functionName: fn, args: a }) as Promise<T>;

  if (args[0] === "status") {
    const [has, resetAt] = await Promise.all([read<boolean>("hasAppKey", [me]), read<bigint>("resetAt", [me])]);
    console.log(`${me}: app key ${has ? "registered" : "none"}${resetAt ? `, reset pending until ${new Date(Number(resetAt) * 1000).toISOString()}` : ""}; .env code ${process.env[appKeyEnv(prefix)] ? "present" : "absent"}`);
    return;
  }
  if (args[0] !== "register") throw new Error("Use: status | register [--drill]");

  let code = process.env[appKeyEnv(prefix)]?.trim();
  if (!code) {
    code = generatePqcRecoveryCode();
    appendFileSync(".env", `\n# Qrow app key for ${me} (QrowKeys). Secret: never share.\n${appKeyEnv(prefix)}=${code}\n`);
    console.log(`new app key code saved to .env as ${appKeyEnv(prefix)} (not printed)`);
  }
  const kp = pqcKeyFromRecoveryCode(code, acc.cosmos);
  const pubkey = toHex(kp.publicKey);
  const [action, nonce, block] = await Promise.all([read<Hex>("ACTION_REGISTER"), read<bigint>("pqNonce", [me]), c.getBlock()]);
  const validUntil = block.timestamp + 30n * 60n;
  const digest = await read<Hex>("actionDigest", [action, me, nonce, validUntil, keccak256(pubkey)]);
  const message = await read<Hex>("pqMessage", [digest]);
  const pop = toHex(pqcSign(kp.secretKey, toBytes(message)));
  await c.simulateContract({ account, address: dep.QrowKeys, abi, functionName: "register", args: [pubkey, validUntil, pop] });
  console.log("simulation: OK");
  const hash = await w.writeContract({ address: dep.QrowKeys, abi, functionName: "register", args: [pubkey, validUntil, pop], chain: w.chain, account });
  const r = await c.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted: ${hash}`);
  console.log(`registered app key: tx ${hash} (block ${r.blockNumber}, gas ${r.gasUsed}); keyOf matches: ${(await read<Hex>("keyOf", [me])).toLowerCase() === pubkey.toLowerCase()}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
