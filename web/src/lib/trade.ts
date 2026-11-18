/**
 * Trade tab: live prices and candles from Qrow's price service (/api/price), and perp maths mirrored from
 * QrowPerps so the confirm screen shows entry, size, fees and liquidation price before signing.
 */
import { useQuery } from "@tanstack/react-query";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { usePublicClient } from "wagmi";
import { qrowPerpsAbi } from "../abi/QrowPerps";
import { PERPS } from "../config/contracts";
import { CHAIN } from "../config/network";

export const PAIRS = ["QOR/USDT", "QOR/ETH", "QOR/SOL", "ETH/USDT", "SOL/USDT", "BNB/USDT"] as const;
export type Pair = (typeof PAIRS)[number];
/** PLAN.md Q1: the owner's note may say 70x; one constant here and in QrowPerps.MAX_LEVERAGE. */
export const MAX_LEVERAGE = 100;
export const FEE_BPS = 5n;
export const MAINT_BPS = 50n;
export const E8 = 100_000_000n;
export const pairId = (p: Pair): Hex => keccak256(toBytes(p));
export const pairById = (id: string) => PAIRS.find((p) => pairId(p).toLowerCase() === id.toLowerCase());

/** QOR/ETH and QOR/SOL are priced in the quote coin; everything else in USDT. */
export const quoteOf = (p: Pair) => p.split("/")[1];
export function fmtPrice(e8: bigint | undefined, p: Pair): string {
  if (e8 === undefined) return "–";
  const n = Number(e8) / 1e8;
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : n >= 0.01 ? 5 : 8;
  return `${n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) })} ${quoteOf(p)}`;
}

export function usePrices() {
  return useQuery({
    queryKey: ["prices"],
    refetchInterval: 5_000,
    queryFn: async () => {
      const r = await fetch("/api/price");
      const j = (await r.json()) as { ok: boolean; prices: Record<Pair, string>; sources: Record<Pair, string> };
      if (!j.ok) throw new Error("prices unavailable");
      return { prices: Object.fromEntries(Object.entries(j.prices).map(([k, v]) => [k, BigInt(v)])) as Record<Pair, bigint>, sources: j.sources };
    },
  });
}

export function useCandles(pair: Pair) {
  return useQuery({
    queryKey: ["candles", pair],
    refetchInterval: 60_000,
    queryFn: async () => {
      const r = await fetch(`/api/price?klines=${encodeURIComponent(pair)}`);
      const j = (await r.json()) as { ok: boolean; candles: { t: number; o: number; h: number; l: number; c: number }[] };
      return j.ok ? j.candles : [];
    },
  });
}

export interface Report {
  pair: Hex;
  price: bigint;
  timestamp: bigint;
  signature: Hex;
}

export async function fetchReport(pair: Pair): Promise<Report> {
  const r = await fetch(`/api/price?report=${encodeURIComponent(pair)}`);
  const j = (await r.json()) as { ok: boolean; reason?: string; report?: { pair: Hex; price: string; timestamp: string; signature: Hex } };
  if (!j.ok || !j.report) throw new Error(j.reason === "signer_not_configured" ? "The price service isn’t switched on yet on this site." : "Couldn’t get a fresh price. Try again.");
  return { pair: j.report.pair, price: BigInt(j.report.price), timestamp: BigInt(j.report.timestamp), signature: j.report.signature };
}

export interface PerpQuote {
  size: bigint;
  fee: bigint;
  margin: bigint;
  liqPrice: bigint;
}

/** Same maths as QrowPerps: size = margin × leverage; 0.05% fee from the margin; liquidation at margin − 0.5% of size. */
export function quotePerp(entry: bigint, marginGross: bigint, leverage: number, isLong: boolean): PerpQuote {
  const size = marginGross * BigInt(leverage);
  const fee = (size * FEE_BPS) / 10_000n;
  const margin = marginGross - fee;
  const maint = (size * MAINT_BPS) / 10_000n;
  let liqPrice = entry;
  if (margin > maint && size > 0n) {
    const room = ((margin - maint) * entry) / size;
    liqPrice = isLong ? (room >= entry ? 0n : entry - room) : entry + room;
  }
  return { size, fee, margin, liqPrice };
}

/** PnL (fUSD units, before the closing fee) at `price`, as QrowPerps.pnlAt. */
export const pnlAt = (size: bigint, entry: bigint, price: bigint, isLong: boolean) => {
  const raw = (size * (price - entry)) / entry;
  return isLong ? raw : -raw;
};

/** 1% price protection, signed with the order (QrowPerps refuses a fill outside it). */
export const limitFor = (price: bigint, isLong: boolean, opening: boolean, bps = 100n) =>
  (isLong === opening ? price * (10_000n + bps) : price * (10_000n - bps)) / 10_000n;

/** A TP / SL is on the right side of entry: long TP above, SL below; short the reverse (0 = none). Mirrors QrowPerps._checkTpSl. */
export function tpSlProblem(isLong: boolean, entry: bigint, liq: bigint, tp: bigint, sl: bigint): string | undefined {
  if (tp && (isLong ? tp <= entry : tp >= entry)) return `Take profit must be ${isLong ? "above" : "below"} the entry price.`;
  if (sl && (isLong ? sl >= entry : sl <= entry)) return `Stop loss must be ${isLong ? "below" : "above"} the entry price.`;
  if (sl && (isLong ? sl <= liq : sl >= liq)) return "This stop loss is past the liquidation price, so liquidation would come first.";
  return undefined;
}

export interface PerpPosition {
  id: bigint;
  pair: Pair;
  isLong: boolean;
  open: boolean;
  closedBy: number;
  openedAt: number;
  closedAt: number;
  margin: bigint;
  size: bigint;
  entryPrice: bigint;
  exitPrice: bigint;
  pnl: bigint;
  takeProfit: bigint;
  stopLoss: bigint;
}

export function usePositions(me: Address | undefined) {
  const client = usePublicClient({ chainId: CHAIN.id });
  return useQuery({
    queryKey: ["perp-positions", me],
    enabled: !!client && !!PERPS && !!me,
    refetchInterval: 10_000,
    queryFn: async (): Promise<PerpPosition[]> => {
      const c = client!;
      const ids = await c.readContract({ address: PERPS!, abi: qrowPerpsAbi, functionName: "positionsOf", args: [me!] });
      const rows = await Promise.all(
        [...ids].reverse().slice(0, 100).map(async (id) => {
          const p = (await c.readContract({ address: PERPS!, abi: qrowPerpsAbi, functionName: "getPosition", args: [id] })) as {
            pair: Hex;
            isLong: boolean;
            open: boolean;
            closedBy: number;
            openedAt: bigint;
            closedAt: bigint;
            margin: bigint;
            size: bigint;
            entryPrice: bigint;
            exitPrice: bigint;
            pnl: bigint;
          };
          const t = (await c.readContract({ address: PERPS!, abi: qrowPerpsAbi, functionName: "getTpSl", args: [id] })) as { takeProfit: bigint; stopLoss: bigint };
          return { id, ...p, pair: pairById(p.pair) ?? "ETH/USDT", openedAt: Number(p.openedAt), closedAt: Number(p.closedAt), takeProfit: t.takeProfit, stopLoss: t.stopLoss };
        }),
      );
      return rows;
    },
  });
}
