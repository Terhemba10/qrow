/**
 * smoke-v3.ts: the QoreX-only flow end to end on testnet, with NO EVM window. Every step is a
 * hybrid-signed native MsgCrossVMCall (what QoreX's signAndBroadcast sends), gas sized from
 * eth_estimateGas plus the measured cross-VM overhead:
 *   1. deployer registers a Qrow device key (QrowKeys.addFirstDevice)        [seed in .env, never printed]
 *   2. deployer launches a test coin and claims its share (device-key signatures)
 *   3. deployer approves the coin for the escrow and pays the Drill account (device-key signature)
 *   4. the Drill account claims the payment with its chain-registered key (bare signature)
 *   npm run smoke:v3
 */
import { appendFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { generatePqcKeypair, msg, pqcSign, type UnifiedAccount } from "@qorechain/sdk";
import { concat, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, parseEventLogs, toBytes, toHex, type Abi, type Address, type Hex } from "viem";
import { broadcastNative, evmClients, loadAccount } from "./lib.js";

const dep = JSON.parse(readFileSync("deployments/testnet.json", "utf8")) as { QrowKeys: Address; QrowEscrow: Address; QrowCoinFactory: Address };
const abiOf = (n: string) => (JSON.parse(readFileSync(`out/${n}.sol/${n}.json`, "utf8")) as { abi: Abi }).abi;
const keysAbi = abiOf("QrowKeys");
const escrowAbi = abiOf("QrowEscrow");
const factoryAbi = abiOf("QrowCoinFactory");
const coinAbi = abiOf("QrowCoin");

/** Cross-VM gas: EVM estimate + measured overhead (signature check, payload bytes) + 10%. */
export const crossVmGas = (evmGas: bigint, payloadBytes: number) => Math.ceil((Number(evmGas) + 250_000 + 90 * payloadBytes) * 1.1);

async function main() {
  const owner = await loadAccount();
  const drill = await loadAccount("DRILL_");
  const { publicClient: c, account } = evmClients(owner);
  const me = account.address;
  const drillAddr = evmClients(drill).account.address;
  const read = <T>(address: Address, abi: Abi, fn: string, a: readonly unknown[] = []) => c.readContract({ address, abi, functionName: fn, args: a }) as Promise<T>;

  /** A cross-VM call into an EVM contract, signed hybrid by the account (as QoreX would). */
  const xvm = async (acc: UnifiedAccount, from: Address, contract: Address, data: Hex, label: string) => {
    const evmGas = await c.estimateGas({ account: from, to: contract, data });
    const gas = crossVmGas(evmGas, (data.length - 2) / 2);
    const m = msg.crossvm.crossVmCall({ sender: acc.cosmos, sourceVm: "cosmwasm", targetVm: "evm", targetContract: contract, payload: toBytes(data), async: false });
    const tx = await broadcastNative(acc, "hybrid", [m], undefined, gas);
    const t = (await fetch(`https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/${tx}`).then((r) => r.json())) as { tx_response?: { gas_used: string } };
    console.log(`${label}: tx ${tx} (EVM estimate ${evmGas}, gas limit ${gas}, used ${t.tx_response?.gas_used ?? "?"})`);
    await new Promise((r) => setTimeout(r, 5000));
    return tx;
  };
  const sign = async (address: Address, abi: Abi, actionName: string, who: Address, params: Hex, secret: Uint8Array) => {
    const [action, nonce, block] = await Promise.all([read<Hex>(address, abi, actionName), read<bigint>(address, abi, "pqNonce", [who]), c.getBlock()]);
    const validUntil = block.timestamp + 30n * 60n;
    const digest = await read<Hex>(address, abi, "actionDigest", [action, who, nonce, validUntil, params]);
    const message = await read<Hex>(address, abi, "pqMessage", [digest]);
    return { validUntil, sig: toHex(pqcSign(secret, toBytes(message))) };
  };

  // 1. Device key (a test device; the web app keeps its own behind a passkey).
  let seedHex = process.env.QROW_DEVICE_SEED?.trim();
  if (!seedHex) {
    seedHex = toHex(randomBytes(32));
    appendFileSync(".env", `\n# Qrow v3 test device key seed for ${me} (QrowKeys). Secret: never share.\nQROW_DEVICE_SEED=${seedHex}\n`);
    console.log("new device seed saved to .env as QROW_DEVICE_SEED (not printed)");
  }
  const device = generatePqcKeypair(toBytes(seedHex as Hex));
  const pubkey = toHex(device.publicKey);
  const slot = 0;
  if ((await read<number>(dep.QrowKeys, keysAbi, "deviceCount", [me])) === 0) {
    const { validUntil, sig } = await sign(dep.QrowKeys, keysAbi, "ACTION_ADD_DEVICE", me, keccak256(pubkey), device.secretKey);
    await xvm(owner, me, dep.QrowKeys, encodeFunctionData({ abi: keysAbi, functionName: "addFirstDevice", args: [pubkey, validUntil, sig] }), "1. addFirstDevice");
  }
  console.log(`   device key in slot ${slot}: ${(await read<Hex>(dep.QrowKeys, keysAbi, "deviceKey", [me, slot])).toLowerCase() === pubkey.toLowerCase() ? "registered" : "MISSING"}`);
  const withSlot = (sig: Hex) => concat([toHex(slot, { size: 1 }), sig]);

  // 2. Launch a test coin and claim the public share, both with device-key signatures.
  const [name, symbol, supply, bps, desc] = ["Cross Lane", "XLANE", 1_000_000n, 500, "Smoke test of the QoreX-only flow. No value."];
  const h = (s: string) => keccak256(toBytes(s));
  const launchParams = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint16" }, { type: "bytes32" }], [h(name), h(symbol), supply, bps, h(desc)]));
  const launch = await sign(dep.QrowCoinFactory, factoryAbi, "ACTION_LAUNCH", me, launchParams, device.secretKey);
  const launchTx = await xvm(owner, me, dep.QrowCoinFactory, encodeFunctionData({ abi: factoryAbi, functionName: "launch", args: [name, symbol, supply, bps, desc, launch.validUntil, withSlot(launch.sig)] }), "2a. launch XLANE");
  const n = await read<bigint>(dep.QrowCoinFactory, factoryAbi, "coinCount");
  const [coin] = await read<Address[]>(dep.QrowCoinFactory, factoryAbi, "coins", [n - 1n, 1n]);
  console.log(`   coin ${coin} (native tx ${launchTx.slice(0, 10)})`);
  const claim = await sign(coin, coinAbi, "ACTION_CLAIM", me, keccak256(encodeAbiParameters([{ type: "address" }], [coin])), device.secretKey);
  await xvm(owner, me, coin, encodeFunctionData({ abi: coinAbi, functionName: "claim", args: [claim.validUntil, withSlot(claim.sig)] }), "2b. claim XLANE share");
  const bal = await read<bigint>(coin, erc20Abi as unknown as Abi, "balanceOf", [me]);
  console.log(`   deployer XLANE balance: ${bal}`);

  // 3. Pay 10 XLANE to the Drill account through the escrow.
  const amount = 10n * 10n ** 18n;
  await xvm(owner, me, coin, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [dep.QrowEscrow, amount] }), "3a. XLANE.approve(escrow, 10)");
  const params = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "bytes32" }], [drillAddr, coin, amount, 0, keccak256("0x")]));
  const create = await sign(dep.QrowEscrow, escrowAbi, "ACTION_CREATE", me, params, device.secretKey);
  await xvm(owner, me, dep.QrowEscrow, encodeFunctionData({ abi: escrowAbi, functionName: "createPayment", args: [drillAddr, coin, amount, 0, "0x", create.validUntil, withSlot(create.sig)] }), "3b. createPayment (device key)");
  const id = await read<bigint>(dep.QrowEscrow, escrowAbi, "paymentCount");
  console.log(`   payment #${id} created`);

  // 4. The Drill account claims with its chain key (bare signature), also via cross-VM.
  const take = await sign(dep.QrowEscrow, escrowAbi, "ACTION_CLAIM", drillAddr, keccak256(encodeAbiParameters([{ type: "uint256" }], [id])), drill.pqc.secretKey);
  await xvm(drill, drillAddr, dep.QrowEscrow, encodeFunctionData({ abi: escrowAbi, functionName: "claim", args: [id, take.validUntil, take.sig] }), "4. claim by the Drill account (chain key)");
  const p = await read<{ status: number }>(dep.QrowEscrow, escrowAbi, "getPayment", [id]);
  console.log(`   payment #${id}: ${["None", "Pending", "Claimed", "Released", "Cancelled", "Refunded"][p.status] ?? p.status}; Drill XLANE balance ${await read<bigint>(coin, erc20Abi as unknown as Abi, "balanceOf", [drillAddr])}`);
  void parseEventLogs;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
