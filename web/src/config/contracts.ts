import type { Address } from "viem";

/** Deployed Qrow contracts on testnet (contracts/deployments/testnet.json). */
/** v2 (app key), deployed 2026-11-13. Shared app-key registry used by every Qrow contract. */
export const KEYS: Address = "0x4ee5ca4c4d4ce7a7458a44c8eb155d7026f23db8";
export const GENESIS: Address = "0x73fe0fb443962c1e1503f57aba3cc6e895117287";
export const MARKET: Address = "0xc9c9dab84f368d879aa8f96b5dbf5c22062da373";
export const COIN_FACTORY: Address = "0x7ff6a8a047d9558c6b152a3cffe1adea19407836";
/** First block to scan for Genesis / Market / Factory events. */
export const GENESIS_DEPLOY_BLOCK = 9_974_920n;
