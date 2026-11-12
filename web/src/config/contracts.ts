import type { Address } from "viem";

/** Deployed Qrow contracts on testnet (contracts/deployments/testnet.json). */
export const GENESIS: Address = "0xb82ba02428506ad69be84ee932c844e0d99bc67f";
export const MARKET: Address = "0x92da580048b7cedfd6d834a0f839d38121fc347b";
export const COIN_FACTORY: Address = "0x3571ac216de6fd72ce8e1d9ecebf79d030142f12";
/** First block to scan for Genesis / Market / Factory events. */
export const GENESIS_DEPLOY_BLOCK = 9_961_854n;
