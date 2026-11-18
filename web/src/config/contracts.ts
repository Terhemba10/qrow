import type { Address } from "viem";

/** Deployed Qrow contracts on testnet (contracts/deployments/testnet.json). */
/** v3 (device keys), deployed 2026-11-13. Shared device-key registry used by every Qrow contract. */
export const KEYS: Address = "0xa5242cb348eddef0deb9599f81e55a64d186fd14";
export const GENESIS: Address = "0x5f03380be788bbd17eb3529b77ee27bed879602d";
export const MARKET: Address = "0x10e2e663ebb1fdd290b8cabbe6e2634852d65fa9";
export const COIN_FACTORY: Address = "0x764a8586e7a7e9e2b511bf79d9f9c8b3ae7e7c5e";
/** First block to scan for Genesis / Market / Factory events. */
export const GENESIS_DEPLOY_BLOCK = 9_978_059n;

/**
 * Fest sprint contracts (PLAN.md). Undefined until deployed: the tab then says so instead of failing.
 * Set at build time (VITE_QROW_PREDICT, …) or here after `npm run deploy:sprint2` in contracts/.
 */
const env = (k: string) => ((import.meta.env[k] as string | undefined)?.trim() || undefined) as Address | undefined;
export const PREDICT: Address | undefined = env("VITE_QROW_PREDICT");
export const EDITIONS: Address | undefined = env("VITE_QROW_EDITIONS");
export const PERPS: Address | undefined = env("VITE_QROW_PERPS");
/** Addresses that see the Admin controls (comma-separated in VITE_ADMIN_ADDRESSES; default: the deployer). */
export const ADMINS: string[] = ((import.meta.env.VITE_ADMIN_ADDRESSES as string | undefined) ?? "0xD517458c6b083B964342C604D35Be6afC2dCcb37")
  .split(",")
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean);
export const isAdmin = (a?: string) => !!a && ADMINS.includes(a.toLowerCase());
