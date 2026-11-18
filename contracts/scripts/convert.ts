/**
 * convert.ts: move the deployer's fUSD from its native bank form (what the faucet pays) to the ERC-20 form
 * Qrow's contracts use: one hybrid-signed MsgConvertCoin. No EVM window needed. Testnet only.
 *
 *   npm run convert -- --fusd 200
 */
import { BinaryWriter } from "@bufbuild/protobuf/wire";
import { qorechainRegistry } from "@qorechain/sdk";
import { erc20Abi, type Address } from "viem";
import { broadcastNative, evmClients, loadAccount, network } from "./lib.js";

const FUSD: Address = "0x97143B771D34ddb9130b807b135Ae675A5a963CA"; // 6 decimals
const CONVERT = "/cosmos.evm.erc20.v1.MsgConvertCoin";
const REST = network().rest;

const registry = qorechainRegistry();
registry.register(CONVERT, {
  encode(m: { coin: { denom: string; amount: string }; receiver: string; sender: string }, w: BinaryWriter = new BinaryWriter()) {
    const c = w.uint32(10).fork();
    c.uint32(10).string(m.coin.denom).uint32(18).string(m.coin.amount);
    c.join();
    return w.uint32(18).string(m.receiver).uint32(26).string(m.sender);
  },
  decode() {
    throw new Error("n/a");
  },
  fromPartial: (m: unknown) => m,
} as never);

const i = process.argv.indexOf("--fusd");
const want = BigInt(Math.round(Number(i === -1 ? "200" : process.argv[i + 1]) * 1e6));

async function main() {
  const acc = await loadAccount();
  const { publicClient: c, account } = evmClients(acc);
  const bankOf = async () => {
    const r = (await fetch(`${REST}/cosmos/bank/v1beta1/balances/${acc.cosmos}/by_denom?denom=${encodeURIComponent(`erc20:${FUSD}`)}`).then((x) => x.json())) as { balance?: { amount?: string } };
    return BigInt(r.balance?.amount ?? "0");
  };
  const ercOf = () => c.readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const [bank0, erc0] = await Promise.all([bankOf(), ercOf()]);
  if (bank0 < want) throw new Error(`Only ${Number(bank0) / 1e6} native fUSD available, asked for ${Number(want) / 1e6}`);
  const m = { typeUrl: CONVERT, value: { coin: { denom: `erc20:${FUSD}`, amount: want.toString() }, receiver: account.address, sender: acc.cosmos } };
  const hash = await broadcastNative(acc, "hybrid", [m as never], "Qrow: convert fUSD for sprint2 seeding", 600_000, registry as never);
  for (let k = 0; k < 30; k++) {
    await new Promise((r) => setTimeout(r, 3000));
    const t = (await fetch(`${REST}/cosmos/tx/v1beta1/txs/${hash}`).then((r) => r.json())) as { tx_response?: { code: number; raw_log: string } };
    if (!t.tx_response) continue;
    if (t.tx_response.code !== 0) throw new Error(`convert failed: ${t.tx_response.raw_log.slice(0, 200)}`);
    const [bank1, erc1] = await Promise.all([bankOf(), ercOf()]);
    console.log(`converted ${Number(want) / 1e6} fUSD: tx ${hash}`);
    console.log(`native fUSD ${Number(bank0) / 1e6} → ${Number(bank1) / 1e6}; ERC-20 fUSD ${Number(erc0) / 1e6} → ${Number(erc1) / 1e6}`);
    return;
  }
  throw new Error(`sent (tx ${hash}) but not confirmed yet`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
