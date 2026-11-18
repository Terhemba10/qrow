/**
 * Trade tab prices. ETH, SOL and BNB come from Binance's public market-data mirror (data-api.binance.vision:
 * no key, and it answers from US regions where api.binance.com doesn't). QOR comes from QoreChain testnet's own
 * QOR/fUSD pool (the in-app pool price), and QOR/ETH and QOR/SOL are derived from both. Reports for QrowPerps
 * are signed with PRICE_SIGNER_KEY (an EVM key that only signs prices: it holds nothing and sends nothing).
 */
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const PAIRS = ["QOR/USDT", "QOR/ETH", "QOR/SOL", "ETH/USDT", "SOL/USDT", "BNB/USDT"] as const;
export type Pair = (typeof PAIRS)[number];
export const isPair = (p: string): p is Pair => (PAIRS as readonly string[]).includes(p);
export const pairId = (p: Pair): Hex => keccak256(new TextEncoder().encode(p));

const BINANCE = "https://data-api.binance.vision/api/v3";
const REST = process.env.QORE_REST_URL?.trim() || "https://api-testnet.qore.host";
const FUSD_DENOM = "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA";
export const PRICE_DECIMALS = 8;
const EVM_CHAIN_ID = 9800n;

/** Decimal string → integer with 8 decimals (no floats). */
export function toE8(s: string): bigint {
  const [i, f = ""] = s.trim().split(".");
  if (!/^\d+$/.test(i) || !/^\d*$/.test(f)) throw new Error("bad_price");
  return BigInt(i) * 10n ** 8n + BigInt((f + "00000000").slice(0, 8));
}

/** QOR price in fUSD from the pool's reserves (both 6 decimals), 1e8. */
export function qorFromPool(pools: { token_a: string; token_b: string; reserve_a: string; reserve_b: string; status: string }[]): bigint | undefined {
  const p = pools.find((x) => x.status === "active" && [x.token_a, x.token_b].includes("uqor") && [x.token_a, x.token_b].some((t) => t.toLowerCase() === FUSD_DENOM.toLowerCase()));
  if (!p) return undefined;
  const [fusd, qor] = p.token_a === "uqor" ? [BigInt(p.reserve_b), BigInt(p.reserve_a)] : [BigInt(p.reserve_a), BigInt(p.reserve_b)];
  return qor === 0n ? undefined : (fusd * 10n ** 8n) / qor;
}

export interface Prices {
  at: number;
  prices: Record<Pair, bigint>;
  sources: Record<Pair, string>;
}

let cache: { at: number; value: Prices } | undefined;

export async function getPrices(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Prices> {
  if (cache && now - cache.at < 5_000) return cache.value;
  const [bin, pools] = await Promise.all([
    fetchImpl(`${BINANCE}/ticker/price?symbols=${encodeURIComponent('["ETHUSDT","SOLUSDT","BNBUSDT"]')}`).then((r) => {
      if (!r.ok) throw new Error(`binance_${r.status}`);
      return r.json() as Promise<{ symbol: string; price: string }[]>;
    }),
    fetchImpl(`${REST}/qorechain/amm/v1/pools`).then((r) => {
      if (!r.ok) throw new Error(`pools_${r.status}`);
      return r.json() as Promise<{ pools?: { token_a: string; token_b: string; reserve_a: string; reserve_b: string; status: string }[] }>;
    }),
  ]);
  const by = (s: string) => {
    const row = bin.find((b) => b.symbol === s);
    if (!row) throw new Error(`missing_${s}`);
    return toE8(row.price);
  };
  const eth = by("ETHUSDT");
  const sol = by("SOLUSDT");
  const bnb = by("BNBUSDT");
  const qor = qorFromPool(pools.pools ?? []);
  if (!qor) throw new Error("no_qor_pool");
  const value: Prices = {
    at: now,
    prices: { "QOR/USDT": qor, "QOR/ETH": (qor * 10n ** 8n) / eth, "QOR/SOL": (qor * 10n ** 8n) / sol, "ETH/USDT": eth, "SOL/USDT": sol, "BNB/USDT": bnb },
    sources: {
      "QOR/USDT": "QoreChain testnet QOR/fUSD pool",
      "QOR/ETH": "Testnet pool ÷ Binance ETH/USDT",
      "QOR/SOL": "Testnet pool ÷ Binance SOL/USDT",
      "ETH/USDT": "Binance",
      "SOL/USDT": "Binance",
      "BNB/USDT": "Binance",
    },
  };
  cache = { at: now, value };
  return value;
}

/** Hourly candles for the chart (Binance pairs only; QOR pairs have no history outside the testnet pool). */
export async function getKlines(pair: Pair, fetchImpl: typeof fetch = fetch): Promise<{ t: number; o: number; h: number; l: number; c: number }[]> {
  const sym = { "ETH/USDT": "ETHUSDT", "SOL/USDT": "SOLUSDT", "BNB/USDT": "BNBUSDT" }[pair as string];
  if (!sym) return [];
  const r = await fetchImpl(`${BINANCE}/klines?symbol=${sym}&interval=1h&limit=168`);
  if (!r.ok) throw new Error(`binance_${r.status}`);
  const rows = (await r.json()) as [number, string, string, string, string][];
  return rows.map((k) => ({ t: Math.floor(k[0] / 1000), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]) }));
}

/** keccak256(abi.encode(PRICE_TAG, chainid, perps, pair, price, timestamp)), as QrowPerps.reportHash. */
export function reportHash(perps: Hex, pair: Hex, price: bigint, timestamp: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
      [keccak256(new TextEncoder().encode("QROW_PRICE_V1")), EVM_CHAIN_ID, perps, pair, price, timestamp],
    ),
  );
}

export async function signReport(pair: Pair, price: bigint, perps: Hex, key: Hex, nowSec = Math.floor(Date.now() / 1000)) {
  const id = pairId(pair);
  const timestamp = BigInt(nowSec);
  const signature = await privateKeyToAccount(key).signMessage({ message: { raw: reportHash(perps, id, price, timestamp) } });
  return { pair: id, price: price.toString(), timestamp: timestamp.toString(), signature };
}
