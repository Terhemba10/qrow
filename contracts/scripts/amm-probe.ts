/**
 * amm-probe.ts (research, 13 Nov), deployer, hybrid-signed native transactions (what QoreX sends):
 *   1. swap 0.1 QOR -> fUSD on the native AMM (pool 2), min-out from the constant-product quote - 3%
 *   2. convert the received fUSD bank coin to its ERC-20 form with a hand-encoded MsgConvertCoin
 *   3. send 1 uqor by bank transfer to the escrow's address: can a contract receive QOR this way?
 *   npm run amm-probe
 */
import { readFileSync } from "node:fs";
import { BinaryWriter, BinaryReader } from "@bufbuild/protobuf/wire";
import { evmToQor, msg, qorechainRegistry } from "@qorechain/sdk";
import { erc20Abi, type Address } from "viem";
import { broadcastNative, evmClients, loadAccount, network } from "./lib.js";

const REST = network().rest;
const FUSD: Address = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const FUSD_DENOM = `erc20:${FUSD}`;
const CONVERT = "/cosmos.evm.erc20.v1.MsgConvertCoin";

interface ConvertCoin { coin: { denom: string; amount: string }; receiver: string; sender: string }
const MsgConvertCoin = {
  encode(m: ConvertCoin, w: BinaryWriter = new BinaryWriter()) {
    const c = w.uint32(10).fork();
    c.uint32(10).string(m.coin.denom).uint32(18).string(m.coin.amount);
    c.join();
    w.uint32(18).string(m.receiver).uint32(26).string(m.sender);
    return w;
  },
  decode(_b: Uint8Array | BinaryReader): ConvertCoin {
    throw new Error("not needed");
  },
  fromPartial: (m: ConvertCoin) => m,
};

const bank = async (addr: string) =>
  ((await fetch(`${REST}/cosmos/bank/v1beta1/balances/${addr}`).then((r) => r.json())) as { balances: { denom: string; amount: string }[] }).balances;
const txResult = async (hash: string) => {
  const t = (await fetch(`${REST}/cosmos/tx/v1beta1/txs/${hash}`).then((r) => r.json())) as { tx_response?: { code: number; gas_used: string; raw_log: string } };
  return t.tx_response;
};

async function main() {
  const acc = await loadAccount();
  const { publicClient: c, account } = evmClients(acc);
  const me = account.address;

  if (process.env.ONLY_BACK) {
    const registry = qorechainRegistry();
    registry.register("/cosmos.evm.erc20.v1.MsgConvertERC20", {
      encode(m: { contract: string; amount: string; receiver: string; sender: string }, w: BinaryWriter = new BinaryWriter()) {
        return w.uint32(10).string(m.contract).uint32(18).string(m.amount).uint32(26).string(m.receiver).uint32(34).string(m.sender);
      },
      decode() { throw new Error("not needed"); },
      fromPartial: (m: unknown) => m,
    } as never);
    const amount = 1_006n;
    const b0 = (await bank(acc.cosmos)).find((b) => b.denom === FUSD_DENOM)?.amount ?? "0";
    const tx = await broadcastNative(acc, "hybrid", [{ typeUrl: "/cosmos.evm.erc20.v1.MsgConvertERC20", value: { contract: FUSD, amount: amount.toString(), receiver: acc.cosmos, sender: acc.cosmos } }], undefined, 1_500_000, registry as never);
    await new Promise((r) => setTimeout(r, 6000));
    const t = await txResult(tx);
    console.log(`convert back ${amount} ERC-20 fUSD: tx ${tx} code ${t?.code} gas ${t?.gas_used}; bank fUSD ${b0} -> ${(await bank(acc.cosmos)).find((b) => b.denom === FUSD_DENOM)?.amount ?? "0"}; ERC-20 now ${await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [me] })}`);
    return;
  }
  if (process.env.ONLY_CONVERT) {
    const have = BigInt((await bank(acc.cosmos)).find((b) => b.denom === FUSD_DENOM)?.amount ?? "0");
    const registry = qorechainRegistry();
    registry.register(CONVERT, MsgConvertCoin as never);
    const e0 = await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [me] });
    const tx = await broadcastNative(acc, "hybrid", [{ typeUrl: CONVERT, value: { coin: { denom: FUSD_DENOM, amount: have.toString() }, receiver: me, sender: acc.cosmos } }], undefined, 1_500_000, registry as never);
    await new Promise((r) => setTimeout(r, 6000));
    const e1 = await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [me] });
    const t = await txResult(tx);
    console.log(`convert ${have} bank fUSD: tx ${tx} code ${t?.code} gas ${t?.gas_used}; ERC-20 fUSD ${e0} -> ${e1}; bank fUSD now ${(await bank(acc.cosmos)).find((b) => b.denom === FUSD_DENOM)?.amount ?? "0"}`);
    return;
  }
  // 1. Swap 0.1 QOR -> fUSD, pool 2.
  const pool = ((await fetch(`${REST}/qorechain/amm/v1/pools/2`).then((r) => r.json())) as { pool: { token_a: string; reserve_a: string; reserve_b: string } }).pool;
  const inAmt = 100_000n; // 0.1 QOR in uqor
  const [rIn, rOut] = pool.token_a === FUSD_DENOM ? [BigInt(pool.reserve_b), BigInt(pool.reserve_a)] : [BigInt(pool.reserve_a), BigInt(pool.reserve_b)];
  const inAfterFee = (inAmt * 9_970n) / 10_000n;
  const quote = (rOut * inAfterFee) / (rIn + inAfterFee);
  const minOut = (quote * 97n) / 100n;
  console.log(`quote: 0.1 QOR -> ${quote} fUSD units (min ${minOut})`);
  const before = BigInt((await bank(acc.cosmos)).find((b) => b.denom === FUSD_DENOM)?.amount ?? "0");
  const swapTx = await broadcastNative(acc, "hybrid", [msg.amm.swapExactIn({ sender: acc.cosmos, poolId: "2", tokenIn: { denom: "uqor", amount: inAmt.toString() }, denomOut: FUSD_DENOM, minOut: minOut.toString() })], undefined, 400_000);
  await new Promise((r) => setTimeout(r, 6000));
  const after = BigInt((await bank(acc.cosmos)).find((b) => b.denom === FUSD_DENOM)?.amount ?? "0");
  console.log(`1. swap tx ${swapTx}: ${JSON.stringify(await txResult(swapTx))?.slice(0, 120)}; bank fUSD ${before} -> ${after}`);

  // 2. Convert the received fUSD to ERC-20.
  const got = after - before;
  if (got > 0n) {
    const registry = qorechainRegistry();
    registry.register(CONVERT, MsgConvertCoin as never);
    const erc20Before = await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [me] });
    try {
      const convTx = await broadcastNative(acc, "hybrid", [{ typeUrl: CONVERT, value: { coin: { denom: FUSD_DENOM, amount: got.toString() }, receiver: me, sender: acc.cosmos } }], undefined, 400_000, registry as never);
      await new Promise((r) => setTimeout(r, 6000));
      const erc20After = await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [me] });
      console.log(`2. convert tx ${convTx}: ${JSON.stringify(await txResult(convTx))?.slice(0, 160)}; ERC-20 fUSD ${erc20Before} -> ${erc20After}`);
    } catch (e) {
      console.log(`2. convert refused: ${(e as Error).message.slice(0, 300)}`);
    }
  }

  // 3. Bank-send 1 uqor to the escrow's address.
  const escrow = (JSON.parse(readFileSync("deployments/testnet.json", "utf8")) as { QrowEscrow: Address }).QrowEscrow;
  const wei0 = await c.getBalance({ address: escrow });
  try {
    const sendTx = await broadcastNative(acc, "hybrid", [msg.bank.send({ fromAddress: acc.cosmos, toAddress: evmToQor(escrow), amount: [{ denom: "uqor", amount: "1" }] })]);
    await new Promise((r) => setTimeout(r, 6000));
    console.log(`3. bank send to escrow tx ${sendTx}: ${JSON.stringify(await txResult(sendTx))?.slice(0, 120)}; escrow EVM balance ${wei0} -> ${await c.getBalance({ address: escrow })} wei`);
  } catch (e) {
    console.log(`3. bank send to escrow refused: ${(e as Error).message.slice(0, 300)}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
