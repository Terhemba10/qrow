/**
 * Every EVM action in Qrow, signed in QoreX: a native-lane MsgCrossVMCall that runs the contract call
 * as the user's own 0x address. QoreX adds the hybrid secp256k1 + ML-DSA-87 signature, so no MetaMask
 * and no EVM window are needed, and the account's EVM lane stays shut. Verified on testnet 13 Nov
 * (docs/TEST_NOTES.md, v3 smoke test).
 */
import { evmToQor, msg } from "@qorechain/sdk";
import { toBytes, type Address, type Hex, type PublicClient } from "viem";
import { REST } from "../config/network";
import { qorexAccount, signInQorex } from "./staking";

/**
 * Gas for the native transaction: the EVM estimate plus the measured cross-VM overhead (signature
 * check and payload bytes) plus 10%. The chain charges the whole limit, so it stays close to real use.
 */
export const crossVmGas = (evmGas: bigint, payloadBytes: number) => Math.ceil((Number(evmGas) + 250_000 + 90 * payloadBytes) * 1.1);

/** The fee QoreX will charge at the chain minimum (0.1 uqor per gas), in QOR, for display. */
export const feeQor = (gas: number) => gas / 10 / 1_000_000;

export class XvmError extends Error {}

/** QoreX must be on the same account the app is acting for. */
export async function qorexFor(from: Address): Promise<string> {
  const qor = await qorexAccount().catch(() => undefined);
  const want = evmToQor(from);
  if (!qor) throw new XvmError("QoreX didn’t share an account. Unlock QoreX and connect Qrow.");
  if (qor !== want) throw new XvmError(`QoreX is on ${qor}, but this is for ${want}. Switch accounts in QoreX.`);
  return qor;
}

/** Estimate, then ask QoreX to sign and broadcast; resolves when the chain has included it. */
export async function sendViaQorex(client: PublicClient, from: Address, to: Address, data: Hex): Promise<{ txHash: string; gasUsed?: number }> {
  const sender = await qorexFor(from);
  const evmGas = await client.estimateGas({ account: from, to, data });
  const gas = crossVmGas(evmGas, (data.length - 2) / 2);
  const m = msg.crossvm.crossVmCall({ sender, sourceVm: "cosmwasm", targetVm: "evm", targetContract: to, payload: toBytes(data), async: false });
  let r: { txHash: string; code: number };
  try {
    r = await signInQorex([m], undefined, gas);
  } catch (e) {
    const t = e instanceof Error ? e.message : String(e);
    if (/reject|denied|cancel/i.test(t)) throw new XvmError("You cancelled in QoreX. Nothing was sent.");
    if (/cannot display|not supported|unsupported/i.test(t)) throw new XvmError("This QoreX version can’t show this kind of transaction yet. Update QoreX and try again.");
    if (/insufficient/i.test(t)) throw new XvmError("Not enough QOR for the network fee. Get free test QOR from the faucet.");
    throw new XvmError(t);
  }
  return waitForNativeTx(r.txHash);
}

/** Poll the REST API until the transaction is in a block; throw a readable error if it failed. */
export async function waitForNativeTx(hash: string, timeoutMs = 90_000): Promise<{ txHash: string; gasUsed?: number }> {
  const deadline = Date.now() + timeoutMs;
  let wait = 1500;
  while (Date.now() < deadline) {
    const res = await fetch(`${REST}/cosmos/tx/v1beta1/txs/${hash}`).catch(() => undefined);
    if (res?.ok) {
      const j = (await res.json()) as { tx_response?: { code: number; raw_log: string; gas_used: string } };
      const t = j.tx_response;
      if (t) {
        if (t.code !== 0) throw new XvmError(friendlyChainError(t.raw_log));
        return { txHash: hash, gasUsed: Number(t.gas_used) };
      }
    }
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 1.5, 6000); // back off: be gentle with the public endpoint
  }
  throw new XvmError(`Sent, but not confirmed yet. Check transaction ${hash} on the explorer in a minute.`);
}

function friendlyChainError(log: string): string {
  if (/out of gas/i.test(log)) return "The network ran out of gas for this step. Try again: Qrow re-estimates each time.";
  if (/insufficient fee|insufficient funds/i.test(log)) return "Not enough QOR for the network fee. Get free test QOR from the faucet.";
  if (/sequence/i.test(log)) return "Another transaction from your account was in progress. Wait a few seconds and try again.";
  if (/execution reverted/i.test(log)) return "The contract refused it. Nothing moved except the network fee.";
  return `The chain refused it: ${log.slice(0, 160)}`;
}
