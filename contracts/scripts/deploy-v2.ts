/**
 * deploy-v2.ts: deploy the app-key version of every Qrow contract to testnet in one go.
 *
 *   forge build
 *   npm run window -- open --txs 6 --blocks 200 --value 12000000     (no --targets: creation)
 *   npm run deploy:v2
 *   npm run window -- close
 *
 * Order (nonces read AFTER the window opened; opening advances the account sequence):
 *   n   QrowKeys            the shared app-key registry
 *   n+1 QrowEscrow          (keys)
 *   n+2 QrowEscrowDemo      (keys) 10-minute refunds, for the video only
 *   n+3 QrowGenesis         (predicted market = n+4, keys)
 *   n+4 QrowMarket          (genesis, keys)
 *   n+5 QrowCoinFactory     (keys)
 * The v1 addresses are kept under "v1" in deployments/testnet.json.
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
  const n = await c.getTransactionCount({ address: me, blockTag: "pending" });
  const predicted = (k: number) => getContractAddress({ from: me, nonce: BigInt(n + k) });
  console.log(`deployer ${me}, nonce ${n}; keys will be ${predicted(0)}, market ${predicted(4)}`);

  const deploy = async (name: string, args: readonly unknown[], k: number) => {
    const a = art(name);
    const hash = await w.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args, nonce: n + k, account, chain: w.chain });
    const r = await c.waitForTransactionReceipt({ hash });
    if (r.status !== "success" || !r.contractAddress) throw new Error(`${name} deploy failed (${hash})`);
    if (r.contractAddress.toLowerCase() !== predicted(k).toLowerCase()) throw new Error(`${name} address mismatch`);
    const code = await c.getCode({ address: r.contractAddress });
    if (!code || code === "0x") throw new Error(`${name} has no code`);
    console.log(`${name}: ${r.contractAddress} (tx ${hash}, block ${r.blockNumber}, gas ${r.gasUsed})`);
    return { address: r.contractAddress.toLowerCase() as Address, tx: hash, block: Number(r.blockNumber), gas: Number(r.gasUsed) };
  };

  const keys = await deploy("QrowKeys", [CHAIN], 0);
  const escrow = await deploy("QrowEscrow", [CHAIN, keys.address], 1);
  const demo = await deploy("QrowEscrowDemo", [CHAIN, keys.address], 2);
  const genesis = await deploy("QrowGenesis", [predicted(4), me, FUSD, PRICE_QOR, PRICE_FUSD, CHAIN, keys.address], 3);
  const market = await deploy("QrowMarket", [genesis.address, FUSD, CHAIN, keys.address], 4);
  const factory = await deploy("QrowCoinFactory", [CHAIN, keys.address], 5);

  // Wiring checks read back from chain.
  const read = (address: Address, name: string, fn: string) => c.readContract({ address, abi: art(name).abi, functionName: fn }) as Promise<string>;
  for (const [addr, name] of [[escrow.address, "QrowEscrow"], [demo.address, "QrowEscrowDemo"], [genesis.address, "QrowGenesis"], [market.address, "QrowMarket"], [factory.address, "QrowCoinFactory"]] as const) {
    const k = (await read(addr, name, "KEYS")).toLowerCase();
    if (k !== keys.address) throw new Error(`${name}.KEYS is ${k}, expected ${keys.address}`);
  }
  if ((await read(genesis.address, "QrowGenesis", "market")).toLowerCase() !== market.address) throw new Error("genesis.market mismatch");
  console.log("wiring: every contract points at QrowKeys; Genesis points at the new Market");

  const file = "deployments/testnet.json";
  const dep = JSON.parse(readFileSync(file, "utf8"));
  const v1 = {
    QrowEscrow: dep.QrowEscrow,
    QrowEscrowDemo: dep.QrowEscrowDemo,
    QrowGenesis: dep.QrowGenesis,
    QrowMarket: dep.QrowMarket,
    QrowCoinFactory: dep.QrowCoinFactory,
    note: "v1 (chain keys only). Superseded by v2 (app key) on " + new Date().toISOString().slice(0, 10),
  };
  writeFileSync(
    file,
    JSON.stringify(
      {
        chain: dep.chain,
        evmChainId: dep.evmChainId,
        version: 2,
        QrowKeys: keys.address,
        QrowEscrow: escrow.address,
        QrowEscrowDemo: demo.address,
        QrowGenesis: genesis.address,
        QrowMarket: market.address,
        QrowCoinFactory: factory.address,
        v2: { deployedAt: new Date().toISOString(), keys, escrow, demo, genesis, market, factory, genesisPrices: { qorWei: PRICE_QOR.toString(), fusdUnits: PRICE_FUSD.toString() }, beneficiary: me },
        v1,
        v1Details: { escrowDeploy: { tx: dep.deployTx, block: dep.block }, sprint: dep.sprint, demo: dep.demo },
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Saved deployments/testnet.json. Now: npm run window -- close");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
