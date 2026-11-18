/**
 * Prediction markets (QrowPredict): reads, and the pool maths mirrored from the contract so the confirm screen
 * shows the exact shares before signing. Collateral is fUSD (6 decimals): QoreX can't attach QOR to a contract
 * call (PLAN.md fact 2), and test QOR swaps to fUSD in one QoreX approval on the Swap tab.
 */
import { useQuery } from "@tanstack/react-query";
import type { Address, PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { qrowPredictAbi } from "../abi/QrowPredict";
import { PREDICT } from "../config/contracts";
import { CHAIN } from "../config/network";

export const FEE_BPS = 100n;
export const DISPUTE_DELAY = 3600;

export enum Outcome {
  None = 0,
  Yes = 1,
  No = 2,
  Invalid = 3,
}

export interface MarketRow {
  id: bigint;
  question: string;
  category: string;
  endTime: number;
  resolvedAt: number;
  resolved: boolean;
  outcome: Outcome;
  yesPool: bigint;
  noPool: bigint;
  volume: bigint;
  liquidity: bigint;
  /** YES probability, 0..1. */
  yesProb: number;
}

/** YES price in millionths, as the contract computes it. */
export const yesPriceE6 = (yesPool: bigint, noPool: bigint) => (yesPool + noPool === 0n ? 0n : (noPool * 1_000_000n) / (yesPool + noPool));

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Shares out for `amount` fUSD units (same rounding as QrowPredict.quoteBuy). */
export function quoteBuy(yesPool: bigint, noPool: bigint, yes: boolean, amount: bigint): bigint {
  const net = amount - (amount * FEE_BPS) / 10_000n;
  const k = yesPool * noPool;
  return yes ? yesPool + net - ceilDiv(k, noPool + net) : noPool + net - ceilDiv(k, yesPool + net);
}

function isqrtCeil(n: bigint): bigint {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x * x === n ? x : x + 1n;
}

/** fUSD out after the fee for selling `shares` (same maths as QrowPredict.quoteSell). */
export function quoteSell(yesPool: bigint, noPool: bigint, yes: boolean, shares: bigint): bigint {
  const a = yes ? yesPool : noPool;
  const b = yes ? noPool : yesPool;
  const sum = a + shares + b;
  let r = (sum - isqrtCeil(sum * sum - 4n * shares * b)) / 2n;
  if (r >= b) r = b - 1n;
  return r - (r * FEE_BPS) / 10_000n;
}

/** Keep at least 98% of the quote (2% slippage), the default on the confirm screen. */
export const withSlippage = (q: bigint, bps = 200n) => (q * (10_000n - bps)) / 10_000n;

export const pct = (p: number) => `${Math.round(p * 100)}%`;

type Raw = {
  question: string;
  category: string;
  endTime: bigint;
  resolvedAt: bigint;
  status: number;
  outcome: number;
  yesPool: bigint;
  noPool: bigint;
  volume: bigint;
  liquidity: bigint;
};

export async function readMarkets(c: PublicClient, address: Address): Promise<MarketRow[]> {
  const count = await c.readContract({ address, abi: qrowPredictAbi, functionName: "marketCount" });
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
  const raws = await Promise.all(ids.map((id) => c.readContract({ address, abi: qrowPredictAbi, functionName: "getMarket", args: [id] }) as Promise<Raw>));
  return raws.map((m, i) => ({
    id: ids[i],
    question: m.question,
    category: m.category,
    endTime: Number(m.endTime),
    resolvedAt: Number(m.resolvedAt),
    resolved: m.status === 1,
    outcome: m.outcome as Outcome,
    yesPool: m.yesPool,
    noPool: m.noPool,
    volume: m.volume,
    liquidity: m.liquidity,
    yesProb: Number(yesPriceE6(m.yesPool, m.noPool)) / 1e6,
  }));
}

export function useMarkets() {
  const client = usePublicClient({ chainId: CHAIN.id });
  return useQuery({
    queryKey: ["predict-markets", PREDICT],
    enabled: !!client && !!PREDICT,
    refetchInterval: 15_000,
    queryFn: () => readMarkets(client!, PREDICT!),
  });
}

export interface Position {
  yes: bigint;
  no: bigint;
  payout: bigint;
  claimed: boolean;
}

export function usePositions(me: Address | undefined, ids: bigint[]) {
  const client = usePublicClient({ chainId: CHAIN.id });
  return useQuery({
    queryKey: ["predict-positions", PREDICT, me, ids.join(",")],
    enabled: !!client && !!PREDICT && !!me && ids.length > 0,
    refetchInterval: 15_000,
    queryFn: async () => {
      const c = client!;
      const rows = await Promise.all(
        ids.map(async (id) => {
          const [[yes, no], payout, claimed] = await Promise.all([
            c.readContract({ address: PREDICT!, abi: qrowPredictAbi, functionName: "sharesOf", args: [id, me!] }),
            c.readContract({ address: PREDICT!, abi: qrowPredictAbi, functionName: "payoutOf", args: [id, me!] }),
            c.readContract({ address: PREDICT!, abi: qrowPredictAbi, functionName: "claimed", args: [id, me!] }),
          ]);
          return [id.toString(), { yes, no, payout, claimed }] as const;
        }),
      );
      return new Map<string, Position>(rows);
    },
  });
}

/** The demo markets seeded at deploy (contracts/scripts/deploy-sprint2.ts reads the same list). */
export const SEED_MARKETS: { question: string; category: string; days: number }[] = [
  { question: "Will BTC close above $100,000 on 31 Dec 2026 (Binance BTC/USDT daily close)?", category: "Crypto", days: 43 },
  { question: "Will ETH trade above $5,000 at any time before 31 Dec 2026?", category: "Crypto", days: 43 },
  { question: "Will QOR's price on the testnet QOR/fUSD pool be above 1 fUSD on 31 Dec 2026?", category: "QoreChain", days: 43 },
  { question: "Will QoreChain mainnet process more than 1 million transactions by 31 Jan 2027?", category: "QoreChain", days: 74 },
  { question: "Will SOL close above $300 on 31 Dec 2026 (Binance SOL/USDT daily close)?", category: "Crypto", days: 43 },
  { question: "Will Qrow reach 1,000 testnet users before the People's Choice vote ends (15 Dec 2026)?", category: "Qrow", days: 27 },
];
