/**
 * AI tab: pay with test QOR, spend credits on chat, images and videos. Keys stay on the server (env vars).
 *
 * Credits without a login and without trusting the client:
 *   - The browser makes a random 32-byte credit key and keeps it. Its public id is sha256(key) (hex, 64).
 *   - Top-up: the user sends test QOR to Qrow's AI treasury in QoreX (a plain MsgSend, which QoreX signs),
 *     with memo "qrow-ai:<first 32 hex of the id>". The server reads that transaction from the chain, checks
 *     it succeeded, the recipient, the amount and the memo, refuses a hash it has seen, and credits the id.
 *     Someone who sees the transaction can't claim it: they don't know the key behind the memo.
 *   - Spending sends the key; the server hashes it and debits that id, refunding when the provider fails.
 * Balances live in Upstash Redis / Vercel KV when configured, otherwise in memory (lost on cold start; the
 * page says so).
 */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";

export const PRICES_UQOR = { chat: 500_000n, image: 3_000_000n, video: 15_000_000n } as const;
export type Op = keyof typeof PRICES_UQOR;
export const CHAT_MODEL = "claude-haiku-5-5";
const REST = process.env.QORE_REST_URL?.trim() || "https://api-testnet.qore.host";
const REPLICATE = "https://api.replicate.com/v1";

// ------------------------------------------------------------------ credit keys

export const idOf = (key: string) => createHash("sha256").update(key).digest("hex");
export const memoFor = (id: string) => `qrow-ai:${id.slice(0, 32)}`;
export const validKey = (k: unknown): k is string => typeof k === "string" && /^[0-9a-f]{64}$/.test(k);

// ------------------------------------------------------------------ store

export interface Store {
  get(key: string): Promise<bigint>;
  incrBy(key: string, n: bigint): Promise<bigint>;
  /** Set once; false if it already existed. */
  setOnce(key: string, value: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  persistent: boolean;
}

export function memoryStore(): Store {
  const m = new Map<string, string>();
  return {
    persistent: false,
    async get(k) {
      return BigInt(m.get(k) ?? "0");
    },
    async incrBy(k, n) {
      const v = BigInt(m.get(k) ?? "0") + n;
      m.set(k, v.toString());
      return v;
    },
    async setOnce(k, v) {
      if (m.has(k)) return false;
      m.set(k, v);
      return true;
    },
    async has(k) {
      return m.has(k);
    },
  };
}

/** Upstash Redis REST (also what Vercel KV exposes as KV_REST_API_URL / KV_REST_API_TOKEN). */
export function redisStore(url: string, token: string, fetchImpl: typeof fetch = fetch): Store {
  const cmd = async (...args: string[]) => {
    const r = await fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(args) });
    if (!r.ok) throw new Error(`redis_${r.status}`);
    return ((await r.json()) as { result: unknown }).result;
  };
  return {
    persistent: true,
    async get(k) {
      return BigInt(((await cmd("GET", k)) as string | null) ?? "0");
    },
    async incrBy(k, n) {
      return BigInt((await cmd("INCRBY", k, n.toString())) as number);
    },
    async setOnce(k, v) {
      return (await cmd("SET", k, v, "NX")) === "OK";
    },
    async has(k) {
      return Number(await cmd("EXISTS", k)) > 0;
    },
  };
}

let store: Store | undefined;
export function getStore(): Store {
  if (store) return store;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  store = url && token ? redisStore(url, token) : memoryStore();
  return store;
}

const balKey = (id: string) => `qrow:ai:bal:${id}`;

export const balanceOf = (s: Store, id: string) => s.get(balKey(id));

/** Debit if the balance covers it (refunds the debit if it went below zero). */
export async function debit(s: Store, id: string, n: bigint): Promise<boolean> {
  const after = await s.incrBy(balKey(id), -n);
  if (after < 0n) {
    await s.incrBy(balKey(id), n);
    return false;
  }
  return true;
}
export const refund = (s: Store, id: string, n: bigint) => s.incrBy(balKey(id), n);

// ------------------------------------------------------------------ top-up check

interface TxJson {
  tx_response?: { code: number; txhash: string };
  tx?: { body?: { memo?: string; messages?: { "@type": string; from_address?: string; to_address?: string; amount?: { denom: string; amount: string }[] }[] } };
}

export async function verifyTopUp(
  hash: string,
  id: string,
  treasury: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; uqor: bigint; from: string } | { ok: false; reason: string }> {
  if (!/^[0-9A-Fa-f]{64}$/.test(hash)) return { ok: false, reason: "bad_hash" };
  const r = await fetchImpl(`${REST}/cosmos/tx/v1beta1/txs/${hash.toUpperCase()}`);
  if (r.status === 404 || r.status === 400) return { ok: false, reason: "not_found_yet" };
  if (!r.ok) return { ok: false, reason: "chain_unavailable" };
  const j = (await r.json()) as TxJson;
  if (!j.tx_response) return { ok: false, reason: "not_found_yet" };
  if (j.tx_response.code !== 0) return { ok: false, reason: "tx_failed" };
  if ((j.tx?.body?.memo ?? "").trim() !== memoFor(id)) return { ok: false, reason: "wrong_memo" };
  let uqor = 0n;
  let from = "";
  for (const m of j.tx?.body?.messages ?? []) {
    if (m["@type"] !== "/cosmos.bank.v1beta1.MsgSend" || m.to_address !== treasury) continue;
    from = m.from_address ?? "";
    for (const c of m.amount ?? []) if (c.denom === "uqor") uqor += BigInt(c.amount);
  }
  if (uqor === 0n) return { ok: false, reason: "no_payment" };
  return { ok: true, uqor, from };
}

export async function topUp(s: Store, hash: string, id: string, treasury: string, fetchImpl: typeof fetch = fetch) {
  const v = await verifyTopUp(hash, id, treasury, fetchImpl);
  if (!v.ok) return v;
  if (!(await s.setOnce(`qrow:ai:tx:${hash.toUpperCase()}`, id))) return { ok: false as const, reason: "already_used" };
  return { ok: true as const, credited: v.uqor, balance: await s.incrBy(balKey(id), v.uqor) };
}

// ------------------------------------------------------------------ providers

const SYSTEM = `You are Qrow's assistant inside the Qrow dApp on QoreChain TESTNET (built in Doha, Qatar). Be brief, friendly and accurate.
Qrow tabs: Send (escrow payments), Receive, NFT Shop, Create NFT, NFT Market, Portfolio, Staking, Market News, Launch, Predictions, Trade (swap + perps), AI, Admin & Analytics.
Rules: everything is testnet with no real value; never ask for or accept private keys, seed phrases or recovery codes; every transaction is approved in the QoreX wallet. Do not give personalised financial or investment advice. If unsure, say so.`;

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export function parseChat(v: unknown): ChatMsg[] | undefined {
  if (!Array.isArray(v) || v.length === 0 || v.length > 12) return undefined;
  const out: ChatMsg[] = [];
  for (const m of v) {
    const role = (m as ChatMsg)?.role;
    const content = (m as ChatMsg)?.content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string" || !content.trim() || content.length > 2000) return undefined;
    out.push({ role, content: content.trim() });
  }
  return out.at(-1)!.role === "user" ? out : undefined;
}

let anthropic: Anthropic | undefined;
export async function chat(messages: ChatMsg[]): Promise<string> {
  anthropic ??= new Anthropic({ timeout: 30_000, maxRetries: 1 });
  const r = await anthropic.messages.create({ model: CHAT_MODEL, max_tokens: 700, system: SYSTEM, messages });
  if (r.stop_reason === "refusal") return "I can’t help with that one.";
  return r.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export const cleanPrompt = (p: unknown) => (typeof p === "string" ? p.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 600) : "");

async function replicate(path: string, init: RequestInit, fetchImpl: typeof fetch) {
  const token = process.env.REPLICATE_API_TOKEN?.trim();
  if (!token) throw new Error("no_key");
  const r = await fetchImpl(`${REPLICATE}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const j = (await r.json().catch(() => ({}))) as { id?: string; status?: string; output?: unknown; error?: unknown };
  if (!r.ok) throw new Error(`replicate_${r.status}`);
  return j;
}

const firstUrl = (o: unknown): string | undefined => (typeof o === "string" ? o : Array.isArray(o) && typeof o[0] === "string" ? o[0] : undefined);

export async function image(prompt: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const model = process.env.REPLICATE_IMAGE_MODEL?.trim() || "black-forest-labs/flux-schnell";
  const j = await replicate(`/models/${model}/predictions`, { method: "POST", headers: { prefer: "wait=55" }, body: JSON.stringify({ input: { prompt, aspect_ratio: "1:1", output_format: "webp", num_outputs: 1 } }) }, fetchImpl);
  const url = firstUrl(j.output);
  if (j.status === "failed" || !url) throw new Error("image_failed");
  return url;
}

export async function startVideo(prompt: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const model = process.env.REPLICATE_VIDEO_MODEL?.trim() || "wan-video/wan-2.2-t2v-fast";
  const j = await replicate(`/models/${model}/predictions`, { method: "POST", body: JSON.stringify({ input: { prompt } }) }, fetchImpl);
  if (!j.id) throw new Error("video_failed");
  return j.id;
}

export async function videoStatus(predictionId: string, fetchImpl: typeof fetch = fetch): Promise<{ status: "running" | "done" | "failed"; url?: string }> {
  if (!/^[a-z0-9]{10,40}$/.test(predictionId)) return { status: "failed" };
  const j = await replicate(`/predictions/${predictionId}`, { method: "GET" }, fetchImpl);
  if (j.status === "succeeded") return { status: "done", url: firstUrl(j.output) };
  if (j.status === "failed" || j.status === "canceled") return { status: "failed" };
  return { status: "running" };
}
