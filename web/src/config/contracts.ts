import type { Address } from "viem";

/** Deployed Qrow contracts on testnet (contracts/deployments/testnet.json). */
/** v3 (device keys), deployed 2026-11-13. Shared device-key registry used by every Qrow contract. */
export const KEYS: Address = "0xa5242cb348eddef0deb9599f81e55a64d186fd14";
export const GENESIS: Address = "0x5f03380be788bbd17eb3529b77ee27bed879602d";
export const MARKET: Address = "0x10e2e663ebb1fdd290b8cabbe6e2634852d65fa9";
export const COIN_FACTORY: Address = "0x764a8586e7a7e9e2b511bf79d9f9c8b3ae7e7c5e";
/** First block to scan for Genesis / Market / Factory events. */
export const GENESIS_DEPLOY_BLOCK = 9_978_059n;
