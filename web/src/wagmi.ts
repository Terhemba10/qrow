// Adapted from the create-qorechain-dapp viem-wagmi template (Apache-2.0, QoreChain Association).
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { qorexWallet } from "@qorechain/qorex-rainbowkit";
import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { mock } from "wagmi/connectors";
import type { Address } from "viem";
import { CHAIN } from "./config/network";

// Dev only: a read-only "watch" wallet for screenshots and layout checks without an extension.
// It exists only under `vite dev` with VITE_DEV_WATCH_ADDRESS set, and it cannot sign anything.
const watch = import.meta.env.DEV ? (import.meta.env.VITE_DEV_WATCH_ADDRESS as Address | undefined) : undefined;
const devConnectors: CreateConnectorFn[] = watch
  ? [mock({ accounts: [watch], features: { reconnect: true, defaultConnected: false } })]
  : [];

// QoreX first (connects and reads today), then any injected EIP-1193 wallet (which can sign EVM
// transactions). Neither uses WalletConnect, so the project id is a placeholder.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Wallets",
      wallets: [() => qorexWallet({ pollAccountsOnFocus: true }), injectedWallet],
    },
  ],
  { appName: "Qrow", projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "unused" },
);

// Testnet only: any other chain is "wrong network" and the app never switches by itself.
export const config = createConfig({
  chains: [CHAIN],
  connectors: [...connectors, ...devConnectors],
  transports: { [CHAIN.id]: http() },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
