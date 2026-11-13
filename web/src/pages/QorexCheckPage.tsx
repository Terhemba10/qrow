import { msg, qorToEvm } from "@qorechain/sdk";
import { useState } from "react";
import { encodeFunctionData, erc20Abi, toBytes, type Address } from "viem";
import { ESCROW, REST } from "../config/network";
import { CONVERT_GAS, toErc20Msg } from "../lib/convert";
import { qorexAccount, qorexAvailable, signInQorex } from "../lib/staking";

const FUSD: Address = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";
const FUSD_DENOM = `erc20:${FUSD}`;

/**
 * Dev-only research page (not in the public build). Three harmless tests of what QoreX will sign:
 * 1. MsgCrossVMCall: fUSD.approve(escrow, 0) (how every Qrow contract action is sent)
 * 2. Native AMM swap: 0.01 QOR → fUSD on pool 2 (Swap tab)
 * 3. MsgConvertCoin: your bank fUSD → ERC-20 (the Convert helper), only if you hold bank fUSD
 * Each costs a small testnet fee and nothing else.
 */
export function QorexCheckPage() {
  const [log, setLog] = useState<string[]>([]);
  const add = (s: string) => setLog((l) => [...l, s]);

  async function account(): Promise<string | undefined> {
    if (!qorexAvailable()) return void add("QoreX isn't available in this browser (or it can't signAndBroadcast).");
    const me = await qorexAccount();
    if (!me) return void add("QoreX didn't share an account.");
    add(`QoreX account: ${me}`);
    return me;
  }
  const attempt = async (label: string, fn: () => Promise<{ txHash: string; code: number }>) => {
    add(`${label}: asking QoreX…`);
    try {
      const r = await fn();
      add(`${label}: SIGNED, tx ${r.txHash} (code ${r.code})`);
    } catch (e) {
      add(`${label}: FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  async function crossVm() {
    const me = await account();
    if (!me) return;
    const payload = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ESCROW, 0n] });
    await attempt("1. MsgCrossVMCall", () => signInQorex([msg.crossvm.crossVmCall({ sender: me, sourceVm: "cosmwasm", targetVm: "evm", targetContract: FUSD, payload: toBytes(payload), async: false })], undefined, 400_000));
  }

  async function swap() {
    const me = await account();
    if (!me) return;
    const pool = ((await fetch(`${REST}/qorechain/amm/v1/pools/2`).then((r) => r.json())) as { pool: { token_a: string; reserve_a: string; reserve_b: string } }).pool;
    const inAmt = 10_000n; // 0.01 QOR
    const [rIn, rOut] = pool.token_a === FUSD_DENOM ? [BigInt(pool.reserve_b), BigInt(pool.reserve_a)] : [BigInt(pool.reserve_a), BigInt(pool.reserve_b)];
    const after = (inAmt * 9_970n) / 10_000n;
    const minOut = ((rOut * after) / (rIn + after) * 95n) / 100n;
    add(`2. quote: 0.01 QOR → about ${(Number((rOut * after) / (rIn + after)) / 1e6).toFixed(6)} fUSD`);
    await attempt("2. AMM swap", () => signInQorex([msg.amm.swapExactIn({ sender: me, poolId: "2", tokenIn: { denom: "uqor", amount: inAmt.toString() }, denomOut: FUSD_DENOM, minOut: minOut.toString() })], undefined, 400_000));
  }

  async function convert() {
    const me = await account();
    if (!me) return;
    const bal = ((await fetch(`${REST}/cosmos/bank/v1beta1/balances/${me}`).then((r) => r.json())) as { balances: { denom: string; amount: string }[] }).balances;
    const have = BigInt(bal.find((b) => b.denom === FUSD_DENOM)?.amount ?? "0");
    if (have === 0n) return void add("3. You hold no bank fUSD yet: run test 2 first, or claim from the faucet.");
    await attempt(`3. MsgConvertCoin (${Number(have) / 1e6} fUSD)`, () => signInQorex([toErc20Msg(me, qorToEvm(me) as Address, FUSD, have)], undefined, CONVERT_GAS));
  }

  return (
    <section className="sheet stack" aria-labelledby="qc-title">
      <h1 id="qc-title">QoreX check (dev only)</h1>
      <p className="muted">Three harmless tests of what QoreX will sign for Qrow. Each costs a small testnet fee and changes nothing else. Run them in order and send Claude the log.</p>
      <div className="row">
        <button className="btn" type="button" onClick={() => void crossVm()}>
          1. Contract call
        </button>
        <button className="btn" type="button" onClick={() => void swap()}>
          2. Swap 0.01 QOR
        </button>
        <button className="btn" type="button" onClick={() => void convert()}>
          3. Convert fUSD
        </button>
      </div>
      <pre className="cmd mono" aria-live="polite">{log.join("\n") || "Not run yet."}</pre>
    </section>
  );
}
