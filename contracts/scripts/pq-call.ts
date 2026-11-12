/**
 * pq-call.ts — call any post-quantum-protected Qrow action from a script account, with the same
 * digest → pqMessage → ML-DSA-87 → simulate → send steps as the web app's PqActionPanel.
 *
 *   npm run pq -- mint --currency qor                         QrowGenesis.mint (1 QOR)
 *   npm run pq -- list --token 1 --price 2 [--currency qor]   QrowMarket.list
 *   npm run pq -- buy --listing 1                             QrowMarket.buy
 *   npm run pq -- unlist --listing 1                          QrowMarket.cancel
 *   npm run pq -- launch --name "Paper Lantern" --symbol LANT --supply 1000000 --creator-bps 500 --description "gm"
 *   npm run pq -- claim-coin --coin 0x…                       QrowCoin.claim
 *   add --drill to act as the Drill account. Needs a live EVM window covering the contract.
 */
import { readFileSync } from "node:fs";
import { pqcSign } from "@qorechain/sdk";
import { encodeAbiParameters, keccak256, parseEther, parseEventLogs, toBytes, toHex, type Abi, type Address, type Hex } from "viem";
import { evmClients, loadAccount } from "./lib.js";

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? undefined : args[i + 1];
};
const ZERO: Address = "0x0000000000000000000000000000000000000000";
const FUSD: Address = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const dep = JSON.parse(readFileSync("deployments/testnet.json", "utf8")) as Record<string, Address>;
const abiOf = (n: string) => (JSON.parse(readFileSync(`out/${n}.sol/${n}.json`, "utf8")) as { abi: Abi }).abi;
const enc = (types: string[], values: unknown[]) => keccak256(encodeAbiParameters(types.map((t) => ({ type: t })), values));

async function main() {
  const acc = await loadAccount(args.includes("--drill") ? "DRILL_" : "");
  const { publicClient: c, walletClient: w, account } = evmClients(acc);
  const me = account.address;

  let contract: Address, abi: Abi, actionName: string, params: Hex, fn: string, build: (v: bigint, s: Hex) => readonly unknown[], value = 0n, event: string;
  const currency = (flag("currency") ?? "qor").toLowerCase() === "fusd" ? FUSD : ZERO;
  switch (cmd) {
    case "mint": {
      contract = dep.QrowGenesis;
      abi = abiOf("QrowGenesis");
      const price = (await c.readContract({ address: contract, abi, functionName: currency === ZERO ? "priceQor" : "priceFusd" })) as bigint;
      [actionName, params, fn, event] = ["ACTION_MINT", enc(["address", "uint256"], [currency, price]), "mint", "Minted"];
      build = (v, s) => [currency, v, s];
      value = currency === ZERO ? price : 0n;
      break;
    }
    case "list": {
      contract = dep.QrowMarket;
      abi = abiOf("QrowMarket");
      const tokenId = BigInt(flag("token")!);
      const price = currency === ZERO ? parseEther(flag("price")!) : BigInt(Math.round(Number(flag("price")) * 1e6));
      [actionName, params, fn, event] = ["ACTION_LIST", enc(["uint256", "address", "uint256"], [tokenId, currency, price]), "list", "Listed"];
      build = (v, s) => [tokenId, currency, price, v, s];
      break;
    }
    case "buy": {
      contract = dep.QrowMarket;
      abi = abiOf("QrowMarket");
      const id = BigInt(flag("listing")!);
      const l = (await c.readContract({ address: contract, abi, functionName: "getListing", args: [id] })) as { tokenId: bigint; currency: Address; price: bigint };
      [actionName, params, fn, event] = ["ACTION_BUY", enc(["uint256", "uint256", "address", "uint256"], [id, l.tokenId, l.currency, l.price]), "buy", "Sold"];
      build = (v, s) => [id, v, s];
      value = l.currency === ZERO ? l.price : 0n;
      break;
    }
    case "unlist": {
      contract = dep.QrowMarket;
      abi = abiOf("QrowMarket");
      const id = BigInt(flag("listing")!);
      [actionName, params, fn, event] = ["ACTION_CANCEL", enc(["uint256"], [id]), "cancel", "Cancelled"];
      build = (v, s) => [id, v, s];
      break;
    }
    case "launch": {
      contract = dep.QrowCoinFactory;
      abi = abiOf("QrowCoinFactory");
      const [name, symbol, desc] = [flag("name")!, flag("symbol")!, flag("description") ?? ""];
      const supply = BigInt(flag("supply")!);
      const bps = Number(flag("creator-bps") ?? "0");
      const h = (x: string) => keccak256(new TextEncoder().encode(x));
      [actionName, params, fn, event] = ["ACTION_LAUNCH", enc(["bytes32", "bytes32", "uint256", "uint16", "bytes32"], [h(name), h(symbol), supply, bps, h(desc)]), "launch", "CoinLaunched"];
      build = (v, s) => [name, symbol, supply, bps, desc, v, s];
      break;
    }
    case "claim-coin": {
      contract = flag("coin") as Address;
      abi = abiOf("QrowCoin");
      [actionName, params, fn, event] = ["ACTION_CLAIM", enc(["address"], [contract]), "claim", "Claimed"];
      build = (v, s) => [v, s];
      break;
    }
    default:
      throw new Error("Use: mint | list | buy | unlist | launch | claim-coin (see the header)");
  }

  const read = <T>(f: string, a: readonly unknown[] = []) => c.readContract({ address: contract, abi, functionName: f, args: a }) as Promise<T>;
  const [action, nonce, block] = await Promise.all([read<Hex>(actionName), read<bigint>("pqNonce", [me]), c.getBlock()]);
  const validUntil = block.timestamp + 30n * 60n;
  const digest = await read<Hex>("actionDigest", [action, me, nonce, validUntil, params]);
  const message = await read<Hex>("pqMessage", [digest]);
  const signature = toHex(pqcSign(acc.pqc.secretKey, toBytes(message)));
  console.log(`${cmd} on ${contract} as ${me}: ML-DSA-87 signature ${(signature.length - 2) / 2} bytes (nonce ${nonce})`);
  const callArgs = build(validUntil, signature);
  const sim = await c.simulateContract({ account, address: contract, abi, functionName: fn, args: callArgs, value });
  console.log(`simulation: OK${sim.result !== undefined ? ` (returns ${String(sim.result)})` : ""}`);
  const hash = await w.writeContract({ address: contract, abi, functionName: fn, args: callArgs, value, chain: w.chain, account });
  const r = await c.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted: ${hash}`);
  const evs = parseEventLogs({ abi, logs: r.logs, eventName: event as never }) as unknown as { args: Record<string, unknown> }[];
  console.log(`tx ${hash} (block ${r.blockNumber}, gas ${r.gasUsed})`);
  for (const e of evs) console.log(`${event}: ${JSON.stringify(e.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
