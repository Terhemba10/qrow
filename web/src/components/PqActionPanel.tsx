import type { ReactNode } from "react";
import { BaseError, ContractFunctionRevertedError, encodeFunctionData, type Abi, type Address, type Hex } from "viem";
import { usePublicClient } from "wagmi";
import { CHAIN, REFUND_TEXT } from "../config/network";
import { tokenByAddress } from "../config/tokens";
import { signPqAction } from "../lib/pqAction";
import { XvmError } from "../lib/xvm";
import { ActionFlow, type ReceiptDraft } from "./ActionFlow";

export interface PqCall {
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}

const FRIENDLY: Record<string, string> = {
  BadPqSignature: "The quantum-safe signature didn’t verify. Try again.",
  SignatureExpired: "The quantum-safe signature expired. Try again.",
  NoPqKey: "This device isn’t set up for this account yet. Try again: it sets up in the same approval.",
  NotRecipient: "Only the recipient can claim this payment.",
  NotSender: "Only the sender can do this.",
  NotPending: "This payment is no longer pending.",
  Expired: `The ${REFUND_TEXT} are over. It can only be refunded now.`,
  NotExpired: `The ${REFUND_TEXT} aren’t over yet.`,
  WrongMode: "This payment uses the other release mode.",
  TransferFailed: "The transfer failed.",
  BadPqSignatureForDevice: "This device’s key didn’t verify. Try again.",
  OverPaymentLimit: "This is above your limit per payment.",
  OverDailyLimit: "This is above your daily limit.",
  InvalidRecipient: "The recipient address isn’t allowed.",
  NonStandardToken: "This token doesn’t transfer exact amounts, so the escrow refuses it.",
};

export function explainError(e: unknown): string {
  if (e instanceof XvmError) return e.message;
  if (e instanceof BaseError) {
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError && rev.data?.errorName) return FRIENDLY[rev.data.errorName] ?? `The contract refused it (${rev.data.errorName}).`;
    return e.shortMessage;
  }
  if (e instanceof DOMException && e.name === "NotAllowedError") return "You cancelled the passkey prompt. Nothing was signed.";
  return e instanceof Error ? e.message : "Something went wrong.";
}

/**
 * One quantum-safe contract action, with one confirm screen and one QoreX approval (see
 * lib/action.ts). With `pq` unset (e.g. refundExpired, which anyone may call) there's no device
 * signature and no device key is needed.
 */
export function PqActionPanel(props: {
  sender: Address;
  title: string;
  summary: ReactNode;
  contract: Address;
  pq?: { actionName: string; paramsHash: Hex };
  /** An ERC-20 the contract will pull: approved for exactly this amount first, in the same flow. */
  approve?: { token: Address; amount: bigint; label: string };
  build: (auth?: { validUntil: bigint; signature: Hex }) => PqCall;
  /** Kept for callers; the simulation now runs silently just before sending. */
  describeSimulation?: (result: unknown) => string;
  confirmLabel: string;
  details?: { name: string; value: string }[];
  receipt?: (txHash: string) => ReceiptDraft;
  onDone: (txHash: string) => void;
  onCancel: () => void;
}) {
  const client = usePublicClient({ chainId: CHAIN.id })!;
  const tok = props.approve ? tokenByAddress(props.approve.token) : undefined;
  return (
    <div className="stack">
      <div>{props.summary}</div>
      <ActionFlow
        title={props.title}
        details={props.details ?? []}
        confirmLabel={props.confirmLabel}
        onCancel={props.onCancel}
        onDone={props.onDone}
        receipt={props.receipt ?? (() => ({ kind: props.title, title: `${props.title}: done`, lines: [] }))}
        plan={{
          user: props.sender,
          contract: props.contract,
          needsKey: !!props.pq,
          approve: props.approve ? { token: props.approve.token, amount: props.approve.amount, symbol: tok?.symbol ?? props.approve.label, decimals: tok?.decimals ?? 18 } : undefined,
          build: async ({ key, sign }) => {
            let auth: { validUntil: bigint; signature: Hex } | undefined;
            if (props.pq) {
              const s = await signPqAction(client, key, props.contract, props.pq.actionName, props.sender, props.pq.paramsHash);
              auth = { validUntil: s.validUntil, signature: sign(s.signature) };
            }
            const call = props.build(auth);
            if (call.value) throw new XvmError("QOR can’t be attached yet; use fUSD for this. QOR payments come with the next contract update.");
            return { to: props.contract, data: encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args }) };
          },
        }}
      />
    </div>
  );
}
