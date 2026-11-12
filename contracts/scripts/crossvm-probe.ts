/**
 * crossvm-probe.ts (research, 13 Nov): can a native-lane MsgCrossVMCall, signed with the account's
 * hybrid secp256k1 + ML-DSA-87 signature (what QoreX's signAndBroadcast produces), call an EVM
 * contract as the account's own 0x address, with NO EVM window open?
 *
 * Harmless probe: fUSD.approve(<escrow>, 12345 units = 0.012345 fUSD), then read the allowance.
 *   npm run crossvm-probe
 */
import { readFileSync } from "node:fs";
import { msg } from "@qorechain/sdk";
import { encodeFunctionData, erc20Abi, toBytes, type Address } from "viem";
import { broadcastNative, evmClients, loadAccount, network } from "./lib.js";

const FUSD: Address = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const AMOUNT = 12_345n;

async function main() {
  const dep = JSON.parse(readFileSync("deployments/testnet.json", "utf8")) as { QrowEscrow: Address };
  const acc = await loadAccount();
  const { publicClient: c, account } = evmClients(acc);
  const me = account.address;

  const win = (await fetch(`${network().rest}/qorechain/pqc/v1/evm_window/${acc.cosmos}`).then((r) => r.json())) as { live?: boolean };
  console.log(`EVM window open before the probe: ${!!win.live}`);
  const before = await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "allowance", args: [me, dep.QrowEscrow] });
  console.log(`allowance before: ${before}`);

  const payload = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [dep.QrowEscrow, AMOUNT] });
  const m = msg.crossvm.crossVmCall({ sender: acc.cosmos, sourceVm: process.env.SRC_VM ?? "native", targetVm: "evm", targetContract: FUSD, payload: toBytes(payload), async: false });
  console.log(`message: ${m.typeUrl}`);
  const tx = await broadcastNative(acc, "hybrid", [m]);
  console.log(`native tx (hybrid-signed): ${tx}`);

  await new Promise((r) => setTimeout(r, 6000));
  const after = await c.readContract({ address: FUSD, abi: erc20Abi, functionName: "allowance", args: [me, dep.QrowEscrow] });
  console.log(`allowance after: ${after} -> msg.sender was ${after === AMOUNT ? "the account's own 0x address (OK)" : "NOT the account"}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : e);
  process.exitCode = 1;
});
