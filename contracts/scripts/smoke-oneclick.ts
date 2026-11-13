/**
 * smoke-oneclick.ts: the UX redesign's "one QoreX approval per action" on testnet, mirroring
 * web/src/lib/action.ts. A brand-new user account plays the QoreX user (its txs are what QoreX would
 * sign); a fresh device account does the rest. Secrets go to .env, never printed.
 *   0. setup of the test itself: the Drill account funds the new user (2 QOR); the user registers its
 *      ML-DSA key (what QoreX does on a first transaction) and swaps 0.3 QOR for bank fUSD (like the faucet)
 *   FIRST ACTION (pay 0.01 fUSD to the deployer):
 *   1. user, ONE tx: 1 QOR to the device + grant MsgCrossVMCall (30 d) + grant MsgConvertCoin (10 min)
 *      + open a window for QrowKeys, fUSD and the escrow (3 calls)                     <- the one approval
 *   2. device: register its own ML-DSA key; addFirstDevice as the user; convert bank fUSD to ERC-20 as
 *      the user; approve; createPayment signed by the device key
 *   SECOND ACTION (cancel that payment):
 *   3. user, ONE tx: open a window for the escrow (1 call)                             <- the one approval
 *   4. device: cancel, signed by the device key
 *   npm run smoke:oneclick
 */
import { appendFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { BinaryWriter } from "@bufbuild/protobuf/wire";
import { buildRegisterPqcKeyMsg, msg, openEvmWindowMsg, pqcSign, qorechainRegistry, signProofOfPossession, unifiedAccountFromSeed, type UnifiedAccount } from "@qorechain/sdk";
import { concat, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, toBytes, toHex, type Abi, type Address, type Hex } from "viem";
import { broadcastNative, evmClients, loadAccount, network } from "./lib.js";

const NET = network();
const dep = JSON.parse(readFileSync("deployments/testnet.json", "utf8")) as { QrowKeys: Address; QrowEscrow: Address };
const abiOf = (n: string) => (JSON.parse(readFileSync(`out/${n}.sol/${n}.json`, "utf8")) as { abi: Abi }).abi;
const keysAbi = abiOf("QrowKeys");
const escrowAbi = abiOf("QrowEscrow");
const FUSD: Address = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const XVM = "/qorechain.crossvm.v1.MsgCrossVMCall";
const CONVERT = "/cosmos.evm.erc20.v1.MsgConvertCoin";
const registry = qorechainRegistry();
registry.register(CONVERT, {
  encode(m: { coin: { denom: string; amount: string }; receiver: string; sender: string }, w: BinaryWriter = new BinaryWriter()) {
    const c = w.uint32(10).fork();
    c.uint32(10).string(m.coin.denom).uint32(18).string(m.coin.amount);
    c.join();
    return w.uint32(18).string(m.receiver).uint32(26).string(m.sender);
  },
  decode() {
    throw new Error("not needed");
  },
  fromPartial: (m: unknown) => m,
} as never);
const crossVmGas = (evm: bigint, bytes: number) => Math.ceil((Number(evm) + 250_000 + 90 * bytes) * 1.1);
const genericAuth = (t: string) => {
  const b = new TextEncoder().encode(t);
  return new Uint8Array([0x0a, b.length, ...b]);
};
const grant = (granter: string, grantee: string, type: string, seconds: number) =>
  msg.authz.grant({ granter, grantee, grant: { authorization: { typeUrl: "/cosmos.authz.v1beta1.GenericAuthorization", value: genericAuth(type) }, expiration: { seconds: BigInt(Math.floor(Date.now() / 1000) + seconds), nanos: 0 } } as never });
const result = async (h: string) => {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const t = (await fetch(`${NET.rest}/cosmos/tx/v1beta1/txs/${h}`).then((r) => r.json())) as { tx_response?: { code: number; gas_used: string; raw_log: string } };
    if (t.tx_response) {
      if (t.tx_response.code) throw new Error(`${h} failed: ${t.tx_response.raw_log.slice(-300)}`);
      return `ok, gas ${t.tx_response.gas_used}`;
    }
  }
  throw new Error(`${h} not confirmed`);
};
const bank = async (addr: string, denom: string) =>
  BigInt(((await fetch(`${NET.rest}/cosmos/bank/v1beta1/balances/${addr}/by_denom?denom=${encodeURIComponent(denom)}`).then((r) => r.json())) as { balance?: { amount: string } }).balance?.amount ?? "0");

function secretAccount(envName: string, label: string): UnifiedAccount {
  let secret = process.env[envName]?.trim();
  if (!secret) {
    secret = toHex(randomBytes(64));
    appendFileSync(".env", `\n# ${label}. Secret: never share.\n${envName}=${secret}\n`);
  }
  const s = toBytes(secret as Hex);
  return unifiedAccountFromSeed(s.slice(0, 32), { pqcSecret: s.slice(32, 64) });
}

async function main() {
  const drill = await loadAccount("DRILL_");
  const user = secretAccount("QROW_SMOKE_USER2_SECRET", "One-click smoke test: user account (plays the QoreX user)");
  const device = secretAccount("QROW_SMOKE_DEVICE2_SECRET", "One-click smoke test: device account");
  const { publicClient: c } = evmClients(drill);
  const me = evmClients(user).account.address;
  const deployer = evmClients(await loadAccount()).account.address;
  console.log(`user ${user.cosmos} (${me}), device ${device.cosmos}`);
  const log: string[] = [];
  const step = async (label: string, h: string) => {
    const r = await result(h);
    log.push(`| ${label} | \`${h}\` | ${r} |`);
    console.log(`${label}: ${h} ${r}`);
  };

  // 0. Test set-up (not part of the measured flow).
  if ((await bank(user.cosmos, "uqor")) < 1_500_000n) await step("0a. Drill funds the new user, 2 QOR", await broadcastNative(drill, "hybrid", [msg.bank.send({ fromAddress: drill.cosmos, toAddress: user.cosmos, amount: [{ denom: "uqor", amount: "2000000" }] })], undefined, 300_000));
  const pqc = (await fetch(`${NET.rest}/qorechain/pqc/v1/account/${user.cosmos}`).then((r) => r.json()).catch(() => ({}))) as { account?: unknown };
  if (!pqc.account) {
    const pop = signProofOfPossession({ chainId: NET.chainId, account: user.cosmos, keypair: user.pqc });
    await step("0b. user registers its ML-DSA key (QoreX does this on a first transaction)", await broadcastNative(user, "classical", [buildRegisterPqcKeyMsg(user.cosmos, { pqcKeypair: user.pqc, proofOfPossession: pop })], undefined, 600_000));
  }
  const FUSD_DENOM = `erc20:${FUSD}`;
  if ((await bank(user.cosmos, FUSD_DENOM)) < 10_000n)
    await step("0c. user swaps 0.3 QOR for bank fUSD (like the faucet's fUSD)", await broadcastNative(user, "hybrid", [msg.amm.swapExactIn({ sender: user.cosmos, poolId: "2", tokenIn: { denom: "uqor", amount: "300000" }, denomOut: FUSD_DENOM, minOut: "1" })], undefined, 400_000));

  const read = <T>(address: Address, abi: Abi, fn: string, a: readonly unknown[] = []) => c.readContract({ address, abi, functionName: fn, args: a }) as Promise<T>;
  const sign = async (address: Address, abi: Abi, actionName: string, params: Hex) => {
    const [action, nonce, block] = await Promise.all([read<Hex>(address, abi, actionName), read<bigint>(address, abi, "pqNonce", [me]), c.getBlock()]);
    const validUntil = block.timestamp + 1800n;
    const message = await read<Hex>(address, abi, "pqMessage", [await read<Hex>(address, abi, "actionDigest", [action, me, nonce, validUntil, params])]);
    return { validUntil, sig: toHex(pqcSign(device.pqc.secretKey, toBytes(message))) };
  };
  const asUser = async (label: string, call: { to: Address; data: Hex }) => {
    const gas = 150_000 + crossVmGas(await c.estimateGas({ account: me, to: call.to, data: call.data }), (call.data.length - 2) / 2);
    const m = msg.crossvm.crossVmCall({ sender: user.cosmos, sourceVm: "cosmwasm", targetVm: "evm", targetContract: call.to, payload: toBytes(call.data), async: false });
    await step(label, await broadcastNative(device, "hybrid", [msg.authz.exec({ grantee: device.cosmos, msgs: [{ typeUrl: m.typeUrl, value: registry.encode(m as never) }] })], undefined, gas));
  };

  // FIRST ACTION: pay 0.01 fUSD. 1. The ONE user approval.
  const amount = 10_000n; // 0.01 fUSD
  const targets = [dep.QrowKeys, FUSD, dep.QrowEscrow].map((t) => t.toLowerCase());
  const bundle = [
    msg.bank.send({ fromAddress: user.cosmos, toAddress: device.cosmos, amount: [{ denom: "uqor", amount: "1000000" }] }),
    grant(user.cosmos, device.cosmos, XVM, 30 * 86_400),
    grant(user.cosmos, device.cosmos, CONVERT, 10 * 60),
    openEvmWindowMsg({ sender: user.cosmos, blocks: 420n, maxTxs: 3n, maxValue: 750_000n * 3n, allowedTargets: targets }),
  ];
  await step("1. USER APPROVAL (first action): device fees + permission + convert permission + window (3 calls)", await broadcastNative(user, "hybrid", bundle, "Qrow", 250_000 * bundle.length + 100_000));

  // 2. The device, without the user.
  const pop = signProofOfPossession({ chainId: NET.chainId, account: device.cosmos, keypair: device.pqc });
  await step("2a. device registers its own ML-DSA key", await broadcastNative(device, "classical", [buildRegisterPqcKeyMsg(device.cosmos, { pqcKeypair: device.pqc, proofOfPossession: pop })], undefined, 600_000));
  const pk = toHex(device.pqc.publicKey);
  const add = await sign(dep.QrowKeys, keysAbi, "ACTION_ADD_DEVICE", keccak256(pk));
  await asUser("2b. device: addFirstDevice as the user", { to: dep.QrowKeys, data: encodeFunctionData({ abi: keysAbi, functionName: "addFirstDevice", args: [pk, add.validUntil, add.sig] }) });
  const conv = { typeUrl: CONVERT, value: { coin: { denom: FUSD_DENOM, amount: amount.toString() }, receiver: me, sender: user.cosmos } };
  await step("2c. device: convert 0.01 bank fUSD to ERC-20 as the user", await broadcastNative(device, "hybrid", [msg.authz.exec({ grantee: device.cosmos, msgs: [{ typeUrl: CONVERT, value: registry.encode(conv as never) }] })], undefined, 750_000, registry as never));
  await asUser("2d. device: approve exactly 0.01 fUSD as the user", { to: FUSD, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [dep.QrowEscrow, amount] }) });
  const [slots, hashes] = await read<[number[], Hex[]]>(dep.QrowKeys, keysAbi, "devices", [me]);
  const slot = slots[hashes.findIndex((h) => h.toLowerCase() === keccak256(pk).toLowerCase())];
  const params = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "bytes32" }], [deployer, FUSD, amount, 0, keccak256("0x")]));
  const cr = await sign(dep.QrowEscrow, escrowAbi, "ACTION_CREATE", params);
  await asUser("2e. device: createPayment as the user (device-key signature)", { to: dep.QrowEscrow, data: encodeFunctionData({ abi: escrowAbi, functionName: "createPayment", args: [deployer, FUSD, amount, 0, "0x", cr.validUntil, concat([toHex(slot, { size: 1 }), cr.sig])] }) });
  const id = await read<bigint>(dep.QrowEscrow, escrowAbi, "paymentCount");
  console.log(`   payment #${id}: ${JSON.stringify(await read(dep.QrowEscrow, escrowAbi, "getPayment", [id]), (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);

  // SECOND ACTION: cancel it. 3. The ONE user approval.
  await step("3. USER APPROVAL (second action): window for the escrow (1 call)", await broadcastNative(user, "hybrid", [openEvmWindowMsg({ sender: user.cosmos, blocks: 420n, maxTxs: 1n, maxValue: 750_000n, allowedTargets: [dep.QrowEscrow.toLowerCase()] })], "Qrow", 300_000));
  const cancelParams = keccak256(encodeAbiParameters([{ type: "uint256" }], [id]));
  const ca = await sign(dep.QrowEscrow, escrowAbi, "ACTION_CANCEL", cancelParams);
  await asUser("4. device: cancel as the user (device-key signature)", { to: dep.QrowEscrow, data: encodeFunctionData({ abi: escrowAbi, functionName: "cancel", args: [id, ca.validUntil, concat([toHex(slot, { size: 1 }), ca.sig])] }) });
  const after = await read<{ status: number }>(dep.QrowEscrow, escrowAbi, "getPayment", [id]);
  console.log(`   payment #${id} status now ${after.status} (4 = Cancelled)`);
  console.log(`\nQRW-PAY-${id.toString().padStart(6, "0")}\n${log.join("\n")}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
