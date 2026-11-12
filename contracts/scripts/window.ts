/**
 * window.ts — PQC key + EVM authorisation window for a Qrow account.
 *
 *   pnpm window status [--drill]
 *   pnpm window register [--drill]               register the ML-DSA-87 key (once, with proof of possession)
 *   pnpm window open --txs N [--targets 0xA,0xB] [--blocks B] [--value UQOR] [--drill]
 *   pnpm window close [--drill]                  revoke the window immediately
 *   pnpm window recovery-code                    print a fresh QRC1 recovery code
 *
 * Qrow's rule: open the SMALLEST window that does the job (exact tx count, few blocks, only the
 * escrow and the token as targets), and close it straight after. A leaked ECDSA key then finds
 * no window to ride on. `--drill` uses the DRILL_ env prefix.
 */
import {
  buildRegisterPqcKeyMsg,
  closeEvmWindowMsg,
  fetchPqcStatus,
  generatePqcRecoveryCode,
  isRegisteredPqcKey,
  openEvmWindowMsg,
  signProofOfPossession,
} from "@qorechain/sdk";
import { evmWindowCost, evmWindowStatus } from "@qorechain/evm";
import { broadcastNative, loadAccount, network } from "./lib.js";

const args = process.argv.slice(3);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const prefix = args.includes("--drill") ? "DRILL_" : "";

async function status() {
  const net = network();
  const acc = await loadAccount(prefix);
  console.log(`account:  ${acc.evm}  (${acc.cosmos})`);
  const pqc = await fetchPqcStatus({ rest: net.rest, address: acc.cosmos });
  const mine = pqc.registered ? isRegisteredPqcKey(pqc, acc.pqc.publicKey) : false;
  console.log(
    `PQC key:  ${pqc.registered ? (mine === false ? "registered, but NOT this key" : "registered") : "not registered"}`,
  );
  const w = await evmWindowStatus({ rest: net.rest, address: acc.cosmos });
  console.log(
    w.found
      ? `window:   ${w.live ? "LIVE" : "not usable"}; ${w.remainingBlocks} blocks, ${w.remainingTxs} txs, ${w.remainingValue} uqor left`
      : "window:   none (good: nothing for a leaked ECDSA key to use)",
  );
}

async function register() {
  const net = network();
  const acc = await loadAccount(prefix);
  const pqc = await fetchPqcStatus({ rest: net.rest, address: acc.cosmos });
  if (pqc.registered) return console.log("The account already has a PQC key; nothing to do.");
  const proofOfPossession = signProofOfPossession({ chainId: net.chainId, account: acc.cosmos, keypair: acc.pqc });
  const msg = buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession });
  console.log(`registered: ${await broadcastNative(acc, "classical", [msg])}`);
}

async function open() {
  const acc = await loadAccount(prefix);
  const maxTxs = BigInt(flag("txs") ?? "1");
  const blocks = BigInt(flag("blocks") ?? "120");
  const targets = flag("targets")?.split(",").map((s) => s.trim()).filter(Boolean);
  const perTx = evmWindowCost({ gas: 3_000_000n, maxFeePerGas: 250_000_000_000n });
  const maxValue = BigInt(flag("value") ?? (perTx * maxTxs).toString());
  const msg = openEvmWindowMsg({
    sender: acc.cosmos,
    blocks,
    maxTxs,
    maxValue,
    ...(targets?.length ? { allowedTargets: targets } : {}),
  });
  console.log(`opened: ${await broadcastNative(acc, "hybrid", [msg])}`);
  console.log(`window: ${blocks} blocks, ${maxTxs} txs, ${maxValue} uqor, targets: ${targets?.join(", ") ?? "any"}`);
  console.log("Opening advanced the account's nonce. Send the EVM tx(s) now, then `pnpm window close`.");
}

async function close() {
  const acc = await loadAccount(prefix);
  console.log(`closed: ${await broadcastNative(acc, "hybrid", [closeEvmWindowMsg(acc.cosmos)])}`);
}

async function recoveryCode() {
  console.log(generatePqcRecoveryCode());
  console.log("Put it in .env as QORE_PQC_RECOVERY_CODE and keep a copy apart from PRIVATE_KEY.");
}

const commands: Record<string, () => Promise<void>> = { status, register, open, close, "recovery-code": recoveryCode };
const run = commands[process.argv[2] ?? "status"];
if (!run) {
  console.error("Use: status | register | open | close | recovery-code");
  process.exit(1);
}
run().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
