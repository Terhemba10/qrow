/**
 * "Ready to test?" checks for a new visitor. Read-only: nothing here signs, switches networks or
 * moves funds. Each item has a status and the fix the page offers.
 */
import { useQuery } from "@tanstack/react-query";
import { evmToQor } from "@qorechain/sdk";
import type { Address } from "viem";
import { useAccount, useBalance, usePublicClient } from "wagmi";
import { CHAIN } from "../config/network";
import { hasAppKey } from "./appKey";
import { chainKeyRegistered } from "./pq";
import { qorexAccount, qorexAvailable } from "./staking";

export type ItemId = "qorex" | "evmWallet" | "network" | "sameAccount" | "qor" | "chainKey" | "appKey";
export type ItemState = "ok" | "todo" | "wait" | "unknown";
export interface Item {
  id: ItemId;
  state: ItemState;
}

/** 1 QOR covers several Qrow actions' fees with room to spare. */
export const MIN_QOR = 10n ** 18n;

export function useReadiness() {
  const { address, chainId, isConnected } = useAccount();
  const client = usePublicClient({ chainId: CHAIN.id });
  const onTestnet = isConnected && chainId === CHAIN.id;
  const me: Address | undefined = onTestnet ? address : undefined;
  const balance = useBalance({ address: me, chainId: CHAIN.id, query: { enabled: !!me, refetchOnWindowFocus: true, refetchInterval: 20_000 } });

  const qorex = useQuery({
    queryKey: ["qorex-account", me],
    refetchOnWindowFocus: true,
    queryFn: async () => (qorexAvailable() ? ((await qorexAccount().catch(() => undefined)) ?? null) : null),
  });
  const keys = useQuery({
    queryKey: ["readiness-keys", me],
    enabled: !!me && !!client,
    refetchOnWindowFocus: true,
    refetchInterval: 20_000,
    queryFn: async () => {
      const [chain, app] = await Promise.all([chainKeyRegistered(client!, me!), hasAppKey(client!, me!)]);
      return { chain, app };
    },
  });

  const items: Item[] = [
    { id: "qorex", state: qorexAvailable() ? "ok" : "todo" },
    { id: "evmWallet", state: isConnected ? "ok" : "todo" },
    { id: "network", state: !isConnected ? "wait" : onTestnet ? "ok" : "todo" },
    {
      id: "sameAccount",
      state: !me || !qorexAvailable() ? "wait" : qorex.isPending ? "unknown" : qorex.data ? (qorex.data === evmToQor(me) ? "ok" : "todo") : "todo",
    },
    { id: "qor", state: !me ? "wait" : balance.data === undefined ? "unknown" : balance.data.value >= MIN_QOR ? "ok" : "todo" },
    { id: "chainKey", state: !me ? "wait" : !keys.data ? "unknown" : keys.data.chain ? "ok" : "todo" },
    { id: "appKey", state: !me || !keys.data?.chain ? "wait" : keys.data.app ? "ok" : "todo" },
  ];
  const ready = items.every((i) => i.state === "ok");
  return { items, ready, me, qorexQor: qorex.data ?? undefined, balance: balance.data?.value, refetch: () => void Promise.all([keys.refetch(), balance.refetch(), qorex.refetch()]) };
}
