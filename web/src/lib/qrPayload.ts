/**
 * Qrow payment-request payload, version 1 (docs/PLAN.md, QR spec):
 *   qrow:pay?to=<0x>&amount=<decimal>&token=<symbol>&note=<text>&chain=<evm id>&v=1
 * Also accepted: a plain 0x or qor1 address (treated as the current network).
 * A parsed payload only FILLS the Send form; every check and the confirm screen still run.
 */
import { baseTokenBySymbol as tokenBySymbol, type BaseSymbol as TokenSymbol } from "../config/tokens";
import { parseRecipient } from "./address";
import { formatUnitsExact, parseAmount } from "./amount";

export const NOTE_LIMIT = 140;
const ALLOWED = new Set(["to", "amount", "token", "note", "chain", "v"]);
const NETWORK_NAMES: Record<string, string> = { "9800": "testnet", "9801": "mainnet" };

export interface PayRequest {
  to: `0x${string}`;
  toQor: string;
  /** Present only with a token. Exact base units. */
  amountUnits?: bigint;
  token?: TokenSymbol;
  note?: string;
  /** "qr" = qrow:pay payload, "address" = plain address code. */
  kind: "qr" | "address";
}

export type ParseError =
  | { code: "empty" }
  | { code: "scheme" }
  | { code: "version" }
  | { code: "duplicate"; field: string }
  | { code: "unknown_field"; field: string }
  | { code: "missing"; field: string }
  | { code: "network"; theirs: string; ours: string }
  | { code: "unknown_network"; chain: string }
  | { code: "address" }
  | { code: "token" }
  | { code: "token_required" }
  | { code: "amount"; reason: string }
  | { code: "note_encoding" }
  | { code: "note_length" };

export type ParseResult = { ok: true; request: PayRequest } | { ok: false; error: ParseError };

export function parsePayload(raw: string, currentChainId: number): ParseResult {
  const text = raw.trim();
  if (!text) return { ok: false, error: { code: "empty" } };

  // A plain address (QoreX Receive screen): current network, every check still runs.
  if (/^(0x[0-9a-fA-F]{40}|qor1[0-9a-zA-Z]{38})$/.test(text)) {
    const r = parseRecipient(text);
    return r.ok ? { ok: true, request: { to: r.evm, toQor: r.qor, kind: "address" } } : { ok: false, error: { code: "address" } };
  }

  if (!text.startsWith("qrow:pay?")) return { ok: false, error: { code: "scheme" } };
  const query = text.slice("qrow:pay?".length);
  const fields = new Map<string, string>();
  for (const part of query.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const k = eq === -1 ? part : part.slice(0, eq);
    const v = eq === -1 ? "" : part.slice(eq + 1);
    if (!ALLOWED.has(k)) return { ok: false, error: { code: "unknown_field", field: k } };
    if (fields.has(k)) return { ok: false, error: { code: "duplicate", field: k } };
    fields.set(k, v);
  }
  for (const f of ["to", "chain", "v"]) if (!fields.has(f)) return { ok: false, error: { code: "missing", field: f } };
  if (fields.get("v") !== "1") return { ok: false, error: { code: "version" } };

  const chain = fields.get("chain")!;
  if (!(chain in NETWORK_NAMES)) return { ok: false, error: { code: "unknown_network", chain } };
  if (chain !== String(currentChainId)) {
    return { ok: false, error: { code: "network", theirs: NETWORK_NAMES[chain], ours: NETWORK_NAMES[String(currentChainId)] ?? `chain ${currentChainId}` } };
  }

  const r = parseRecipient(safeDecode(fields.get("to")!) ?? "");
  if (!r.ok) return { ok: false, error: { code: "address" } };

  let token: TokenSymbol | undefined;
  if (fields.has("token")) {
    const t = tokenBySymbol(fields.get("token")!);
    if (!t) return { ok: false, error: { code: "token" } };
    token = t.symbol as TokenSymbol;
  }
  let amountUnits: bigint | undefined;
  if (fields.has("amount")) {
    if (!token) return { ok: false, error: { code: "token_required" } };
    const a = parseAmount(fields.get("amount")!, tokenBySymbol(token)!.decimals);
    if (!a.ok) return { ok: false, error: { code: "amount", reason: a.reason } };
    amountUnits = a.units;
  }
  let note: string | undefined;
  if (fields.has("note")) {
    const decoded = safeDecode(fields.get("note")!.replace(/\+/g, " "));
    if (decoded === undefined) return { ok: false, error: { code: "note_encoding" } };
    if ([...decoded].length > NOTE_LIMIT) return { ok: false, error: { code: "note_length" } };
    note = decoded;
  }
  return { ok: true, request: { to: r.evm, toQor: r.qor, amountUnits, token, note, kind: "qr" } };
}

function safeDecode(s: string): string | undefined {
  try {
    return decodeURIComponent(s);
  } catch {
    return undefined;
  }
}

/** Build a payload in the canonical field order. */
export function buildPayload(p: { to: string; token?: TokenSymbol; amountUnits?: bigint; note?: string; chainId: number }): string {
  const parts = [`to=${p.to}`];
  if (p.token && p.amountUnits !== undefined) parts.push(`amount=${formatUnitsExact(p.amountUnits, tokenBySymbol(p.token)!.decimals)}`);
  if (p.token) parts.push(`token=${p.token}`);
  if (p.note) parts.push(`note=${encodeURIComponent(p.note.slice(0, NOTE_LIMIT))}`);
  parts.push(`chain=${p.chainId}`, "v=1");
  return `qrow:pay?${parts.join("&")}`;
}

/** Plain-language reason for a rejected payload (shown next to the scanner or link). */
export function explainParseError(e: ParseError): string {
  switch (e.code) {
    case "empty":
      return "The code is empty.";
    case "scheme":
      return "This isn’t a Qrow payment request or a QoreChain address.";
    case "version":
      return "Unsupported QR version.";
    case "duplicate":
      return `The request has “${e.field}” twice, so Qrow won’t guess which one is right.`;
    case "unknown_field":
      return `The request has a field Qrow doesn’t know (“${e.field}”).`;
    case "missing":
      return `The request is missing “${e.field}”.`;
    case "network":
      return `This request is for ${e.theirs}, you’re on ${e.ours}. Qrow won’t switch networks for you.`;
    case "unknown_network":
      return `This request is for an unknown network (chain ${e.chain}).`;
    case "address":
      return "The address in the request isn’t valid.";
    case "token":
      return "The request asks for a token Qrow doesn’t support on this network.";
    case "token_required":
      return "The request has an amount but no token.";
    case "amount":
      return e.reason === "decimals" ? "The amount has more decimal places than the token allows." : "The amount isn’t a valid positive number.";
    case "note_encoding":
      return "The note in the request is badly encoded.";
    case "note_length":
      return `The note is longer than ${NOTE_LIMIT} characters.`;
  }
}
