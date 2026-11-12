import { msg } from "@qorechain/sdk";
import { useState } from "react";
import { encodeFunctionData, erc20Abi, toBytes } from "viem";
import { ESCROW } from "../config/network";
import { qorexAccount, qorexAvailable, signInQorex } from "../lib/staking";

const FUSD = "0x97143B771D34ddb9130b807b135Ae675A5a963CA";

/**
 * Dev-only research page (not in the public build): can QoreX sign a native-lane MsgCrossVMCall
 * that calls an EVM contract as the user's own address? Harmless test: fUSD.approve(escrow, 0),
 * i.e. "allow the escrow to take 0 fUSD". Costs a small QOR fee and changes nothing else.
 */
export function QorexCheckPage() {
  const [log, setLog] = useState<string[]>([]);
  const add = (s: string) => setLog((l) => [...l, s]);

  async function run() {
    setLog([]);
    try {
      if (!qorexAvailable()) return add("QoreX isn't available in this browser (or it can't signAndBroadcast).");
      const me = await qorexAccount();
      if (!me) return add("QoreX didn't share an account.");
      add(`QoreX account: ${me}`);
      const payload = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ESCROW, 0n] });
      const m = msg.crossvm.crossVmCall({ sender: me, sourceVm: "cosmwasm", targetVm: "evm", targetContract: FUSD, payload: toBytes(payload), async: false });
      add(`Asking QoreX to sign ${m.typeUrl} (fUSD.approve(escrow, 0))…`);
      const r = await signInQorex([m]);
      add(`Success: tx ${r.txHash} (code ${r.code}). QoreX can sign EVM contract calls through the cross-VM message.`);
    } catch (e) {
      add(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <section className="sheet stack" aria-labelledby="qc-title">
      <h1 id="qc-title">QoreX check (dev only)</h1>
      <p className="muted">Asks QoreX to sign one harmless cross-VM call: allow Qrow’s escrow to take 0 fUSD from your account. It costs a small testnet fee and changes nothing else.</p>
      <button className="btn" type="button" onClick={() => void run()}>
        Run the QoreX check
      </button>
      <pre className="cmd mono" aria-live="polite">{log.join("\n") || "Not run yet."}</pre>
    </section>
  );
}
