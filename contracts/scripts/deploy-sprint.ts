/**
 * deploy-sprint.ts — deploy QrowGenesis, QrowMarket and QrowCoinFactory to testnet in one go.
 *
 *   forge build
 *   npm run window -- open --txs 3 --blocks 200 --value 6000000     (no --targets: creation)
 *   npm run deploy:sprint
 *   npm run window -- close
 *
 * Genesis names its only market at construction, so the market address is predicted from the
 * deployer's EVM nonce (read AFTER the window opened: opening it advances the account sequence).
 * Order: Genesis (nonce n), Market (n+1), Factory (n+2).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { getContractAddress, type Abi, type Address, type Hex } from "viem";
import { evmClients, loadAccount } from "./lib.js";

const FUSD: Address = "0x97143B771D34ddb9130b807b135Ae675A5a963CA"; // 6 decimals (checked on chain)
const PRICE_QOR = 10n ** 18n; // 1 QOR
const PRICE_FUSD = 1_000_000n; // 1 fUSD
const CHAIN = "qorechain-diana";

const art = (name: string) =>
  JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8")) as { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };

async function main() {
  const acc = await loadAccount();
  const { publicClient: c, walletClient: w, account } = evmClients(acc);
  const me = account.address;
  const nonce = await c.getTransactionCount({ address: me, blockTag: "pending" });
  const predicted = getContractAddress({ from: me, nonce: BigInt(nonce + 1) });
  console.log(`deployer ${me}, nonce ${nonce}; market will be ${predicted}`);

  const deploy = async (name: string, args: readonly unknown[], expectNonce: number) => {
    const a = art(name);
    const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, nonce: expectNonce, account, chain: w.chain });
    const r = await c.waitForTransactionReceipt({ hash });
    if (r.status !== "success" || !r.contractAddress) throw new Error(`${name} deploy failed (${hash})`);
    const code = await c.getCode({ address: r.contractAddress });
    const matches = code?.toLowerCase() === a.deployedBytecode.object.toLowerCase();
    console.log(`${name}: ${r.contractAddress} (tx ${hash}, block ${r.blockNumber}, gas ${r.gasUsed}, bytecode ${matches ? "matches build" : "has immutables"})`);
    return { address: r.contractAddress, tx: hash, block: Number(r.blockNumber), gas: Number(r.gasUsed) };
  };

  const genesis = await deploy("QrowGenesis", [predicted, me, FUSD, PRICE_QOR, PRICE_FUSD, CHAIN], nonce);
  const market = await deploy("QrowMarket", [genesis.address, FUSD, CHAIN], nonce + 1);
  if (market.address.toLowerCase() !== predicted.toLowerCase()) throw new Error("market address mismatch");
  const factory = await deploy("QrowCoinFactory", [CHAIN], nonce + 2);

  const file = "deployments/testnet.json";
  const dep = JSON.parse(readFileSync(file, "utf8"));
  Object.assign(dep, {
    QrowGenesis: genesis.address,
    QrowMarket: market.address,
    QrowCoinFactory: factory.address,
    sprint: {
      deployedAt: new Date().toISOString(),
      genesis,
      market,
      factory,
      genesisPrices: { qorWei: PRICE_QOR.toString(), fusdUnits: PRICE_FUSD.toString() },
      beneficiary: me,
    },
  });
  writeFileSync(file, JSON.stringify(dep, null, 2) + "\n");
  console.log("Saved deployments/testnet.json. Now: npm run window -- close");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
