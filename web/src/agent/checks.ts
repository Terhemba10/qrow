/**
 * The checking agent: deterministic, read-only checks that run before every send.
 * It never signs or sends anything, and no warning here depends on AI.
 * Every check runs in parallel and logs its own timing.
 */
import { erc20Abi, type Address, type PublicClient } from "viem";
import { evmToQor } from "@qorechain/sdk";
import { qrowEscrowAbi } from "../abi/QrowEscrow";
import { ESCROW, REFUND_TEXT, REST } from "../config/network";
import { tokenAddress, tokenBySymbol, type Token } from "../config/tokens";
import { displayAmount } from "../lib/amount";
import type { PaymentDraft } from "../lib/draft";
import { validateAddress } from "../vendor/custody-kit/address";
import { findLookalikes, type LookalikeHit } from "./lookalike";
import { pastRecipients } from "./recipients";

export type Level = "ok" | "info" | "warn" | "danger" | "block";

export interface CheckResult {
  id: CheckId;
  level: Level;
  title: string;
  detail?: string;
  ms: number;
  /** Extra data for the confirm screen. */
  lookalike?: LookalikeHit[];
}

export type CheckId =
  | "address"
  | "self"
  | "lookalike"
  | "newRecipient"
  | "pqKey"
  | "recipientKind"
  | "recipientHistory"
  | "balance"
  | "fees"
  | "limits";

export interface AgentRun {
  results: CheckResult[];
  totalMs: number;
  startedAt: number;
}

/** Any check that fails to run is never treated as passed. */
const unknown = (id: CheckId, title: string, e: unknown, ms: number): CheckResult => ({
  id,
  level: "warn",
  title,
  detail: `This check couldn’t run (${e instanceof Error ? e.message : "network error"}). Check the details yourself before you send.`,
  ms,
});

async function timed(id: CheckId, failTitle: string, fn: () => Promise<Omit<CheckResult, "id" | "ms">>): Promise<CheckResult> {
  const t0 = performance.now();
  try {
    const r = await fn();
    return { id, ms: Math.round(performance.now() - t0), ...r };
  } catch (e) {
    return unknown(id, failTitle, e, Math.round(performance.now() - t0));
  }
}

async function restJson<T>(path: string): Promise<T | undefined> {
  const res = await fetch(`${REST}${path}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function runChecks(client: PublicClient, sender: Address, draft: PaymentDraft): Promise<AgentRun> {
  const startedAt = Date.now();
  const t0 = performance.now();
  const token = tokenBySymbol(draft.token) as Token;
  const amount = BigInt(draft.amountUnits);
  const to = draft.recipient;
  const toQor = evmToQor(to);

  // Shared reads, started once and awaited by the checks that need them.
  const pastP = pastRecipients(client, sender);

  const checks: Promise<CheckResult>[] = [
    timed("address", "Couldn’t validate the address", async () => {
      const v = validateAddress(to);
      if (!v.valid) return { level: "block", title: "This isn’t a valid QoreChain address", detail: v.detail };
      return { level: "ok", title: "The address is valid", detail: `${v.hex} is the same account as ${v.bech32}.` };
    }),

    timed("self", "Couldn’t compare with your address", async () =>
      to.toLowerCase() === sender.toLowerCase()
        ? { level: "block", title: "This is your own address" }
        : { level: "ok", title: "Not your own address" },
    ),

    timed("lookalike", "Couldn’t compare with your past recipients", async () => {
      const hits = findLookalikes(to, (await pastP).keys());
      if (hits.length === 0) return { level: "ok", title: "No lookalike of a past recipient" };
      return {
        level: "danger",
        title: "Possible scam: this address imitates someone you’ve paid",
        detail:
          "It starts and ends like an address you’ve paid before, but the middle is different. Scammers send tiny payments from lookalike addresses so you copy the wrong one from your history. Check the full address with the recipient another way before you send.",
        lookalike: hits,
      };
    }),

    timed("newRecipient", "Couldn’t read your past payments", async () => {
      const past = await pastP;
      return past.has(to.toLowerCase())
        ? { level: "ok", title: "You’ve paid this address before" }
        : {
            level: "warn",
            title: "You’ve never paid this address",
            detail: "Make sure you got it from the recipient directly, not from a message or your transaction history.",
          };
    }),

    timed("pqKey", "Couldn’t read the recipient’s quantum-safe key", async () => {
      const has = await client.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "hasPqKey", args: [to] });
      if (draft.freelancer) {
        return has
          ? { level: "ok", title: "The recipient has a quantum-safe key" }
          : { level: "info", title: "The recipient has no quantum-safe key yet", detail: "That’s fine in this mode: you release the money, so they don’t need to claim it." };
      }
      return has
        ? { level: "ok", title: "The recipient can claim it", detail: "They have a registered ML-DSA-87 (quantum-safe) key." }
        : {
            level: "warn",
            title: "The recipient can’t claim it yet",
            detail: `They must set up a quantum-safe (ML-DSA-87) key in QoreX first. If they don’t claim it within ${REFUND_TEXT}, it comes back to you.`,
          };
    }),

    timed("recipientKind", "Couldn’t check what kind of address this is", async () => {
      const code = await client.getCode({ address: to });
      return code && code !== "0x"
        ? {
            level: "warn",
            title: "This address is a smart contract, not a personal wallet",
            detail: "A contract can only claim if it was built to. Send to a contract only if you know it handles Qrow payments.",
          }
        : { level: "ok", title: "It’s a personal wallet address" };
    }),

    timed("recipientHistory", "Couldn’t read the recipient’s history", async () => {
      const acc = await restJson<{ account?: { sequence?: string; base_account?: { sequence?: string } } }>(
        `/cosmos/auth/v1beta1/accounts/${toQor}`,
      );
      if (!acc) {
        return {
          level: "warn",
          title: "This address has never been used",
          detail: "It has no balance and no transactions on QoreChain testnet. That’s normal for a brand-new wallet, but it’s also how a mistyped address looks.",
        };
      }
      const seq = Number(acc.account?.sequence ?? acc.account?.base_account?.sequence ?? 0);
      const first = await restJson<{ tx_responses?: { timestamp: string }[] }>(
        `/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(`message.sender='${toQor}'`)}&order_by=ORDER_BY_ASC&pagination.limit=1`,
      ).catch(() => undefined);
      const ts = first?.tx_responses?.[0]?.timestamp;
      const age = ts ? Math.max(0, Math.floor((Date.now() - Date.parse(ts)) / 86_400_000)) : undefined;
      const since = age === undefined ? "" : age === 0 ? " Its first transaction was today." : ` Its first transaction was ${age} day${age === 1 ? "" : "s"} ago.`;
      return seq === 0
        ? { level: "info", title: "This wallet has received funds but never sent a transaction", detail: since.trim() || undefined }
        : { level: "ok", title: `This wallet has sent ${seq} transaction${seq === 1 ? "" : "s"}`, detail: since.trim() || undefined };
    }),

    timed("balance", "Couldn’t read your balance", async () => {
      const bal = token.address
        ? await client.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [sender] })
        : await client.getBalance({ address: sender });
      return bal >= amount
        ? { level: "ok", title: "You have enough", detail: `Balance ${displayAmount(bal, token.decimals)} ${token.symbol}.` }
        : {
            level: "block",
            title: `Not enough ${token.symbol}`,
            detail: `You have ${displayAmount(bal, token.decimals)} ${token.symbol} available to the escrow and this payment needs ${displayAmount(amount, token.decimals)}.`,
          };
    }),

    timed("fees", "Couldn’t check your QOR for fees", async () => {
      const qor = await client.getBalance({ address: sender });
      const needed = (token.address ? 0n : amount) + 10n ** 18n; // keep about 1 QOR for fees
      return qor >= needed
        ? { level: "ok", title: "You have QOR for the network fee" }
        : { level: "warn", title: "You may not have enough QOR for the fee", detail: "Keep about 1 QOR for network fees; payments with ML-DSA signatures use more gas than a plain transfer." };
    }),

    timed("limits", "Couldn’t read your sending limits", async () => {
      const ta = tokenAddress(token);
      const [limits, spent] = await Promise.all([
        client.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "limitsOf", args: [sender, ta] }),
        client.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "spentToday", args: [sender, ta] }),
      ]);
      const { maxPerPayment, maxPerDay } = limits;
      if (maxPerPayment !== 0n && amount > maxPerPayment) {
        return { level: "block", title: "Above your limit per payment", detail: `Your limit is ${displayAmount(maxPerPayment, token.decimals)} ${token.symbol} per payment. Change it in Settings if you meant this.` };
      }
      if (maxPerDay !== 0n && spent + amount > maxPerDay) {
        const left = maxPerDay > spent ? maxPerDay - spent : 0n;
        return { level: "block", title: "Above your daily limit", detail: `You can send ${displayAmount(left, token.decimals)} more ${token.symbol} today.` };
      }
      return maxPerPayment === 0n && maxPerDay === 0n
        ? { level: "info", title: "You haven’t set sending limits", detail: "Limits stop a large payment going out by mistake. Set them in Settings." }
        : { level: "ok", title: "Within your limits" };
    }),
  ];

  const results = await Promise.all(checks);
  const run: AgentRun = { results, totalMs: Math.round(performance.now() - t0), startedAt };
  logRun(run);
  return run;
}

/** Performance log: per-check timing for the README and the demo (window.qrowAgentLog). */
function logRun(run: AgentRun) {
  const w = window as unknown as { qrowAgentLog?: AgentRun[] };
  (w.qrowAgentLog ??= []).push(run);
  console.info(
    `[qrow agent] ${run.results.length} checks in ${run.totalMs} ms`,
    Object.fromEntries(run.results.map((r) => [r.id, `${r.level} ${r.ms}ms`])),
  );
}

export const worst = (rs: CheckResult[]): Level =>
  (["block", "danger", "warn", "info", "ok"] as Level[]).find((l) => rs.some((r) => r.level === l)) ?? "ok";
