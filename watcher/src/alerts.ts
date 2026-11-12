/**
 * Alert rules: turn escrow events and the clock into messages for the sender and the receiver.
 * Pure functions (no I/O) so they are unit-tested. Plain text only: nothing from the chain is
 * ever interpreted as markup.
 */
export const ESCROW = "0xe51f1a2d28661bead6b0a75d3e4e2b3edff766da";
export const EXPLORER = "https://explore.qore.network";

export type Role = "sender" | "receiver";
export type Kind =
  | "created" // sender: sent to escrow / receiver: payment waiting
  | "notified" // sender: recipient got the encrypted notice
  | "claimed"
  | "released"
  | "cancelled"
  | "refunded"
  | "reminder_day5" // sender: still unclaimed after 5 days
  | "expiry_24h" // receiver: 24 h left to claim
  | "refund_overdue" // sender: deadline passed and still not refunded
  | "failure"; // sender: a transaction to the escrow failed

export interface PaymentInfo {
  id: bigint;
  sender: string;
  recipient: string;
  amount: string; // display string, e.g. "0.5 QOR"
  deadline: number; // unix seconds
}

export interface Alert {
  key: string; // idempotency key: one alert per (kind, payment, role, tx)
  to: string; // address the alert is for
  role: Role;
  kind: Kind;
  text: string;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const when = (s: number) => new Date(s * 1000).toUTCString().replace(" GMT", " UTC");

export function footer(txHash: string | undefined, cosmosHash: string | undefined): string {
  const lines = [`Escrow: ${ESCROW}`];
  if (txHash) lines.push(`Tx: ${txHash}`);
  lines.push(cosmosHash ? `Explorer: ${EXPLORER}/tx/${cosmosHash} (switch the explorer to Testnet)` : `Explorer: ${EXPLORER}/address/${ESCROW} (switch the explorer to Testnet)`);
  lines.push("Testnet: these tokens have no value.");
  return lines.join("\n");
}

export function eventAlerts(kind: Kind, p: PaymentInfo, txHash: string, cosmosHash?: string, reason?: string): Alert[] {
  const f = footer(txHash, cosmosHash);
  const id = `#${p.id}`;
  const a = (to: string, role: Role, text: string): Alert => ({ key: `${kind}:${p.id}:${role}:${txHash}`, to, role, kind, text: `${text}\n\n${f}` });
  switch (kind) {
    case "created":
      return [
        a(p.sender, "sender", `Qrow: you sent ${p.amount} to escrow for ${short(p.recipient)} (payment ${id}). Refundable to you after ${when(p.deadline)} if it isn't claimed.`),
        a(p.recipient, "receiver", `Qrow: ${p.amount} is waiting for you from ${short(p.sender)} (payment ${id}). Claim it before ${when(p.deadline)}.`),
      ];
    case "notified":
      return [a(p.sender, "sender", `Qrow: the recipient of payment ${id} was sent an encrypted notice (QoreSeal, ML-KEM-1024).`)];
    case "claimed":
      return [
        a(p.sender, "sender", `Qrow: ${short(p.recipient)} claimed payment ${id} (${p.amount}).`),
        a(p.recipient, "receiver", `Qrow: you claimed payment ${id} (${p.amount}).`),
      ];
    case "released":
      return [
        a(p.sender, "sender", `Qrow: you released payment ${id} (${p.amount}) to ${short(p.recipient)}.`),
        a(p.recipient, "receiver", `Qrow: ${short(p.sender)} released payment ${id} (${p.amount}) to you.`),
      ];
    case "cancelled":
      return [
        a(p.sender, "sender", `Qrow: you cancelled payment ${id}. ${p.amount} is back in your wallet.`),
        a(p.recipient, "receiver", `Qrow: ${short(p.sender)} cancelled payment ${id} (${p.amount}) before it was claimed.`),
      ];
    case "refunded":
      return [
        a(p.sender, "sender", `Qrow: payment ${id} wasn't claimed in 7 days, so ${p.amount} was refunded to you.`),
        a(p.recipient, "receiver", `Qrow: payment ${id} (${p.amount}) expired unclaimed and went back to ${short(p.sender)}.`),
      ];
    case "failure":
      return [a(p.sender, "sender", `Qrow: a transaction for payment ${id} failed${reason ? `: ${reason}` : ""}. Nothing moved except the network fee.`)];
    default:
      return [];
  }
}

/** Time-based alerts for a still-pending payment. Each fires once (idempotency key without tx). */
export function clockAlerts(p: PaymentInfo, createdAt: number, now: number): Alert[] {
  const out: Alert[] = [];
  const f = footer(undefined, undefined);
  const id = `#${p.id}`;
  if (now >= createdAt + 5 * 86_400 && now < p.deadline) {
    out.push({ key: `reminder_day5:${p.id}`, to: p.sender, role: "sender", kind: "reminder_day5", text: `Qrow reminder: payment ${id} (${p.amount}) to ${short(p.recipient)} is still unclaimed after 5 days. It becomes refundable at ${when(p.deadline)}.\n\n${f}` });
  }
  if (now >= p.deadline - 86_400 && now < p.deadline) {
    out.push({ key: `expiry_24h:${p.id}`, to: p.recipient, role: "receiver", kind: "expiry_24h", text: `Qrow: less than 24 hours left to claim payment ${id} (${p.amount}) from ${short(p.sender)}. Deadline: ${when(p.deadline)}.\n\n${f}` });
  }
  if (now >= p.deadline + 3_600) {
    out.push({ key: `refund_overdue:${p.id}`, to: p.sender, role: "sender", kind: "refund_overdue", text: `Qrow: payment ${id} (${p.amount}) expired over an hour ago and hasn't been refunded yet. Anyone can trigger the refund. In Qrow: Send > Your sent payments > Refund to sender.\n\n${f}` });
  }
  return out;
}
