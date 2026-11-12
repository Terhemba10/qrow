/**
 * Which tabs are live in the public beta. A tab goes live the day it passes its tests with a
 * normal QoreX user's Qrow key; until then it shows "Coming soon" (never hidden, never broken).
 * Override at build time with VITE_LIVE_TABS=send,receive,... The dev server shows every tab.
 */
export type TabId = "send" | "receive" | "shop" | "market" | "portfolio" | "staking" | "news" | "launch";

export const TABS: { id: TabId; path: string; label: string; blurb: string }[] = [
  { id: "send", path: "/send", label: "Send", blurb: "Send test tokens to anyone. They wait in escrow until claimed, or come back to you after 7 days." },
  { id: "receive", path: "/receive", label: "Receive", blurb: "Claim payments sent to you, and make a payment request link or QR code." },
  { id: "shop", path: "/shop", label: "NFT Shop", blurb: "Mint a Qrow Genesis NFT, drawn on chain, with test tokens." },
  { id: "market", path: "/market", label: "NFT Market", blurb: "List your NFT at your own price, see the floor, buy or cancel." },
  { id: "portfolio", path: "/portfolio", label: "Portfolio", blurb: "Your balances, NFTs and payments in one place, with CSV export." },
  { id: "staking", path: "/staking", label: "Staking", blurb: "Stake test QOR with a validator, lock it for a bonus, preview an early unlock." },
  { id: "news", path: "/news", label: "Market News", blurb: "Live crypto prices from CoinMarketCap and the latest headlines." },
  { id: "launch", path: "/launch", label: "Launch", blurb: "Launch a testnet memecoin with anti-scam rules built in." },
];

const DEFAULT_LIVE: TabId[] = ["send", "receive", "portfolio", "news"];
const fromEnv = (import.meta.env.VITE_LIVE_TABS as string | undefined)
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean) as TabId[] | undefined;
export const LIVE = new Set<TabId>(import.meta.env.DEV ? TABS.map((t) => t.id) : (fromEnv ?? DEFAULT_LIVE));
export const isLive = (id: TabId) => LIVE.has(id);

/** Where feedback goes: a GitHub issue form (no personal data needed). */
export const FEEDBACK_URL = "https://github.com/Terhemba10/qrow/issues/new?template=feedback.yml";
