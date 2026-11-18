# Qrow — Fest sprint plan (started 2026-11-18)

Brief: 7 features (Phase 1), a Figma redesign (Phase 2), a clickable prototype and walkthrough video (Phase 3).
Testnet only (`qorechain-diana`, EVM 9800). The long-running build history and earlier decisions stay in
[`docs/PLAN.md`](docs/PLAN.md). This file covers the new brief only. Each task is ticked when it is committed.

## Platform facts that shape this brief (from the code, docs/PLAN.md and docs.qorechain.io, checked 18 Nov)

1. **QoreX can't send EVM transactions** (`eth_sendTransaction`, `personal_sign` and `signArbitrary` are refused in
   `@qorechain/qorex-types` 0.1.0, the latest on npm). QoreX also won't display `MsgCrossVMCall`. Qrow's live route
   for every contract action is the approved **one-approval flow** (`web/src/lib/action.ts`): the user approves
   **one** QoreX transaction (device fees, an authz grant and a scoped EVM window), then this browser's
   passkey-protected device account runs the call *as the user*. Every new contract below uses the same flow, so
   users still connect QoreX, never paste a key, and approve each action in QoreX.
2. **A contract call can't carry QOR.** A cross-VM call has no `value` for EVM targets. So contracts that take
   payments (prediction markets, perps, NFT editions, marketplace) settle in **fUSD**, the testnet's fest dollar
   (ERC-20). It is already in the official faucet and swaps with test QOR on the native AMM, signed in QoreX
   (live Swap tab). That covers the brief's "test USDT": see Q2.
3. **Plain QOR sends *are* signed in QoreX** (`MsgSend`). The AI tab therefore takes **test QOR** directly: the user
   signs a QOR payment in QoreX, and the server checks it on chain before adding credits.
4. **Mobile:** the QoreX docs say the in-app browser injects `window.qorex` (native, read-only EVM, Solana),
   announces itself with EIP-6963, and sets `window.ethereum` *only if no other wallet did*. Qrow's connector only
   looked at EIP-6963 and `window.qorex.evm.isQoreX === true`, and stopped looking after 15 seconds, so a QoreX
   that injects late or only fills `window.ethereum` was missed. The docs give **no deep-link format** for opening
   a URL in the QoreX app (only "Android deep links for `qorex://` flows"). See Q4.

## Questions for the owner (I went ahead with the choice in bold)

| # | Question | Choice made |
|---|---|---|
| Q1 | Perp max leverage: 100x or 70x? | **100x** (the main text). It is one constant, `MAX_LEVERAGE` in `contracts/src/QrowPerps.sol` and `web/src/config/trade.ts`. |
| Q2 | "Deploy a test USDT + AMM": QoreX can't call an EVM AMM with QOR (fact 2). | **qUSD = fUSD**, swapped QOR ⇄ fUSD on QoreChain's native AMM, signed in QoreX. The Trade tab labels it "test USDT (fUSD)". No new token, no unsigned path. |
| Q3 | "All payments use test QOR" for prediction markets. | **fUSD** (fact 2). Users swap test QOR to fUSD in one QoreX approval, from a button on the market screen. |
| Q4 | "Open in QoreX" deep link: no documented URL format. | **Button**: copies the Qrow link, tries `qorex://`, then shows the store link and the 2-step "Home → Enter a dApp URL" instructions. **Please ask QoreChain on Discord for the dApp deep-link format**, and I'll switch to it. |
| Q5 | AI providers. | **Chat: Anthropic Claude** (the SDK is already in the app). **Image + video: Replicate** (one key: FLUX schnell for images, a short text-to-video model). Both are server-side, set by env vars. |
| Q6 | IPFS service. | **Pinata** (`PINATA_JWT`, server-side upload route). Without it, uploads are refused with a clear message. |
| Q7 | Prediction-market oracle. | **Admin resolves** (allowlisted admin address), with a 1-hour dispute delay before winnings can be claimed. Pricing: a constant-product YES/NO pool (CPMM), so prices move as people trade. |
| Q8 | Perp prices for ETH, SOL and BNB. | **Signed price reports**: a Vercel route reads the Binance public API and signs `(pair, price, time)` with `PRICE_SIGNER_KEY`; the contract accepts reports up to 60 s old from that signer. QOR's price is the native AMM QOR/fUSD pool. No server sends transactions. |
| Q9 | Phase 2 needs the Figma connector. | The official Figma MCP is available in this session. Phase 2 stops for your approval before any code changes (step 2d). |

## Phase 1 — Features

- [ ] **1. Prediction Markets tab**
  - Contract `contracts/src/QrowPredict.sol` (+ `test/Predict.t.sol`): create market (admin), buy and sell YES/NO
    (CPMM in fUSD, 1% fee), resolve (admin; YES, NO or Invalid → refund), claim. Device-key PQ checks via `PqAuth`.
  - Deploy plus seed 6 markets: `contracts/scripts/deploy-predict.ts`; address in `deployments/testnet.json`.
  - Web: `web/src/abi/QrowPredict.ts`, `web/src/lib/predict.ts` (+ test), `web/src/pages/PredictPage.tsx`,
    a sign-in message step (QoreX signs nothing off chain, so "authorise" = connect + confirm account match;
    see notes), Admin create/resolve in `web/src/pages/AdminPage.tsx`, tab in `web/src/config/tabs.ts`, route in `web/src/App.tsx`.
- [ ] **2. Mobile wallet connection fix (high priority)**
  - `web/src/lib/qorex.ts` (+ `qorex.test.ts`): one provider resolver (EIP-6963 by rdns or name, `window.qorex.evm`,
    `window.ethereum` / `ethereum.providers[]` with `isQoreX`), detection that keeps watching (fast for 30 s, then
    every 3 s while not found), and `ethereum#initialized` / `qorex#initialized` events.
  - `web/src/wagmi.ts`: a QoreX connector built on that resolver (replaces the RainbowKit wallet's narrower lookup).
  - `web/src/components/QorexConnect.tsx`: "Open in QoreX" on phones without QoreX.
  - Results table below.
- [ ] **3. Create your own NFT (editions)**
  - Contract `contracts/src/QrowEditions.sol` (ERC-1155, + test): anyone creates an edition (URI + supply), the
    creator receives all copies, a small mint fee in fUSD.
  - `web/api/ipfs.ts` + `web/server/ipfs.ts` (Pinata upload, size and type checks, rate limit).
  - `web/src/pages/CreateNftPage.tsx`; Portfolio lists editions (`web/src/lib/portfolio.ts`, `PortfolioPage.tsx`).
- [ ] **4. NFT actions: send + list**
  - `QrowEditions` gains PQ-signed `send`, and a built-in listing book (`list`, `buy`, `cancel`, fUSD).
    Genesis NFTs keep using `QrowMarket` (list and cancel already exist); Genesis send goes through the
    existing PQ transfer if present, otherwise it's listed as a known issue.
  - `web/src/pages/NftDetailPage.tsx` (Send with the first 4 / last 4 address check from Send, List, Delist).
- [ ] **5. 3D tab hub**
  - `web/src/pages/HubPage.tsx` + `web/src/styles/hub.css`: CSS 3D cards (no new dependency): tilt on hover or
    touch, float, click to enter; flat grid under `prefers-reduced-motion` or on low-end devices
    (`deviceMemory`/`hardwareConcurrency`). Becomes `/`; the nav bar stays.
- [ ] **6. Trade tab (swap + perps)**
  - Swap: reuse the native AMM (`web/src/lib/swap.ts`) for QOR ⇄ fUSD.
  - Contract `contracts/src/QrowPerps.sol` (+ test): fUSD margin, long/short, 1–100x, signed price reports,
    liquidation price, PnL, close, liquidate, a small insurance pool funded at deploy.
  - `web/api/price.ts` + `web/server/price.ts` (Binance + AMM price, signed), `web/src/pages/TradePage.tsx`,
    chart with `lightweight-charts` (Apache-2.0), `web/src/config/trade.ts`.
- [ ] **7. AI tab**
  - `web/api/ai.ts` + `web/server/ai.ts` (+ test): price list, credit ledger (Vercel KV / Upstash if set, otherwise
    in-memory with a warning), checks the QOR payment on chain (recipient, amount, not reused), rate limits.
  - `web/src/pages/AiPage.tsx`: chat / image / video, price list, balance, "Top up in QoreX".
  - `web/.env.example` updated.
- [ ] **Phase 1 check**: `npm run build`, `npm test`, `forge test`, deploy (push to main → Vercel), check every tab
  on the live URL at desktop and phone widths.

## Phase 2 — Figma redesign
- [ ] a) File "Qrow — Redesign" · b) design system · c) every screen, desktop + mobile · **d) link + screenshots to
  the owner: STOP for approval** · e) implement and redeploy.

## Phase 3 — Prototype + walkthrough
- [ ] a) Clickable prototype · b) `docs/qrow-walkthrough.mp4` (Figma export, or Playwright on the live site) ·
  c) README "How to use Qrow".

## Mobile wallet test results
| Environment | Result |
|---|---|
| Desktop Chrome + QoreX extension | _pending_ |
| QoreX mobile in-app browser | _pending (needs the owner's phone)_ |
| Plain mobile browser (no QoreX) | _pending_ |

## Env vars the owner sets in Vercel (project `qrow`)
Filled in as each task lands; see `web/.env.example`.
