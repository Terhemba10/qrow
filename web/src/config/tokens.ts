import type { Address } from "viem";

export type BaseSymbol = "QOR" | "fUSD" | "fETH" | "fBTC";
/** A base symbol, or a launched Qrow coin's key (its lowercase contract address). */
export type TokenSymbol = string;

export interface Token {
  symbol: string;
  /** Set for coins from the Qrow launcher: testnet memecoins with no value. */
  qrowCoin?: true;
  name: string;
  /** undefined = native QOR, sent as msg.value */
  address?: Address;
  decimals: number;
  /** Bank denom of the same asset on the native lane (fest tokens arrive as bank coins). */
  bankDenom: string;
}

/**
 * The only tokens Qrow sends, on testnet (chain 9800). Addresses come from this config, never
 * from user input or a QR code. Decimals confirmed on chain with decimals() on 2026-11-12.
 */
export const TOKENS: readonly Token[] = [
  { symbol: "QOR", name: "QOR", decimals: 18, bankDenom: "uqor" },
  {
    symbol: "fUSD",
    name: "Fest USD",
    address: "0x97143B771D34ddb9130b807b135Ae675A5a963CA",
    decimals: 6,
    bankDenom: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA",
  },
  {
    symbol: "fETH",
    name: "Fest ETH",
    address: "0x02292293c13880a26242690eb70a0e42B8E91c28",
    decimals: 18,
    bankDenom: "erc20:0x02292293c13880a26242690eb70a0e42B8E91c28",
  },
  {
    symbol: "fBTC",
    name: "Fest BTC",
    address: "0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A",
    decimals: 8,
    bankDenom: "erc20:0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A",
  },
];

/** Only the configured tokens (QR codes and payment requests may name these and nothing else). */
export const baseTokenBySymbol = (s: string): Token | undefined => TOKENS.find((t) => t.symbol === s);

// Launched Qrow coins, registered at runtime from QrowCoinFactory.coins() (never from user input).
const COIN_CACHE = "qrow.coins.v2"; // v2 factory (app key); v1 coins are no longer offered
const coins = new Map<string, Token>();
const coinToken = (c: { address: Address; symbol: string; name: string }): Token => ({
  symbol: c.symbol,
  name: c.name,
  address: c.address,
  decimals: 18,
  bankDenom: `erc20:${c.address}`,
  qrowCoin: true,
});
try {
  const raw = JSON.parse(localStorage.getItem(COIN_CACHE) ?? "[]") as { address: string; symbol: string; name: string }[];
  for (const c of raw) if (/^0x[0-9a-f]{40}$/.test(c.address) && /^[A-Z0-9]{2,8}$/.test(c.symbol)) coins.set(c.address, coinToken(c as never));
} catch {
  /* no cache: coins load from chain */
}
export function registerCoins(list: { address: Address; symbol: string; name: string }[]) {
  for (const c of list) coins.set(c.address.toLowerCase(), coinToken({ ...c, address: c.address.toLowerCase() as Address }));
  try {
    localStorage.setItem(COIN_CACHE, JSON.stringify([...coins.values()].map((t) => ({ address: t.address, symbol: t.symbol, name: t.name }))));
  } catch {
    /* storage blocked: fine */
  }
}
export const launchedCoins = (): Token[] => [...coins.values()];
/** Key used in drafts and radio values: the symbol for base tokens, the address for launched coins. */
export const tokenKey = (t: Token): string => (t.qrowCoin ? t.address!.toLowerCase() : t.symbol);
export const tokenBySymbol = (s: string): Token | undefined => baseTokenBySymbol(s) ?? coins.get(s.toLowerCase());
export const tokenByAddress = (a: string): Token | undefined =>
  TOKENS.find((t) => (t.address ?? "0x0000000000000000000000000000000000000000").toLowerCase() === a.toLowerCase()) ?? coins.get(a.toLowerCase());

/** Contract-side token address (address(0) for native QOR). */
export const tokenAddress = (t: Token): Address => t.address ?? "0x0000000000000000000000000000000000000000";
