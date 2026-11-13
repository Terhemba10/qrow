/**
 * Swap on QoreChain's native AMM, signed in QoreX (it displays and signs MsgSwapExactIn: proven 13 Nov,
 * tx 4A676D5F…). Pools hold bank coins: QOR (uqor) and the fest tokens as `erc20:0x…` bank denoms.
 * Only tokens from config are offered; pools come from the chain and are used only when both of
 * their coins are configured. Direct pools only (no routing through other tokens).
 * Quotes come from the chain's own quote query, so the numbers shown are the chain's numbers.
 */
import { msg } from "@qorechain/sdk";
import { useQuery } from "@tanstack/react-query";
import { REST } from "../config/network";
import { formatUnitsExact as fmt } from "./amount";
import { FAUCET_COINS } from "./faucet";

/** The coins Swap offers (bank denoms and decimals, from config). */
export const SWAP_COINS = FAUCET_COINS;
export type SwapCoin = (typeof SWAP_COINS)[number];

export const coinByDenom = (denom: string): SwapCoin | undefined => SWAP_COINS.find((c) => c.denom.toLowerCase() === denom.toLowerCase());

/** Gas for one swap: about 265k used on chain; QoreX charges the whole limit. */
export const SWAP_GAS = 400_000;
/** QOR kept back for the network fee when swapping QOR (the fee for SWAP_GAS is about 0.06 QOR). */
export const FEE_RESERVE_UQOR = 100_000n;
/** The chain refuses a trade whose price impact is above this (amm params, max_swap_impact_bps). */
export const MAX_IMPACT_BPS = 500;
export const SLIPPAGE_CHOICES_BPS = [50, 100, 300] as const;
export const DEFAULT_SLIPPAGE_BPS = 50;
export const SLIPPAGE_WARN_BPS = 300;
export const SLIPPAGE_MAX_BPS = 1_500;

export interface Pool {
  id: string;
  a: SwapCoin;
  b: SwapCoin;
  reserveA: bigint;
  reserveB: bigint;
}

interface PoolJson {
  id: string;
  token_a: string;
  token_b: string;
  reserve_a: string;
  reserve_b: string;
  status: string;
}

/** Active pools whose two coins are both configured and that hold liquidity on both sides. */
export function usablePools(raw: PoolJson[]): Pool[] {
  return raw.flatMap((p) => {
    const a = coinByDenom(p.token_a);
    const b = coinByDenom(p.token_b);
    const reserveA = BigInt(p.reserve_a || "0");
    const reserveB = BigInt(p.reserve_b || "0");
    if (p.status !== "active" || !a || !b || reserveA === 0n || reserveB === 0n) return [];
    return [{ id: p.id, a, b, reserveA, reserveB }];
  });
}

export async function loadPools(): Promise<Pool[]> {
  const r = await fetch(`${REST}/qorechain/amm/v1/pools`);
  if (!r.ok) throw new Error(`pools: HTTP ${r.status}`);
  return usablePools(((await r.json()) as { pools?: PoolJson[] }).pools ?? []);
}

export function usePools() {
  return useQuery({ queryKey: ["amm-pools"], queryFn: loadPools, refetchInterval: 30_000, staleTime: 15_000 });
}

const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();

/** The deepest direct pool for a pair (reserve product), or undefined if there is none. */
export function poolFor(pools: Pool[], denomIn: string, denomOut: string): Pool | undefined {
  const matches = pools.filter((p) => (same(p.a.denom, denomIn) && same(p.b.denom, denomOut)) || (same(p.b.denom, denomIn) && same(p.a.denom, denomOut)));
  return matches.sort((x, y) => (y.reserveA * y.reserveB > x.reserveA * x.reserveB ? 1 : -1))[0];
}

/** Coins that have a usable direct pool with `denom`. */
export function partnersOf(pools: Pool[], denom: string): SwapCoin[] {
  return SWAP_COINS.filter((c) => !same(c.denom, denom) && !!poolFor(pools, denom, c.denom));
}

/** Reserves as (in, out) for a direction. */
export function reservesFor(pool: Pool, denomIn: string): { rIn: bigint; rOut: bigint } {
  return same(pool.a.denom, denomIn) ? { rIn: pool.reserveA, rOut: pool.reserveB } : { rIn: pool.reserveB, rOut: pool.reserveA };
}

export interface Quote {
  amountOut: bigint;
  fee: bigint;
  impactBps: number;
}

/** The chain's own quote (GET /qorechain/amm/v1/quote/exact_in). */
export async function quoteExactIn(poolId: string, denomIn: string, amountIn: bigint): Promise<Quote> {
  const q = new URLSearchParams({ pool_id: poolId, denom_in: denomIn, amount_in: amountIn.toString() });
  const r = await fetch(`${REST}/qorechain/amm/v1/quote/exact_in?${q}`);
  const j = (await r.json().catch(() => ({}))) as { amount_out?: string; fee?: string; impact_bps?: number; message?: string };
  if (!r.ok || j.amount_out === undefined) throw new Error(quoteErrorText(j.message, r.status));
  return { amountOut: BigInt(j.amount_out), fee: BigInt(j.fee ?? "0"), impactBps: Number(j.impact_bps ?? 0) };
}

/** The chain's quote refusal in plain words (it refuses quotes above the impact cap). */
export function quoteErrorText(message: string | undefined, status: number): string {
  const impact = message?.match(/impact (\d+) bps/);
  if (impact) return `This trade would move the pool price by ${(Number(impact[1]) / 100).toFixed(2)}%. The chain refuses anything above ${MAX_IMPACT_BPS / 100}%: try a smaller amount.`;
  if (message && /insufficient|liquidity|reserve/i.test(message)) return "This pool doesn’t hold enough to pay this amount: try a smaller amount.";
  return message ? `The exchange can’t quote this right now (${message.slice(0, 120)}).` : `The exchange can’t quote this right now (HTTP ${status}).`;
}

/** Minimum received after slippage (rounded down, never above the quote). */
export function minReceived(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

/**
 * Pool price of 1 whole `in` coin in `out` coins (marginal price from reserves, before fee).
 * Display only: never used for amounts.
 */
export function spotRate(pool: Pool, denomIn: string): number {
  const { rIn, rOut } = reservesFor(pool, denomIn);
  const cin = coinByDenom(denomIn)!;
  const cout = same(pool.a.denom, denomIn) ? pool.b : pool.a;
  return (Number(rOut) / 10 ** cout.decimals) / (Number(rIn) / 10 ** cin.decimals);
}

export type Problem =
  | { id: "balance"; text: string }
  | { id: "fee"; text: string }
  | { id: "impact"; text: string }
  | { id: "tiny"; text: string }
  | { id: "slippage"; text: string };

/** Everything that would make the chain refuse the swap, checked before QoreX is asked. */
export function swapProblems(args: {
  coinIn: SwapCoin;
  amountIn: bigint;
  balanceIn: bigint;
  balanceQor: bigint;
  quote?: Quote;
  slippageBps: number;
}): Problem[] {
  const { coinIn, amountIn, balanceIn, balanceQor, quote, slippageBps } = args;
  const out: Problem[] = [];
  const isQor = coinIn.denom === "uqor";
  if (amountIn > balanceIn) out.push({ id: "balance", text: `You have ${fmt(balanceIn, coinIn.decimals)} ${coinIn.symbol}.` });
  else if (isQor && amountIn + FEE_RESERVE_UQOR > balanceQor) out.push({ id: "fee", text: `Keep about 0.1 QOR for the network fee: swap at most ${fmt(max0(balanceQor - FEE_RESERVE_UQOR), 6)} QOR.` });
  else if (!isQor && balanceQor < FEE_RESERVE_UQOR) out.push({ id: "fee", text: "You need about 0.1 QOR for the network fee. The Faucet gives 100 QOR a day." });
  if (quote && quote.impactBps > MAX_IMPACT_BPS) out.push({ id: "impact", text: `This trade moves the pool price by ${(quote.impactBps / 100).toFixed(2)}%. The chain refuses anything above ${MAX_IMPACT_BPS / 100}%: try a smaller amount.` });
  if (quote && minReceived(quote.amountOut, slippageBps) === 0n) out.push({ id: "tiny", text: "This amount is too small: you would receive nothing. Try a bigger amount." });
  if (slippageBps > SLIPPAGE_MAX_BPS) out.push({ id: "slippage", text: `Slippage above ${SLIPPAGE_MAX_BPS / 100}% isn’t allowed.` });
  return out;
}

const max0 = (x: bigint) => (x > 0n ? x : 0n);

/** The largest amount to offer with "Max": for QOR, the balance minus the fee reserve. */
export function maxSwappable(coinIn: SwapCoin, balanceIn: bigint): bigint {
  return coinIn.denom === "uqor" ? max0(balanceIn - FEE_RESERVE_UQOR) : balanceIn;
}

export const swapMsg = (sender: string, poolId: string, coinIn: SwapCoin, amountIn: bigint, coinOut: SwapCoin, minOut: bigint) =>
  msg.amm.swapExactIn({ sender, poolId, tokenIn: { denom: coinIn.denom, amount: amountIn.toString() }, denomOut: coinOut.denom, minOut: minOut.toString() });

export interface SwapResult {
  amountIn: bigint;
  amountOut: bigint;
  height: number;
  time: string;
}

/** What the chain says happened: the amm_swap event of a confirmed transaction. */
export function swapFromEvents(events: { type: string; attributes: { key: string; value: string }[] }[]): { amountIn: bigint; amountOut: bigint } | undefined {
  const e = events.find((x) => x.type === "amm_swap");
  if (!e) return undefined;
  const a = Object.fromEntries(e.attributes.map((x) => [x.key, x.value]));
  return a.amount_in && a.amount_out ? { amountIn: BigInt(a.amount_in), amountOut: BigInt(a.amount_out) } : undefined;
}
