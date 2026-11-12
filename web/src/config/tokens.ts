import type { Address } from "viem";

export type TokenSymbol = "QOR" | "fUSD" | "fETH" | "fBTC";

export interface Token {
  symbol: TokenSymbol;
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

export const tokenBySymbol = (s: string): Token | undefined => TOKENS.find((t) => t.symbol === s);

/** Contract-side token address (address(0) for native QOR). */
export const tokenAddress = (t: Token): Address => t.address ?? "0x0000000000000000000000000000000000000000";
