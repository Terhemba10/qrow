/**
 * authz-probe.ts (research, 13 Nov): can an account delegate Qrow actions to an app-held key with
 * x/authz, so the delegate runs them AS the account? Deployer = granter (stands in for a QoreX user),
 * Drill account = grantee (stands in for the app's device account). All hybrid-signed.
 *   1. deployer grants MsgCrossVMCall + MsgConvertCoin to the Drill account (expires in 1 hour)
 *   2. Drill: MsgExec{ MsgCrossVMCall(sender = deployer, fUSD.approve(escrow, 7)) } -> allowance(deployer, escrow) == 7?
 *   3. Drill: MsgExec{ MsgConvertCoin(sender = deployer, 1006 bank fUSD -> deployer's ERC-20) }
 *   4. deployer revokes both grants
 *   npm run authz-probe
 */
import { readFileSync } from "node:fs";
import { BinaryWriter } from "@bufbuild/protobuf/wire";
import { msg, qorechainRegistry } from "@qorechain/sdk";
import { GenericAuthorization } from "cosmjs-types/cosmos/authz/v1beta1/authz";
import { Timestamp } from "cosmjs-types/google/protobuf/timestamp";
import { encodeFunctionData, erc20Abi, toBytes, type Address } from "viem";
import { broadcastNative, evmClients, loadAccount, network } from "./lib.js";

const REST = network().rest;
const FUSD: Address = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const FUSD_DENOM = `erc20:${FUSD}`;
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
    throw new Error("n/a");
  },
  fromPartial: (m: unknown) => m,
} as never);

const result = async (hash: string) => {
  await new Promise((r) => setTimeout(r, 6000));
  const t = (await fetch(`${REST}/cosmos/tx/v1beta1/txs/${hash}`).then((r) => r.json())) as { tx_response?: { code: number; gas_used: string; raw_log: string } };
  return `code ${t.tx_response?.code} gas ${t.tx_response?.gas_used}${t.tx_response?.code ? ` log ${t.tx_response.raw_log.slice(0, 200)}` : ""}`;
};

async function main() {
  const owner = await loadAccount();
  const app = await loadAccount("DRILL_");
  const { publicClient: c, account } = evmClients(owner);
  const me = account.address;
  const escrow = (JSON.parse(readFileSync("deployments/testnet.json", "utf8")) as { QrowEscrow: Address }).QrowEscrow;
  const expiration = Timestamp.fromPartial({ seconds: BigInt(Math.floor(Date.now() / 1000) + 3600), nanos: 0 });
  const grant = (m: string) =>
    msg.authz.grant({
      granter: owner.cosmos,
      grantee: app.cosmos,
      grant: { authorization: { typeUrl: "/cosmos.authz.v1beta1.GenericAuthorization", value: GenericAuthorization.encode({ msg: m }).finish() }, expiration },
    });

  // 1. Grants
  const g = await broadcastNative(owner, "hybrid", [grant(XVM), grant(CONVERT)], undefined, 400_000);
  console.log(`1. grants (cross-VM, convert) to ${app.cosmos}: tx ${g} ${await result(g)}`);

  // 2. Exec a cross-VM call as the owner
  const before = await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "allowance", args: [me, escrow] });
  const inner = msg.crossvm.crossVmCall({ sender: owner.cosmos, sourceVm: "cosmwasm", targetVm: "evm", targetContract: FUSD, payload: toBytes(encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [escrow, 7n] })), async: false });
  try {
    const x = await broadcastNative(app, "hybrid", [msg.authz.exec({ grantee: app.cosmos, msgs: [{ typeUrl: XVM, value: registry.encode(inner as never) }] })], undefined, 800_000, registry as never);
    const after = await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "allowance", args: [me, escrow] });
    console.log(`2. MsgExec(MsgCrossVMCall as owner): tx ${x} ${await result(x)}; allowance(owner, escrow) ${before} -> ${await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "allowance", args: [me, escrow] })} (read before wait: ${after})`);
  } catch (e) {
    console.log(`2. MsgExec(MsgCrossVMCall) refused: ${(e as Error).message.slice(0, 300)}`);
  }

  // 3. Exec a convert as the owner
  const bank = ((await fetch(`${REST}/cosmos/bank/v1beta1/balances/${owner.cosmos}`).then((r) => r.json())) as { balances: { denom: string; amount: string }[] }).balances;
  const have = bank.find((b) => b.denom === FUSD_DENOM)?.amount ?? "0";
  if (have !== "0") {
    try {
      const conv = { typeUrl: CONVERT, value: { coin: { denom: FUSD_DENOM, amount: have }, receiver: me, sender: owner.cosmos } };
      const x = await broadcastNative(app, "hybrid", [msg.authz.exec({ grantee: app.cosmos, msgs: [{ typeUrl: CONVERT, value: registry.encode(conv as never) }] })], undefined, 900_000, registry as never);
      console.log(`3. MsgExec(MsgConvertCoin ${have} as owner): tx ${x} ${await result(x)}; owner ERC-20 fUSD now ${await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "balanceOf", args: [me] })}`);
    } catch (e) {
      console.log(`3. MsgExec(MsgConvertCoin) refused: ${(e as Error).message.slice(0, 300)}`);
    }
  } else console.log("3. skipped: owner has no bank fUSD");

  // 4. Revoke
  const r = await broadcastNative(owner, "hybrid", [msg.authz.revoke({ granter: owner.cosmos, grantee: app.cosmos, msgTypeUrl: XVM }), msg.authz.revoke({ granter: owner.cosmos, grantee: app.cosmos, msgTypeUrl: CONVERT })], undefined, 300_000);
  console.log(`4. revoke both: tx ${r} ${await result(r)}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
