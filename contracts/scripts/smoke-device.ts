/**
 * smoke-device.ts: the approved fallback end to end on testnet, mirroring web/src/lib (appKey.ts, xvm.ts):
 * the Drill account plays the QoreX user (its txs are what QoreX would sign); a fresh device account
 * (secrets in .env, never printed) does the rest.
 *   1. user: bank-send 1 QOR to the device + authz grant for MsgCrossVMCall      (QoreX, setup)
 *   2. device: register its own ML-DSA-87 key (classical, one-time)
 *   3. user: open a window for QrowKeys, 1 tx                                     (QoreX)
 *   4. device: MsgExec[ MsgCrossVMCall(user -> QrowKeys.addFirstDevice) ]         (as the user)
 *   5. user: open a window for XLANE + escrow, 2 txs                               (QoreX)
 *   6. device: MsgExec approve, then MsgExec createPayment signed by the device key (as the user)
 *   7. check: payment exists, sender is the user; windows used up
 *   npm run smoke:device
 */
import { appendFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { buildRegisterPqcKeyMsg, evmToQor, msg, openEvmWindowMsg, pqcSign, qorechainRegistry, signProofOfPossession, unifiedAccountFromSeed } from "@qorechain/sdk";
import { concat, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, toBytes, toHex, type Abi, type Address, type Hex } from "viem";
import { broadcastNative, evmClients, loadAccount, network } from "./lib.js";

const NET = network();
const dep = JSON.parse(readFileSync("deployments/testnet.json", "utf8")) as { QrowKeys: Address; QrowEscrow: Address };
const abiOf = (n: string) => (JSON.parse(readFileSync(`out/${n}.sol/${n}.json`, "utf8")) as { abi: Abi }).abi;
const keysAbi = abiOf("QrowKeys");
const escrowAbi = abiOf("QrowEscrow");
const XLANE: Address = "0x73BC3fd1B8b06E49Bd4a25e7f94990EAf43B4E34"; // launched in smoke:v3; the Drill account holds 10
const XVM = "/qorechain.crossvm.v1.MsgCrossVMCall";
const registry = qorechainRegistry();
const crossVmGas = (evm: bigint, bytes: number) => Math.ceil((Number(evm) + 250_000 + 90 * bytes) * 1.1);
const genericAuth = (t: string) => {
  const b = new TextEncoder().encode(t);
  return new Uint8Array([0x0a, b.length, ...b]);
};
const status = async (h: string) => {
  await new Promise((r) => setTimeout(r, 6000));
  const t = (await fetch(`${NET.rest}/cosmos/tx/v1beta1/txs/${h}`).then((r) => r.json())) as { tx_response?: { code: number; gas_used: string; raw_log: string } };
  return `code ${t.tx_response?.code} gas ${t.tx_response?.gas_used}${t.tx_response?.code ? ` ${t.tx_response.raw_log.slice(-220)}` : ""}`;
};

async function main() {
  const user = await loadAccount("DRILL_");
  const { publicClient: c, account } = evmClients(user);
  const me = account.address;

  let secret = process.env.QROW_SMOKE_DEVICE_SECRET?.trim();
  if (!secret) {
    secret = toHex(randomBytes(64));
    appendFileSync(".env", `\n# Smoke-test device account (fallback design). Secret: never share.\nQROW_SMOKE_DEVICE_SECRET=${secret}\n`);
  }
  const s = toBytes(secret as Hex);
  const device = unifiedAccountFromSeed(s.slice(0, 32), { pqcSecret: s.slice(32, 64) });
  console.log(`user ${user.cosmos}, device ${device.cosmos}`);

  // 1. QoreX would sign: fees + permission.
  const g = await broadcastNative(user, "hybrid", [
    msg.bank.send({ fromAddress: user.cosmos, toAddress: device.cosmos, amount: [{ denom: "uqor", amount: "1000000" }] }),
    msg.authz.grant({ granter: user.cosmos, grantee: device.cosmos, grant: { authorization: { typeUrl: "/cosmos.authz.v1beta1.GenericAuthorization", value: genericAuth(XVM) }, expiration: { seconds: BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400), nanos: 0 } } as never }),
  ], undefined, 400_000);
  console.log(`1. user: 1 QOR + grant to device: ${g} ${await status(g)}`);

  // 2. Device registers its own quantum-safe key (classical, once).
  const pop = signProofOfPossession({ chainId: NET.chainId, account: device.cosmos, keypair: device.pqc });
  const r2 = await broadcastNative(device, "classical", [buildRegisterPqcKeyMsg(device.cosmos, { pqcKeypair: device.pqc, proofOfPossession: pop })], undefined, 600_000);
  console.log(`2. device registers its ML-DSA key: ${r2} ${await status(r2)}`);

  const read = <T>(address: Address, abi: Abi, fn: string, a: readonly unknown[] = []) => c.readContract({ address, abi, functionName: fn, args: a }) as Promise<T>;
  const sign = async (address: Address, abi: Abi, actionName: string, params: Hex) => {
    const [action, nonce, block] = await Promise.all([read<Hex>(address, abi, actionName), read<bigint>(address, abi, "pqNonce", [me]), c.getBlock()]);
    const validUntil = block.timestamp + 1800n;
    const message = await read<Hex>(address, abi, "pqMessage", [await read<Hex>(address, abi, "actionDigest", [action, me, nonce, validUntil, params])]);
    return { validUntil, sig: toHex(pqcSign(device.pqc.secretKey, toBytes(message))) };
  };
  const execAsUser = async (calls: { to: Address; data: Hex }[], label: string) => {
    let gas = 150_000;
    const inner = [];
    for (const call of calls) {
      gas += crossVmGas(await c.estimateGas({ account: me, to: call.to, data: call.data }), (call.data.length - 2) / 2);
      const m = msg.crossvm.crossVmCall({ sender: user.cosmos, sourceVm: "cosmwasm", targetVm: "evm", targetContract: call.to, payload: toBytes(call.data), async: false });
      inner.push({ typeUrl: m.typeUrl, value: registry.encode(m as never) });
    }
    const h = await broadcastNative(device, "hybrid", [msg.authz.exec({ grantee: device.cosmos, msgs: inner })], undefined, gas);
    console.log(`${label}: ${h} ${await status(h)}`);
  };
  const openWindow = async (targets: Address[], txs: number, label: string) => {
    const h = await broadcastNative(user, "hybrid", [openEvmWindowMsg({ sender: user.cosmos, blocks: 420n, maxTxs: BigInt(txs), maxValue: 750_000n * BigInt(txs), allowedTargets: targets.map((t) => t.toLowerCase()) })], undefined, 300_000);
    console.log(`${label}: ${h} ${await status(h)}`);
  };

  // 3-4. Register the device key in QrowKeys as the user.
  if ((await read<number>(dep.QrowKeys, keysAbi, "deviceCount", [me])) === 0) {
    await openWindow([dep.QrowKeys], 1, "3. user opens window (QrowKeys, 1 tx)");
    const pk = toHex(device.pqc.publicKey);
    const p = await sign(dep.QrowKeys, keysAbi, "ACTION_ADD_DEVICE", keccak256(pk));
    await execAsUser([{ to: dep.QrowKeys, data: encodeFunctionData({ abi: keysAbi, functionName: "addFirstDevice", args: [pk, p.validUntil, p.sig] }) }], "4. device: addFirstDevice as user");
  }
  const [slots, hashes] = await read<[number[], Hex[]]>(dep.QrowKeys, keysAbi, "devices", [me]);
  const slot = slots[hashes.findIndex((h) => h.toLowerCase() === keccak256(toHex(device.pqc.publicKey)).toLowerCase())];
  console.log(`   device key slot for the user: ${slot}`);

  // 5-6. Pay 1 XLANE to the deployer, as the user, from the device.
  const deployer = evmClients(await loadAccount()).account.address;
  const amount = 10n ** 18n;
  await openWindow([XLANE, dep.QrowEscrow], 2, "5. user opens window (XLANE + escrow, 2 txs)");
  await execAsUser([{ to: XLANE, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [dep.QrowEscrow, amount] }) }], "6a. device: approve as user");
  const params = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "bytes32" }], [deployer, XLANE, amount, 0, keccak256("0x")]));
  const cr = await sign(dep.QrowEscrow, escrowAbi, "ACTION_CREATE", params);
  await execAsUser([{ to: dep.QrowEscrow, data: encodeFunctionData({ abi: escrowAbi, functionName: "createPayment", args: [deployer, XLANE, amount, 0, "0x", cr.validUntil, concat([toHex(slot, { size: 1 }), cr.sig])] }) }], "6b. device: createPayment as user (device-key signature)");

  // 7. Check.
  const id = await read<bigint>(dep.QrowEscrow, escrowAbi, "paymentCount");
  const pay = await read<{ sender: Address; recipient: Address; status: number }>(dep.QrowEscrow, escrowAbi, "getPayment", [id]);
  const w = (await fetch(`${NET.rest}/qorechain/pqc/v1/evm_window/${evmToQor(me)}`).then((r) => r.json())) as { live: boolean; remaining_txs: string };
  console.log(`7. payment #${id}: sender ${pay.sender} (user ${me}) status ${pay.status}; user's window remaining txs ${w.remaining_txs}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
