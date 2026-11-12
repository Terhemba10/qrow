import { qorechainTestnet } from "@qorechain/evm";
import type { Address } from "viem";

/** Qrow runs on testnet only. */
export const CHAIN = qorechainTestnet; // EVM chain id 9800
export const NATIVE_CHAIN_ID = "qorechain-diana";
export const NETWORK_NAME = "QoreChain testnet";

/** REST (LCD) through the dev/preview proxy (the public API sends no CORS headers). */
export const REST = "/lcd-testnet";

/** The deployed escrow (see contracts/deployments/testnet.json). Override with VITE_QROW_ESCROW. */
export const ESCROW: Address =
  (import.meta.env.VITE_QROW_ESCROW as Address | undefined) ?? "0xcf36b836872a0b277919eac1fb976722e32d824b";

export const REFUND_DAYS = 7;

/** Names a chain id for messages such as "This request is for mainnet, you're on testnet". */
export function networkLabel(chainId: number | undefined): string {
  if (chainId === 9800) return "testnet";
  if (chainId === 9801) return "mainnet";
  return chainId === undefined ? "no network" : `chain ${chainId}`;
}
