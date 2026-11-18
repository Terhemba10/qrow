/**
 * deploy-perps-v2.ts: deploy ONLY the new QrowPerps (take profit / stop loss). Predict and Editions stay as they are.
 * Reuses PRICE_SIGNER_KEY from .env, enables the six pairs and funds the pool from the deployer's ERC-20 fUSD.
 *
 *   forge build
 *   npm run window -- open --txs 10 --blocks 400 --value 10000000
 *   npm run deploy:perps-v2 -- [--pool-fusd 40]
 *   npm run window -- close
 *
 * The old perps contract stays on chain (its 100 fUSD pool can't be withdrawn by design) and is kept in
 * deployments/testnet.json as sprint2.QrowPerpsV1. Update VITE_QROW_PERPS and QROW_PERPS_ADDRESS in Vercel after.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { erc20Abi, keccak256, toBytes, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { evmClients, loadAccount, requireEnv } from "./lib.js";

const FUSD: Address = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const CHAIN = "qorechain-diana";
const PAIRS = ["QOR/USDT", "QOR/ETH", "QOR/SOL", "ETH/USDT", "SOL/USDT", "BNB/USDT"];
const i = process.argv.indexOf("--pool-fusd");
const poolWant = BigInt(Math.round(Number(i === -1 ? "40" : process.argv[i + 1]) * 1e6));
const art = (n: string) => JSON.parse(readFileSync(`out/${n}.sol/${n}.json`, "utf8")) as { abi: Abi; bytecode: { object: Hex } };

async function main() {
  const file = "deployments/testnet.json";
  const dep = JSON.parse(readFileSync(file, "utf8"));
  if (!dep.sprint2?.QrowPerps) throw new Error("No sprint2 deployment found");
  const signer = privateKeyToAccount(requireEnv("PRICE_SIGNER_KEY") as Hex).address;
  const acc = await loadAccount();
  const { publicClient: c, walletClient: w, account } = evmClients(acc);
  let nonce = await c.getTransactionCount({ address: account.address, blockTag: "pending" });
  const wait = async (hash: Hex, what: string) => {
    const r = await c.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${what} failed (${hash})`);
    return r;
  };
  const a = art("QrowPerps");
  const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args: [FUSD, signer, CHAIN, dep.QrowKeys], nonce: nonce++, account, chain: w.chain });
  const r = await wait(hash, "QrowPerps deploy");
  const perps = r.contractAddress!.toLowerCase() as Address;
  console.log(`QrowPerps v2 (TP/SL): ${perps} (tx ${hash}, gas ${r.gasUsed})`);
  const send = async (address: Address, abi: Abi, fn: string, args: readonly unknown[], what: string) =>
    (await wait(await w.writeContract({ address, abi, functionName: fn, args, nonce: nonce++, account, chain: w.chain }), what)).transactionHash;
  for (const p of PAIRS) await send(perps, a.abi, "setPair", [keccak256(toBytes(p)), true], `setPair ${p}`);
  console.log(`Pairs enabled: ${PAIRS.join(", ")}`);
  const bal = await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const fund = bal < poolWant ? bal : poolWant;
  let poolTx: Hex | undefined;
  if (fund >= 1_000_000n) {
    await send(FUSD, erc20Abi as Abi, "approve", [perps, fund], "approve");
    poolTx = await send(perps, a.abi, "fundPool", [fund], "fund pool");
    console.log(`Pool funded with ${Number(fund) / 1e6} fUSD`);
  } else console.log("Pool not funded: no ERC-20 fUSD (npm run convert first)");

  dep.sprint2.QrowPerpsV1 = { ...dep.sprint2.QrowPerps, note: "Superseded by v2 (take profit / stop loss). Its pool can't be withdrawn by design." };
  dep.sprint2.QrowPerps = { address: perps, tx: hash, block: Number(r.blockNumber), version: 2, features: ["take profit", "stop loss"], poolFunded: Number(fund) / 1e6, poolTx };
  writeFileSync(file, JSON.stringify(dep, null, 2) + "\n");
  console.log(`\nSaved ${file}. In Vercel set:\n  VITE_QROW_PERPS=${perps}\n  QROW_PERPS_ADDRESS=${perps}\nthen Redeploy. Now: npm run window -- close`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
