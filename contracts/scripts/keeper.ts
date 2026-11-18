/**
 * keeper.ts: runs take profits, stop losses and liquidations on QrowPerps while traders are offline.
 * Anyone may call executeTpSl / liquidate; this is Qrow's own keeper, from the deployer account. It earns the
 * liquidation reward only; take profits and stop losses pay it nothing. Testnet only.
 *
 *   npm run keeper            check every 20 s until stopped (Ctrl+C)
 *   npm run keeper -- --once  one pass
 *
 * Prices: signed locally with PRICE_SIGNER_KEY from the same public sources as /api/price (Binance + the testnet
 * QOR/fUSD pool). Sending needs the deployer's EVM window: the keeper opens one itself (QoreX's maximum length,
 * only the perps contract as target) whenever none covers it.
 */
import { closeEvmWindowMsg, openEvmWindowMsg } from "@qorechain/sdk";
import { readFileSync } from "node:fs";
import { encodeAbiParameters, keccak256, toBytes, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { broadcastNative, evmClients, loadAccount, network, requireEnv } from "./lib.js";

const PAIRS = ["QOR/USDT", "QOR/ETH", "QOR/SOL", "ETH/USDT", "SOL/USDT", "BNB/USDT"] as const;
type Pair = (typeof PAIRS)[number];
const once = process.argv.includes("--once");
const abi = JSON.parse(readFileSync("out/QrowPerps.sol/QrowPerps.json", "utf8")).abi as Abi;
const perps = JSON.parse(readFileSync("deployments/testnet.json", "utf8")).sprint2.QrowPerps.address as Address;
const signer = privateKeyToAccount(requireEnv("PRICE_SIGNER_KEY") as Hex);
const REST = network().rest;

const toE8 = (s: string) => {
  const [a, b = ""] = s.split(".");
  return BigInt(a) * 10n ** 8n + BigInt((b + "00000000").slice(0, 8));
};

async function prices(): Promise<Record<Pair, bigint>> {
  const bin = (await (await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbols=${encodeURIComponent('["ETHUSDT","SOLUSDT","BNBUSDT"]')}`)).json()) as { symbol: string; price: string }[];
  const by = (s: string) => toE8(bin.find((x) => x.symbol === s)!.price);
  const pools = ((await (await fetch(`${REST}/qorechain/amm/v1/pools`)).json()) as { pools: { token_a: string; token_b: string; reserve_a: string; reserve_b: string; status: string }[] }).pools;
  const p = pools.find((x) => x.status === "active" && [x.token_a, x.token_b].includes("uqor") && [x.token_a, x.token_b].some((t) => t.toLowerCase() === "erc20:0x97143b771d34ddb9130b807b135ae675a5a963ca"))!;
  const [f, q] = p.token_a === "uqor" ? [BigInt(p.reserve_b), BigInt(p.reserve_a)] : [BigInt(p.reserve_a), BigInt(p.reserve_b)];
  const qor = (f * 10n ** 8n) / q;
  const eth = by("ETHUSDT");
  const sol = by("SOLUSDT");
  return { "QOR/USDT": qor, "QOR/ETH": (qor * 10n ** 8n) / eth, "QOR/SOL": (qor * 10n ** 8n) / sol, "ETH/USDT": eth, "SOL/USDT": sol, "BNB/USDT": by("BNBUSDT") };
}

async function report(pair: Pair, price: bigint) {
  const id = keccak256(toBytes(pair));
  const ts = BigInt(Math.floor(Date.now() / 1000));
  const h = keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
      [keccak256(toBytes("QROW_PRICE_V1")), 9800n, perps, id, price, ts],
    ),
  );
  return { pair: id, price, timestamp: ts, signature: await signer.signMessage({ message: { raw: h } }) };
}

async function main() {
  const acc = await loadAccount();
  const { publicClient: c, walletClient: w, account } = evmClients(acc);
  const pairOf = new Map(PAIRS.map((p) => [keccak256(toBytes(p)).toLowerCase(), p]));
  const ensureWindow = async () => {
    const st = (await (await fetch(`${REST}/qorechain/pqc/v1/evm_window/${acc.cosmos}`)).json()) as { live: boolean; remaining_txs: string; remaining_blocks: string };
    if (st.live && Number(st.remaining_txs) > 0 && Number(st.remaining_blocks) > 30) return;
    console.log("opening the keeper's EVM window (perps only)");
    await broadcastNative(acc, "hybrid", [openEvmWindowMsg({ sender: acc.cosmos, blocks: 17_280n, maxTxs: 200n, maxValue: 20_000_000n, allowedTargets: [perps] })]);
    await new Promise((r) => setTimeout(r, 8000));
  };
  let stop = false;
  process.on("SIGINT", () => (stop = true));
  const ts = () => new Date().toLocaleTimeString();
  console.log(`${ts()} keeper started: checking QrowPerps ${perps} every 20 s (Ctrl+C to stop)`);
  let lastStatus = "";
  let lastPrint = 0;
  do {
    try {
      const count = (await c.readContract({ address: perps, abi, functionName: "positionCount" })) as bigint;
      const px = await prices();
      let open = 0;
      let withTpSl = 0;
      for (let id = 1n; id <= count; id++) {
        const p = (await c.readContract({ address: perps, abi, functionName: "getPosition", args: [id] })) as { open: boolean; pair: Hex };
        if (!p.open) continue;
        const pair = pairOf.get(p.pair.toLowerCase());
        if (!pair) continue;
        open++;
        const t = (await c.readContract({ address: perps, abi, functionName: "getTpSl", args: [id] })) as { takeProfit: bigint; stopLoss: bigint };
        if (t.takeProfit || t.stopLoss) withTpSl++;
        const reason = (await c.readContract({ address: perps, abi, functionName: "tpSlTriggered", args: [id, px[pair]] })) as number;
        const r = await report(pair, px[pair]);
        let fn: "executeTpSl" | "liquidate" | undefined = reason ? "executeTpSl" : undefined;
        if (!fn) {
          try {
            await c.simulateContract({ address: perps, abi, functionName: "liquidate", args: [id, r], account });
            fn = "liquidate";
          } catch {
            /* not liquidatable */
          }
        }
        if (!fn) continue;
        await ensureWindow();
        const nonce = await c.getTransactionCount({ address: account.address, blockTag: "pending" });
        const hash = await w.writeContract({ address: perps, abi, functionName: fn, args: [id, r], nonce, account, chain: w.chain });
        const rc = await c.waitForTransactionReceipt({ hash });
        console.log(`${new Date().toISOString()} #${id} ${pair} ${fn === "liquidate" ? "liquidated" : reason === 3 ? "take profit" : "stop loss"} at ${Number(px[pair]) / 1e8}: ${rc.status} (tx ${hash})`);
      }
      // Status line: when the open positions change, and at least every 5 minutes so you can see it's alive.
      const status = `${open} open position${open === 1 ? "" : "s"} (${withTpSl} with TP/SL), nothing to trigger`;
      if (status !== lastStatus || Date.now() - lastPrint > 300_000) {
        const fmt = (n: number) => (n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toPrecision(3));
        const prices = PAIRS.map((p) => `${p} ${fmt(Number(px[p]) / 1e8)}`).join(", ");
        console.log(`${ts()} checked: ${status}. Prices: ${prices}`);
        lastStatus = status;
        lastPrint = Date.now();
      }
    } catch (e) {
      console.error(`${new Date().toISOString()} keeper pass failed: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    }
    if (!once && !stop) await new Promise((r) => setTimeout(r, 20_000));
  } while (!once && !stop);
  if (!once) {
    await broadcastNative(acc, "hybrid", [closeEvmWindowMsg(acc.cosmos)]).catch(() => undefined);
    console.log("keeper stopped; window closed");
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
