import { qorechainTestnet } from "@qorechain/evm";
import type { Address } from "viem";

/** Qrow runs on testnet only. */
export const CHAIN = qorechainTestnet; // EVM chain id 9800
export const NATIVE_CHAIN_ID = "qorechain-diana";
export const NETWORK_NAME = "QoreChain testnet";

/**
 * Qrow's own server (agent API + REST relay). Empty = same origin (dev proxy, or the server also
 * serving the app). On Cloudflare Pages it's the Render URL, set at build time with VITE_API_BASE.
 */
export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/$/, "");
/** Agent API: AI wording, prices, news, referrals. */
export const AGENT = `${API_BASE}/agent`;
/** REST (LCD) through Qrow's relay (the public API sends no CORS headers). */
export const REST = `${API_BASE}/lcd-testnet`;
/**
 * Where signed transactions are POSTed. On Vercel, rewritten POSTs lose their original path, so
 * production posts straight to the relay function; the dev server proxies /lcd-testnet as usual.
 */
export const BROADCAST_URL = import.meta.env.DEV ? `${REST}/cosmos/tx/v1beta1/txs` : `${API_BASE}/api/lcd?p=cosmos/tx/v1beta1/txs`;

/** The deployed escrow (see contracts/deployments/testnet.json). Override with VITE_QROW_ESCROW. */
export const ESCROW: Address =
  (import.meta.env.VITE_QROW_ESCROW as Address | undefined) ?? "0x332937d1918a0f85eacc5167ab87ba91c48a4655";

/** The production escrow, and the demo copy (10-minute refunds, for showing a refund in a video). */
export const ESCROW_REAL: Address = "0x332937d1918a0f85eacc5167ab87ba91c48a4655";
export const ESCROW_DEMO: Address = "0xe27ad71e9b476518240e71ff4a4d97e1f93264f4";
export const IS_DEMO = ESCROW.toLowerCase() === ESCROW_DEMO.toLowerCase();
/** Refund period of the escrow in use (read from the contract's constant at deploy time). */
export const REFUND_SECONDS = IS_DEMO ? 600 : 7 * 86_400;
export const REFUND_TEXT = IS_DEMO ? "10 minutes" : "7 days";

/** Names a chain id for messages such as "This request is for mainnet, you're on testnet". */
export function networkLabel(chainId: number | undefined): string {
  if (chainId === 9800) return "testnet";
  if (chainId === 9801) return "mainnet";
  return chainId === undefined ? "no network" : `chain ${chainId}`;
}
