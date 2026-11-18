/**
 * deploy-sprint2.ts: the fest-sprint contracts (PLAN.md): QrowPredict, QrowEditions, QrowPerps. Testnet only.
 *
 *   forge build
 *   npm run window -- open --txs 20 --blocks 400 --value 20000000     (no --targets: creation + setup)
 *   npm run deploy:sprint2 -- [--seed-fusd 60] [--pool-fusd 100]
 *   npm run window -- close
 *
 * It also:
 *   - creates PRICE_SIGNER_KEY (a key that only signs prices) in contracts/.env if missing, and prints its address;
 *   - enables the six Trade pairs on QrowPerps;
 *   - seeds the six demo markets from web/src/lib/predict.ts SEED_MARKETS (10 fUSD liquidity each by default)
 *     and funds the perps pool, as far as the deployer's ERC-20 fUSD allows;
 *   - saves the addresses under "sprint2" in deployments/testnet.json and prints the Vercel env vars.
 * The existing v3 contracts are not touched.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { erc20Abi, keccak256, toBytes, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { evmClients, loadAccount } from "./lib.js";

const FUSD: Address = "0x97143B771D34ddb9130b807b135Ae675A5a963CA"; // 6 decimals
const CHAIN = "qorechain-diana";
const PAIRS = ["QOR/USDT", "QOR/ETH", "QOR/SOL", "ETH/USDT", "SOL/USDT", "BNB/USDT"];
const arg = (n: string, d: number) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : Number(process.argv[i + 1]);
};

const art = (name: string) => JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8")) as { abi: Abi; bytecode: { object: Hex } };

/** SEED_MARKETS from the web app, so the page and the chain list the same questions. */
function seedMarkets(): { question: string; category: string; days: number }[] {
  const src = readFileSync("../web/src/lib/predict.ts", "utf8");
  const block = src.slice(src.indexOf("SEED_MARKETS"), src.indexOf("];", src.indexOf("SEED_MARKETS")));
  return [...block.matchAll(/question: "([^"]+)", category: "([^"]+)", days: (\d+)/g)].map((m) => ({ question: m[1], category: m[2], days: Number(m[3]) }));
}

async function main() {
  const keysAddr = (JSON.parse(readFileSync("deployments/testnet.json", "utf8")) as { QrowKeys: Address }).QrowKeys;
  const acc = await loadAccount();
  const { publicClient: c, walletClient: w, account } = evmClients(acc);
  const me = account.address;

  let signerKey = process.env.PRICE_SIGNER_KEY?.trim() as Hex | undefined;
  if (!signerKey) {
    signerKey = generatePrivateKey();
    appendFileSync(".env", `\n# Price signer for QrowPerps (signs prices only; holds nothing). Secret: copy to Vercel as PRICE_SIGNER_KEY.\nPRICE_SIGNER_KEY=${signerKey}\n`);
    console.log("Created PRICE_SIGNER_KEY in contracts/.env");
  }
  const signer = privateKeyToAccount(signerKey).address;

  let nonce = await c.getTransactionCount({ address: me, blockTag: "pending" });
  const wait = async (hash: Hex, what: string) => {
    const r = await c.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${what} failed (${hash})`);
    return r;
  };
  const deploy = async (name: string, args: readonly unknown[]) => {
    const a = art(name);
    const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, nonce: nonce++, account, chain: w.chain });
    const r = await wait(hash, `${name} deploy`);
    console.log(`${name}: ${r.contractAddress} (tx ${hash}, gas ${r.gasUsed})`);
    return { address: r.contractAddress!.toLowerCase() as Address, tx: hash, block: Number(r.blockNumber) };
  };
  const send = async (address: Address, abi: Abi, functionName: string, args: readonly unknown[], what: string) =>
    wait(await w.writeContract({ address, abi, functionName, args, nonce: nonce++, account, chain: w.chain }), what);

  const predict = await deploy("QrowPredict", [FUSD, CHAIN, keysAddr]);
  const editions = await deploy("QrowEditions", [FUSD, CHAIN, keysAddr]);
  const perps = await deploy("QrowPerps", [FUSD, signer, CHAIN, keysAddr]);

  for (const p of PAIRS) await send(perps.address, art("QrowPerps").abi, "setPair", [keccak256(toBytes(p)), true], `setPair ${p}`);
  console.log(`Perps pairs enabled: ${PAIRS.join(", ")}`);

  const bal = await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [me] });
  const seedEach = BigInt(Math.round(arg("seed-fusd", 60) * 1e6)) / 6n;
  const pool = BigInt(Math.round(arg("pool-fusd", 100) * 1e6));
  const markets = seedMarkets();
  if (bal >= seedEach * BigInt(markets.length) && seedEach >= 1_000_000n) {
    await send(FUSD, erc20Abi as Abi, "approve", [predict.address, seedEach * BigInt(markets.length)], "approve predict");
    const now = Math.floor(Date.now() / 1000);
    for (const m of markets) await send(predict.address, art("QrowPredict").abi, "createMarket", [m.question, m.category, BigInt(now + m.days * 86_400), seedEach], `market ${m.question.slice(0, 30)}`);
    console.log(`Seeded ${markets.length} markets with ${Number(seedEach) / 1e6} fUSD each`);
  } else console.log(`Skipped seeding: deployer has ${Number(bal) / 1e6} ERC-20 fUSD (needs ${Number(seedEach * 6n) / 1e6}). Create them later from the Admin tab.`);
  const left = await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [me] });
  const fund = left < pool ? left : pool;
  if (fund >= 1_000_000n) {
    await send(FUSD, erc20Abi as Abi, "approve", [perps.address, fund], "approve perps");
    await send(perps.address, art("QrowPerps").abi, "fundPool", [fund], "fund pool");
    console.log(`Perps pool funded with ${Number(fund) / 1e6} fUSD`);
  } else console.log("Skipped the perps pool: no fUSD left. Anyone can fund it later (fundPool).");

  const file = "deployments/testnet.json";
  const dep = JSON.parse(readFileSync(file, "utf8"));
  dep.sprint2 = { deployedAt: new Date().toISOString(), QrowPredict: predict, QrowEditions: editions, QrowPerps: perps, priceSigner: signer, pairs: PAIRS };
  writeFileSync(file, JSON.stringify(dep, null, 2) + "\n");
  console.log(`\nSaved ${file}. Vercel env vars:\n  VITE_QROW_PREDICT=${predict.address}\n  VITE_QROW_EDITIONS=${editions.address}\n  VITE_QROW_PERPS=${perps.address}\n  QROW_PERPS_ADDRESS=${perps.address}\n  PRICE_SIGNER_KEY=(from contracts/.env)\nNow: npm run window -- close`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
