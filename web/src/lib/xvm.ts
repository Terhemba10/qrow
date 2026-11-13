/**
 * How Qrow carries out a contract action for a QoreX user (approved design, 13 Nov):
 *   1. QoreX opens a short EVM window for the user, scoped to the contracts and number of calls the
 *      action needs, signed with the user's ML-DSA-87 key.
 *   2. This browser's device account runs the calls AS the user: MsgExec (x/authz, granted in QoreX at
 *      setup) of MsgCrossVMCall, hybrid-signed by the device account. The chain admits a delegated
 *      cross-VM call only inside the user's open window (proven on testnet 13 Nov).
 * QoreX can't display MsgCrossVMCall itself, which is why the device executes it.
 */
import { evmToQor, msg, openEvmWindowMsg, type UnifiedAccount } from "@qorechain/sdk";
import { toBytes, type Address, type Hex, type PublicClient } from "viem";
import { REST } from "../config/network";
import { qorexAccount, registry, signInQorex } from "./staking";

export class XvmError extends Error {}
/** QoreX wouldn't open the window for the site: the user opens it in QoreX, then retries. */
export class WindowManualError extends XvmError {
  constructor(
    public readonly targets: Address[],
    public readonly txs: number,
  ) {
    super("QoreX didn’t open the window from Qrow. Open it in QoreX instead (Settings, Security, EVM access window), then press Check again.");
  }
}

/** About 10 minutes at QoreChain testnet's ~1.4 s blocks. */
export const WINDOW_BLOCKS = 420n;
/** Fee budget per call the window may spend (3M gas at 250 gwei, in uqor; same as the CLI). */
export const PER_CALL_UQOR = 750_000n;

/** Gas for a cross-VM call: EVM estimate + measured overhead (signature check, payload bytes). */
export const crossVmGas = (evmGas: bigint, payloadBytes: number) => Math.ceil((Number(evmGas) + 250_000 + 90 * payloadBytes) * 1.1);
/** The fee at the chain minimum (0.1 uqor per gas), in QOR, for display. */
export const feeQor = (gas: number) => gas / 10 / 1_000_000;

/** QoreX must be on the same account the app is acting for. */
export async function qorexFor(from: Address): Promise<string> {
  const qor = await qorexAccount().catch(() => undefined);
  const want = evmToQor(from);
  if (!qor) throw new XvmError("QoreX didn’t share an account. Unlock QoreX and connect Qrow.");
  if (qor !== want) throw new XvmError(`QoreX is on ${qor}, but this is for ${want}. Switch accounts in QoreX.`);
  return qor;
}

export interface WindowStatus {
  live: boolean;
  remainingTxs: number;
  remainingBlocks: number;
  allowedTargets: string[];
}

export async function readWindow(account: Address): Promise<WindowStatus> {
  const res = await fetch(`${REST}/qorechain/pqc/v1/evm_window/${evmToQor(account)}`);
  if (!res.ok) throw new XvmError(`Couldn’t read your EVM window (HTTP ${res.status}).`);
  const w = (await res.json()) as { live: boolean; remaining_txs: string; remaining_blocks: string; allowed_targets: string[] };
  return { live: w.live, remainingTxs: Number(w.remaining_txs || 0), remainingBlocks: Number(w.remaining_blocks || 0), allowedTargets: (w.allowed_targets ?? []).map((t) => t.toLowerCase()) };
}

export const windowCovers = (w: WindowStatus, targets: Address[], txs: number) =>
  w.live && w.remainingTxs >= txs && w.remainingBlocks > 15 && (w.allowedTargets.length === 0 || targets.every((t) => w.allowedTargets.includes(t.toLowerCase())));

/** Make sure the user's window covers these calls, asking QoreX to open one if needed. */
export async function ensureWindow(user: Address, targets: Address[], txs: number): Promise<void> {
  const uniq = [...new Set(targets.map((t) => t.toLowerCase() as Address))];
  if (windowCovers(await readWindow(user), uniq, txs)) return;
  const sender = await qorexFor(user);
  const m = openEvmWindowMsg({ sender, blocks: WINDOW_BLOCKS, maxTxs: BigInt(txs), maxValue: PER_CALL_UQOR * BigInt(txs), allowedTargets: uniq });
  try {
    const r = await signInQorex([m], undefined, 300_000);
    await waitForNativeTx(r.txHash);
  } catch (e) {
    const t = e instanceof Error ? e.message : String(e);
    if (/reject|denied|cancel/i.test(t)) throw new XvmError("You cancelled in QoreX. Nothing was sent.");
    throw new WindowManualError(uniq, txs);
  }
  if (!windowCovers(await readWindow(user), uniq, txs)) throw new WindowManualError(uniq, txs);
}

export interface Call {
  to: Address;
  data: Hex;
}

/**
 * Run contract calls as the user, inside their window: one native transaction from the device
 * account carrying MsgExec of one MsgCrossVMCall per call. Gas from eth_estimateGas per call.
 */
export async function runAsUser(client: PublicClient, user: Address, device: UnifiedAccount, calls: Call[]): Promise<{ txHash: string }> {
  const { deviceBroadcast } = await import("./native");
  const userQor = evmToQor(user);
  let gas = 150_000; // MsgExec wrapper
  const inner = [];
  for (const c of calls) {
    const evm = await client.estimateGas({ account: user, to: c.to, data: c.data });
    gas += crossVmGas(evm, (c.data.length - 2) / 2);
    const m = msg.crossvm.crossVmCall({ sender: userQor, sourceVm: "cosmwasm", targetVm: "evm", targetContract: c.to, payload: toBytes(c.data), async: false });
    inner.push({ typeUrl: m.typeUrl, value: registry.encode(m as never) });
  }
  return deviceBroadcast(device, [msg.authz.exec({ grantee: device.cosmos, msgs: inner })], gas);
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
  if (/insufficient fee|insufficient funds/i.test(log)) return "Not enough QOR for the network fee.";
  if (/sequence/i.test(log)) return "Another transaction was in progress. Wait a few seconds and try again.";
  if (/no open EVM authorisation window|does not admit/i.test(log)) return "Your EVM window closed or doesn’t cover this. Open it again in QoreX.";
  if (/execution reverted/i.test(log)) return "The contract refused it. Nothing moved except the network fee.";
  return `The chain refused it: ${log.slice(0, 160)}`;
}
