/**
 * seed-sprint2.ts: the seeding half of deploy-sprint2, against the contracts ALREADY deployed
 * (deployments/testnet.json → sprint2). Never deploys anything. Testnet only.
 *
 *   npm run window -- open --txs 10 --blocks 400 --value 10000000   (targets: any; or fUSD + predict + perps)
 *   npm run seed:sprint2 -- [--seed-fusd 60] [--pool-fusd 100]
 *   npm run window -- close
 *
 * Skips the markets if QrowPredict already has some, so running it twice doesn't duplicate them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { erc20Abi, type Abi, type Address, type Hex } from "viem";
import { evmClients, loadAccount } from "./lib.js";

const FUSD: Address = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const arg = (n: string, d: number) => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? d : Number(process.argv[i + 1]);
};
const art = (name: string) => JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8")) as { abi: Abi };

function seedMarkets(): { question: string; category: string; days: number }[] {
  const src = readFileSync("../web/src/lib/predict.ts", "utf8");
  const block = src.slice(src.indexOf("SEED_MARKETS"), src.indexOf("];", src.indexOf("SEED_MARKETS")));
  return [...block.matchAll(/question: "([^"]+)", category: "([^"]+)", days: (\d+)/g)].map((m) => ({ question: m[1], category: m[2], days: Number(m[3]) }));
}

async function main() {
  const file = "deployments/testnet.json";
  const dep = JSON.parse(readFileSync(file, "utf8"));
  const predict = dep.sprint2?.QrowPredict?.address as Address | undefined;
  const perps = dep.sprint2?.QrowPerps?.address as Address | undefined;
  if (!predict || !perps) throw new Error("No sprint2 deployment in deployments/testnet.json");
  const acc = await loadAccount();
  const { publicClient: c, walletClient: w, account } = evmClients(acc);
  const me = account.address;
  for (const a of [predict, perps]) if (((await c.getCode({ address: a })) ?? "0x") === "0x") throw new Error(`No code at ${a}`);

  let nonce = await c.getTransactionCount({ address: me, blockTag: "pending" });
  const send = async (address: Address, abi: Abi, functionName: string, args: readonly unknown[], what: string) => {
    const hash: Hex = await w.writeContract({ address, abi, functionName, args, nonce: nonce++, account, chain: w.chain });
    const r = await c.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${what} failed (${hash})`);
    return hash;
  };
  const bal = () => c.readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [me] });
  const markets = seedMarkets();
  const seedEach = BigInt(Math.round(arg("seed-fusd", 60) * 1e6)) / BigInt(markets.length);
  const pool = BigInt(Math.round(arg("pool-fusd", 100) * 1e6));
  const out: Record<string, unknown> = { seededAt: new Date().toISOString(), markets: [] as unknown[] };

  const existing = (await c.readContract({ address: predict, abi: art("QrowPredict").abi, functionName: "marketCount" })) as bigint;
  if (existing > 0n) console.log(`QrowPredict already has ${existing} markets: not seeding again.`);
  else {
    if ((await bal()) < seedEach * BigInt(markets.length)) throw new Error("Not enough ERC-20 fUSD to seed: run npm run convert first");
    await send(FUSD, erc20Abi as Abi, "approve", [predict, seedEach * BigInt(markets.length)], "approve predict");
    const now = Math.floor(Date.now() / 1000);
    for (const m of markets) {
      const end = BigInt(now + m.days * 86_400);
      const tx = await send(predict, art("QrowPredict").abi, "createMarket", [m.question, m.category, end, seedEach], `market ${m.question.slice(0, 30)}`);
      (out.markets as unknown[]).push({ question: m.question, endTime: Number(end), tx });
      console.log(`market: ${m.question}`);
    }
    console.log(`Seeded ${markets.length} markets with ${Number(seedEach) / 1e6} fUSD each`);
  }

  const left = await bal();
  const fund = left < pool ? left : pool;
  if (fund < 1_000_000n) throw new Error("No ERC-20 fUSD left for the perps pool");
  await send(FUSD, erc20Abi as Abi, "approve", [perps, fund], "approve perps");
  out.poolTx = await send(perps, art("QrowPerps").abi, "fundPool", [fund], "fund pool");
  out.poolFunded = Number(fund) / 1e6;
  console.log(`Perps pool funded with ${Number(fund) / 1e6} fUSD (pool now ${Number(await c.readContract({ address: perps, abi: art("QrowPerps").abi, functionName: "poolBalance" })) / 1e6} fUSD)`);

  dep.sprint2.seeding = out;
  writeFileSync(file, JSON.stringify(dep, null, 2) + "\n");
  console.log(`Saved ${file}. Now: npm run window -- close`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
