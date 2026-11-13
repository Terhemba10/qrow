/**
 * Native-lane transactions signed by this browser's device account (hybrid secp256k1 + ML-DSA-87,
 * or classical only for its one-time key registration). Broadcast through Qrow's relay, which
 * forwards the signed bytes and never signs (QoreChain's endpoints send no CORS headers).
 */
import { EthNativeSigner, type UnifiedAccount } from "@qorechain/sdk";
import type { Registry } from "@cosmjs/proto-signing";
import { BROADCAST_URL, NATIVE_CHAIN_ID, REST } from "../config/network";
import { registry as qrowRegistry } from "./staking";
import { waitForNativeTx, XvmError } from "./xvm";

type Messages = Parameters<EthNativeSigner["sign"]>[0]["messages"];

async function sequenceOf(address: string): Promise<{ accountNumber: number; sequence: number }> {
  const r = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${address}`);
  if (r.status === 404) throw new XvmError("This device’s account isn’t on chain yet: it needs its first QOR from QoreX.");
  if (!r.ok) throw new XvmError(`Couldn’t read the device account (HTTP ${r.status}).`);
  const j = (await r.json()) as { account: Record<string, unknown> };
  const a = ((j.account.base_account as Record<string, string> | undefined) ?? (j.account as Record<string, string>));
  return { accountNumber: Number(a.account_number ?? 0), sequence: Number(a.sequence ?? 0) };
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

/** Broadcaster for EthNativeSigner: POST through the relay, then wait for the block. */
const transport = {
  async broadcastTx(tx: Uint8Array) {
    const r = await fetch(BROADCAST_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx_bytes: b64(tx), mode: "BROADCAST_MODE_SYNC" }),
    });
    const j = (await r.json().catch(() => ({}))) as { tx_response?: { code: number; txhash: string; raw_log: string } };
    const t = j.tx_response;
    if (!t) throw new XvmError(`The network didn’t accept the transaction (HTTP ${r.status}).`);
    if (t.code !== 0) return { code: t.code, transactionHash: t.txhash, rawLog: t.raw_log };
    const done = await waitForNativeTx(t.txhash);
    return { code: 0, transactionHash: t.txhash, gasUsed: done.gasUsed ? BigInt(done.gasUsed) : undefined };
  },
};

/**
 * Sign with the device account and broadcast. Fee at the chain minimum (0.1 uqor per gas; the whole
 * limit is charged, so callers size `gas` from estimates).
 */
export async function deviceBroadcast(
  device: UnifiedAccount,
  messages: Messages,
  gas: number,
  mode: "hybrid" | "classical" = "hybrid",
): Promise<{ txHash: string }> {
  const { accountNumber, sequence } = await sequenceOf(device.cosmos);
  const signer = new EthNativeSigner(device, { signMode: mode, rest: REST, registry: qrowRegistry as unknown as Registry });
  const res = await signer.signAndBroadcast(transport, {
    chainId: NATIVE_CHAIN_ID,
    accountNumber,
    sequence,
    fee: { amount: [{ denom: "uqor", amount: String(Math.ceil(gas / 10)) }], gas: String(gas) },
    messages,
  });
  if (res.code !== 0) {
    const log = res.rawLog ?? "";
    if (/insufficient/i.test(log)) throw new XvmError("This device has run out of QOR for fees. Top it up from QoreX on the Start page.");
    if (/no open EVM authorisation window|does not admit/i.test(log)) throw new XvmError("Your EVM window closed or doesn’t cover this. Open it again in QoreX.");
    if (/authorization not found|grant/i.test(log)) throw new XvmError("This device’s permission from QoreX is missing or expired. Set up this device again.");
    throw new XvmError(`The chain refused it: ${log.slice(0, 180)}`);
  }
  return { txHash: res.transactionHash };
}

/** Balance of the device account in uqor (for the "top up" hint). */
export async function deviceQor(address: string): Promise<bigint> {
  const r = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${address}`);
  if (!r.ok) return 0n;
  const j = (await r.json()) as { balances: { denom: string; amount: string }[] };
  return BigInt(j.balances.find((b) => b.denom === "uqor")?.amount ?? "0");
}
