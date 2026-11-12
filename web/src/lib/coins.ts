import { useQuery } from "@tanstack/react-query";
import type { Address, PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { qrowCoinAbi } from "../abi/QrowCoin";
import { qrowCoinFactoryAbi } from "../abi/QrowCoinFactory";
import { COIN_FACTORY } from "../config/contracts";
import { CHAIN } from "../config/network";
import { registerCoins } from "../config/tokens";

export interface LaunchedCoin {
  address: Address;
  index: number;
  name: string;
  symbol: string;
  description: string;
  creator: Address;
  creatorBps: number;
  totalSupply: bigint;
  publicPool: bigint;
  remainingPublic: bigint;
  claimAmount: bigint;
  launchedAt: number;
  /** How many launched coins share this symbol (1 = unique). */
  symbolShared: number;
  mine?: { balance: bigint; claimed: boolean };
}

async function loadCoins(c: PublicClient, me?: Address): Promise<LaunchedCoin[]> {
  const n = Number(await c.readContract({ address: COIN_FACTORY, abi: qrowCoinFactoryAbi, functionName: "coinCount" }));
  if (n === 0) return [];
  const addrs = (await c.readContract({ address: COIN_FACTORY, abi: qrowCoinFactoryAbi, functionName: "coins", args: [0n, BigInt(n)] })) as Address[];
  const coins = await Promise.all(
    addrs.map(async (address, index) => {
      const r = <T>(functionName: string, args: readonly unknown[] = []) => c.readContract({ address, abi: qrowCoinAbi, functionName: functionName as never, args: args as never }) as Promise<T>;
      const [name, symbol, description, creator, creatorBps, totalSupply, publicPool, remainingPublic, claimAmount, launchedAt] = await Promise.all([
        r<string>("name"),
        r<string>("symbol"),
        r<string>("description"),
        r<Address>("creator"),
        r<number>("creatorBps"),
        r<bigint>("totalSupply"),
        r<bigint>("publicPool"),
        r<bigint>("remainingPublic"),
        r<bigint>("claimAmount"),
        r<bigint>("launchedAt"),
      ]);
      const mine = me ? { balance: await r<bigint>("balanceOf", [me]), claimed: await r<boolean>("claimed", [me]) } : undefined;
      return { address: address.toLowerCase() as Address, index, name, symbol, description, creator, creatorBps: Number(creatorBps), totalSupply, publicPool, remainingPublic, claimAmount, launchedAt: Number(launchedAt), symbolShared: 0, mine };
    }),
  );
  for (const coin of coins) coin.symbolShared = coins.filter((x) => x.symbol === coin.symbol).length;
  registerCoins(coins);
  return coins.reverse(); // newest first
}

/** Every coin from QrowCoinFactory (the only source Qrow trusts), with the viewer's balance and claim. */
export function useCoins(me?: Address) {
  const client = usePublicClient({ chainId: CHAIN.id });
  return useQuery({ queryKey: ["qrow-coins", me], enabled: !!client, refetchInterval: 30_000, queryFn: () => loadCoins(client!, me) });
}
