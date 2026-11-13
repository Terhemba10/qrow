# Qrow build plan

Rewritten 2026-11-12 for the scope updates: payments + NFT marketplace + staking + market news + memecoin launcher + read-only admin. Testnet only (`qorechain-diana`, EVM chain id 9800).

**Key dates (UTC):**
- Q-Day Drill registration: **17 Nov 23:59** (up to 5 contract addresses). Drill: 18 Nov.
- Feature freeze: **28 Nov**.
- Submission: **2 Dec 23:59**.

**Rules (unchanged):**
- Research the docs first.
- Testnet only.
- Credit everything.
- MIT licence, and dependencies are MIT, Apache-2.0, BSD or ISC only.
- Every sensitive action is post-quantum protected.
- The agent never sends anything on its own.
- No admin key can move user funds or NFTs.
- The deployed escrow `0xcf36b836872a0b277919eac1fb976722e32d824b` stays unchanged unless a change is truly needed, and only after asking.

## Platform facts that shape the scope (checked on testnet, 2026-11-12)

### Hybrid PQC
- Every native-lane transaction carries secp256k1 plus ML-DSA-87.
- EVM transactions need a registered ML-DSA key and a scoped window.
- Qrow contracts add an ML-DSA check on each sensitive action through `pqcVerify`, which was proven on chain with payment #1.

### Triple-VM (EVM, SVM, CosmWasm)

| Lane | On testnet today | How Qrow uses it |
|---|---|---|
| **EVM** | Open; `pqcVerify` and `pqcKeyStatus` are live | All Qrow contracts: escrow, NFT collection, market, coin factory |
| **Native (Cosmos) lane** | Open; hybrid-signed, and QoreX signs it today | Staking and staking tiers, PQC keys, EVM windows, `MsgConvertCoin` (fUSD to ERC-20), the AMM (read), the Admin indexer |
| **CosmWasm** | Code upload is governance-only (`code_upload_access: Nobody`). All 50 listed codes have instantiate permission `Nobody`. | **Read only**: CW20 balances (for example the existing WDT token) in Portfolio. Qrow **cannot deploy** CosmWasm contracts. |
| **SVM** | The docs say "The SVM lane is disabled for transactions on both networks" | **Read only**: show the account's unified SVM address and the lane's status in Portfolio. No SVM transactions. |
| **CrossVM** | The `0x…0901` precompile reaches only 3 allowlisted CosmWasm targets | Not usable for Qrow's own contracts. Documented in the README as a limitation. |

So "Triple-VM" in Qrow means the contracts run on EVM, staking runs on the hybrid-PQC native lane, and the app reads CosmWasm and SVM state. No feature claims a deployment that the testnet doesn't allow.

### Staking (`x/stakingtier`, chain v3.2.4)
- Locks are **3, 6 or 12 months only** (`AllowedLockMonths`), with bonuses of 1.5%, 3% and 5% APY.
- An early unlock **burns 5%** of the locked amount and forfeits the bonus.
- The minimum lock is 10 QOR.
- Normal unbonding takes **21 days**.
- Delegation (`x/staking`), rewards (`x/distribution`) and `x/authz` are present.
- The EVM staking precompile is **not active**, and CosmWasm is closed, so **a Qrow lock contract on top of native staking can't be built** on testnet.

### AMM (`x/amm`)
- Constant-product pools exist (fETH/QOR, fUSD/QOR).
- **Creating a pool costs 100 QOR.**
- A pool's tokens are bank denoms. A launched ERC-20 would need a registered token pair first.
- LP tokens can't be locked by an EVM contract.

### Wallets
- QoreX signs native-lane transactions now. That covers staking, which can therefore be signed fully in QoreX.
- EVM transactions are signed by an injected wallet, and ML-DSA messages come from the recovery code, until QoreX ships `eth_sendTransaction` and `signArbitrary`.
- The contracts already verify the QoreSign message format, so that switch needs no redeploy.

## Decisions (each conflicts with what the chain allows)

**Owner decisions, 2026-11-12:** D1, D2, D3 and D5 approved as recommended. D4 not answered yet; the recommendation (drop) stands until the owner decides.

| # | Request | What the chain allows | Recommendation |
|---|---|---|---|
| D1 | Lock-ups of 90 days, 240 days and 1 year | Native 3, 6 or 12 months; a custom lock contract is impossible (no staking precompile, no CosmWasm) | Offer **90 days, 180 days and 1 year**, all native. Drop 240 days. |
| D2 | Pro-rata rewards on early unstake | Base staking rewards accrue per block and stay yours (pro-rata). The tier bonus is forfeited and **5% of the lock is burned**. | Show both on the confirm screen, with the exact numbers from chain parameters, before signing. Qrow can't waive the chain's penalty. |
| D3 | Opt-in capped auto-restake | `x/authz` exists. A capped, expiring `StakeAuthorization` plus withdraw-only permission is possible, but needs a Qrow restaker account with its own PQC key | Build "Claim & restake" plus the reminder alert in step 8. Auto-restake only if step 8 finishes early, default off. |
| D4 | Launch: AMM pool with locked creator liquidity | 100 QOR pool fee, token-pair registration, LP can't be locked by our contracts | **Drop** (it was optional). |
| D5 | Strict order "each step works before the next" vs. the Drill (17 Nov) | Drill points at deployed contracts | Write, test and **deploy QrowGenesis, QrowMarket and QrowCoinFactory by 16 Nov**, ahead of their UI steps, so all four contracts are in the Drill. The UI steps stay in strict order. |

## App layout (owner request, 2026-11-12)

Everything lives inside the one Qrow dApp, each feature in its own tab in the top bar:
**Send · Receive · NFT Shop · NFT Market · Portfolio · Staking · Market News · Launch · Admin**.
- Admin only appears for the allowlisted address after Sign In With QoreChain.
- A tab is added to the bar when its step works end to end, so the app never shows a feature that does nothing.
- On phones the bar collapses into a menu.

## Build order and estimate

Day 0 is 13 Nov. "Days" are working days of build time. Steps that need the owner (wallet actions, API keys, bot token) can wait on them.

| # | Step | Contents | Estimate | Target done |
|---|---|---|---|---|
| — | **Contract sprint for the Drill** (D5) | QrowGenesis (ERC-721, original on-chain SVG art), QrowMarket (fixed price, escrowed NFT, atomic pay, ML-DSA list/buy/cancel), QrowCoinFactory (fixed supply, no owner powers, ≤10% creator share, name blocklist). Foundry tests, leaked-ECDSA tests, deploy, Drill details | 3 | **16 Nov** |
| 4 | Send + Receive | Receive tab: incoming list, countdowns, QoreSeal notice (note field returns), claim with ML-DSA, cancel and refund buttons, request-payment link and QR. The Send polish left over. | 2 | 19 Nov |
| 5 | Alerts + Portfolio | Event watcher plus a Telegram bot for sender and receiver (waiting, 24 h before expiry, cancelled, claimed, refunded, day-5 reminder, overdue, failure). Portfolio: balances (EVM, native, CW20 read, SVM address), NFTs, listings, pending payments, activity, CSV | 2 | 21 Nov |
| — | **Payments core complete** | Must work end to end before continuing | | |
| 6 | NFT Shop | Mint and buy with QOR or fUSD (convert flow), gallery | 1 | 22 Nov |
| 7 | NFT Market | List, floor, buy, cancel. Agent checks: price vs floor, seller lookalike, simulation. Confirm screen | 1.5 | 23 Nov |
| 8 | Staking | Validators, delegate, 90/180/365-day native locks, early-unlock maths on the confirm screen (D2), unbonding notice, Claim & restake, reminder alert, referral link, count and badges (no payouts). Tests | 2 | 25 Nov |
| 9 | Market News | Server-side CoinMarketCap prices (cached, attribution); news from CMC if the free plan allows, otherwise reputable RSS (headline, source, link); "testnet tokens have no value" label | 0.5 | 26 Nov |
| 10 | Launch | Form, impersonation and duplicate checks, simulation, confirm, launched-coins list with safety badges; Send and Portfolio integration | 1 | 27 Nov |
| 11 | Admin & Analytics | Read-only indexer over public events (payments, NFTs, sales, floor, staking, launches), segmented dashboard, Sign In With QoreChain plus an allowlisted address gate | 1.5 | **28 Nov, freeze** |
| 12 | Extras, only if all of 4–11 are done | Scan-to-pay QR, Arabic/RTL, AI history chat, Security page (QoreScan), Keplr/Leap, auto-restake (D3) | — | after the freeze: none |
| 13 | Polish and submission | impeccable audit and polish, webapp-testing end-to-end, hallmark sweep, QCAI audit fixes, README, THREAT_MODEL, AI_USAGE, video | — | 29 Nov – 2 Dec |

**Total for 4–11 plus the sprint: about 14.5 working days in 16 calendar days, with no slack.** Risks, in the order they'd show up:
- The Drill on 18 Nov costs about half a day.
- QCAI audit findings may need contract changes.
- Owner wait times (keys, bot token, wallet steps).
- A QoreX release changing signing.

**Early-warning rule:** if any step ends more than half a day behind its target date, the owner is told that day, together with what moves. No required tab is dropped without the owner's decision.

**Cuts already made:** none to required tabs. Decided by the chain rather than cut: 240-day lock (D1), AMM liquidity lock (D4), CosmWasm and SVM deployments (read only).

## Contracts

| Contract | Status | In the Drill |
|---|---|---|
| QrowEscrow | deployed `0xcf36b836872a0b277919eac1fb976722e32d824b` | yes |

All contracts: **133 Foundry tests pass** (2026-11-12).
| QrowGenesis (ERC-721) | **deployed** `0xb82ba02428506ad69be84ee932c844e0d99bc67f` (1 QOR or 1 fUSD mint, max 256, 5 per wallet) | yes |
| QrowMarket | **deployed** `0x92da580048b7cedfd6d834a0f839d38121fc347b` | yes |
| QrowCoinFactory (and the coins it deploys) | **deployed** `0x3571ac216de6fd72ce8e1d9ecebf79d030142f12`. Supply beyond the creator's ≤10% share is a PQ-signed public claim (0.1% of the pool per address, once) | yes |

Shared rules:
- Every sensitive action takes an ML-DSA-87 signature over QoreSign's message format, bound to chain, contract, action, nonce, expiry and params.
- No owner can touch funds or NFTs.
- Reentrancy guards and checks-effects-interactions.
- Foundry tests for every function and failure path, plus leaked-ECDSA attack tests.
- The QCAI audit covers all of them, and all appear in THREAT_MODEL.md.
- Base code from OpenZeppelin Contracts (MIT), credited. The licence is confirmed before installing.

## Architecture decisions (still in force)

- **Wallet signing.** QoreX connects and signs native-lane transactions. EVM transactions are signed by an injected wallet holding the same account until QoreX ships EVM signing.
- **Post-quantum signatures.** Contracts verify ML-DSA-87 over `qorechain-msg-v1|<chain>|0x<digest>`. Until QoreX ships `signArbitrary`, the key comes from the recovery code, held in memory only.
- **EVM windows.** The smallest scope, closed straight after use.
- **Agent.** Deterministic checks first; one Claude Haiku 5.5 explanation per action; warnings never depend on AI.
- **Sign In With QoreChain.** Gates Admin. The full verifier is tested with the wallet mock, and it's live when QoreX supports `signArbitrary`.

## QR codes (spec 8a, added 2026-11-12)

Request-payment QR and link are built in step 4 (Receive). Scan-to-pay is an extra (step 12).

**Licence rule (from the user, 2026-11-12):** only MIT, Apache-2.0, BSD or ISC licences (ISC approved as an MIT equivalent), never GPL, LGPL or AGPL. Each library's licence is listed in the README Credits, and licences are confirmed before anything is installed.

**Libraries.** Licences were confirmed on 2026-11-12 by installing into a scratch folder with `--ignore-scripts`, reading each package's `license` field and LICENSE file, and scanning the full dependency tree, including `.wasm` files, for GPL/LGPL/AGPL text.

| Library | Use | Licence | Its dependencies |
|---|---|---|---|
| [`qrcode`](https://github.com/soldair/node-qrcode) 1.5.4 | generate the codes | MIT | `dijkstrajs`, `pngjs`: MIT. `yargs` and its helpers are MIT or ISC, but they're only used by qrcode's command-line tool and never ship in the browser bundle. |
| [`barcode-detector`](https://github.com/Sec-ant/barcode-detector) 3.2.3 | scan from the camera or an uploaded image (the standard `BarcodeDetector` API: the browser's own version where it exists, this library elsewhere, e.g. iOS Safari) | MIT | [`zxing-wasm`](https://github.com/Sec-ant/zxing-wasm) 3.1.6: MIT. It contains zxing-cpp (Apache-2.0) and zint (BSD-3-Clause). Also `type-fest`, which is types only: MIT or CC0. |

**Rejected:**
- `@zxing/browser` (MIT): its required dependency `@zxing/library` (Apache-2.0) ships two files ported from OpenJDK, `ByteArrayOutputStream` and `OutputStream`, under **GPLv2 with the Classpath exception**.
- `qr-scanner`: no release since 2022.
- `jsqr`: no release since 2021.

**Implementation notes:**
- The `zxing-wasm` reader binary is self-hosted from the app, not loaded from its default CDN.
- A licence check script runs before every build and fails on any GPL, LGPL or AGPL licence in the production dependencies. It also produces the licence list for the README Credits.

### Payload, version 1

```
qrow:pay?to=<0x address>&amount=<decimal>&token=<symbol>&note=<text>&chain=9800&v=1
```

The parser reads parameters by name, so their order doesn't matter. The generator always writes them in the order above.

| Field | Rule |
|---|---|
| `v` | Required. Only `1` is accepted. Any other value gives **"Unsupported QR version"** and nothing is filled in. |
| `chain` | Required. The EVM chain id: `9800` = testnet `qorechain-diana`, `9801` = mainnet `qorechain-vladi`. It must match the network the app and wallet are on, otherwise the code is blocked (see the network rule below). Any other value is rejected as an unknown network. |
| `to` | A checksummed `0x` address, validated with the custody-kit `validateAddress`. |
| `amount` | Optional. A positive plain decimal (digits with at most one `.`; no sign, exponent, spaces or thousands separators), with no more decimals than the token allows (see the token table below). It's parsed into the token's smallest units as an exact integer, never as a floating-point number. It must be within the sender's per-payment limit and remaining daily limit. If `amount` is present, `token` is required. |
| `token` | Optional, and required when `amount` is present. Only a symbol known on the current network: `QOR`, `fUSD`, `fETH` or `fBTC`, matched exactly. The contract address comes from **our own config**, never from the QR. Anything else is rejected as an unknown token. |
| `note` | Optional. URL-decoded once; malformed percent-encoding is rejected. At most 140 characters after decoding. Shown as **plain text only**: set with `textContent` or React text, never as HTML, Markdown or a link. **Never passed to the AI** as anything but quoted data, so a hostile note can't steer the explanation. |

**Structure:**
- The code is rejected, with nothing filled in, if:
  - any parameter appears twice, for example two `to=`
  - a required field is missing: `to`, `chain` or `v`
  - the scheme isn't `qrow:pay`
- Unknown extra parameters are also rejected, so nothing is silently ignored.

**Tokens:** from our config (`src/config/tokens.ts`). Decimals were confirmed on chain with `decimals()` on 2026-11-12.

| Symbol | Testnet contract (chain 9800) | Decimals |
|---|---|---|
| QOR | native, sent as `msg.value` | 18 |
| fUSD | `0x97143B771D34ddb9130b807b135Ae675A5a963CA` | 6 |
| fETH | `0x02292293c13880a26242690eb70a0e42B8E91c28` | 18 |
| fBTC | `0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A` | 8 |

**Network rule:**
- If `chain` doesn't match the network the app and wallet are on, the code is blocked with a clear message naming both networks, for example: "This request is for mainnet, you're on testnet."
- The app **never switches networks automatically**, and the blocked code fills in nothing.
- The app runs on testnet only, so a `9801` code is always blocked.

**Plain address codes** carry no chain:
- They're treated as the current network, and every check still runs.
- A `0x…` code is accepted as it is.
- A `qor1…` code (for example from the QoreX Receive screen) is converted with `qorToEvm` from `@qorechain/sdk`. It's the same 20-byte account, and the screen shows both forms.

### Screens

- **Request payment.** Fields for amount, token and note. Shows the QR code with the full address as text beside it, a link, a Download PNG button and a Copy link button.
- **Scan QR, on the Send page.** The camera permission is asked for only when the button is tapped. "Upload a QR image" is offered as a fallback, and also shown when camera permission is denied or there's no camera.
- **Receipt QR.** Each signed receipt carries a QR code that opens the transaction on the explorer. It's checked that the explorer shows testnet transactions.

### Safety

A scanned code only **fills in the Send form**. The checks that follow are the same ones as for a typed address: the checking agent (format, PQ key, new recipient, lookalike, risk notes, balance, limits, simulation) and the Confirm screen. The app never sends anything automatically and never skips a check.

Rejected with a plain explanation:
- malformed codes
- unknown schemes or versions
- the wrong `chain`
- unknown tokens
- amounts above the sender's per-payment or remaining daily limit

### Tests

Unit tests for the parser, plus webapp-testing end to end:
- a valid request code
- a `qor1` address code
- a malformed code
- a mainnet (`chain=9801`) code while on testnet: blocked with the "for mainnet, you're on testnet" message, no network switch, form left empty
- an unknown chain id
- wrong version (`v=2`, and `v` missing): "Unsupported QR version", or rejected as missing, with nothing filled in
- an unknown token (`token=USDT`, and a code giving a contract address as the token)
- too many decimals (`amount=1.1234567&token=fUSD`, and `amount=0.000000001&token=fBTC`)
- a zero or negative amount, or one in exponent form (`0`, `-1`, `1e3`)
- an overlong note (141 characters after decoding)
- a note containing HTML or script (`<img src=x onerror=alert(1)>`, `<script>…</script>`): shown literally as text, never run, and nothing injected into the page
- duplicate fields (two `to=`) and missing required fields (`to`, `chain`)
- an over-limit amount
- a **lookalike-address code, which must show the red "Possible scam" block**

## Deployment stage: public testnet (owner request, 2026-11-13). PROPOSAL, awaiting OK

Goal: one public HTTPS link where anyone can use Qrow on QoreChain testnet (`qorechain-diana`, EVM 9800) from a PC
or a phone, for the build.qorechain.io project page. Testnet only, never mainnet. Nothing is deployed until the
owner approves this section.

### Hosting

| Part | Host | Plan | Why |
| --- | --- | --- | --- |
| Frontend (`web/`, static) | Cloudflare Pages | Free | Global CDN, HTTPS, auto-deploy from `main`, a preview link per pull request, 500 builds a month, security headers via a `_headers` file. Static bandwidth isn't billed on Pages (confirm on Cloudflare's pricing page), which matters: the app is ~4 MB and People's Choice voting (6 to 15 Dec) brings traffic. |
| Agent API + REST relay + watcher + light indexer (`agent/`, `watcher/`) | Render, one web service from the `Dockerfile` | Starter, $7/month, always on, plus a 1 GB disk ($0.25/month) | Render's free web services sleep when idle (the first request then takes up to a minute) and free plans can't run background workers or disks, so the watcher would miss events and Telegram alerts. One always-on service runs both processes and keeps their state on the disk. Health checks, deploy notifications, 7 days of logs and instant rollbacks are included. |
| Indexer / database | None separate | | The watcher already back-fills every Qrow contract event; it keeps a small index on the Render disk, and the API serves Portfolio history and Admin & Analytics from it. A database is only worth adding if that index outgrows the disk. |
| Uptime monitoring | UptimeRobot (or Better Stack) | Free | Pings `/agent/health` every 5 minutes and emails the owner. |

Expected cost: about $7.25 a month (Render), everything else free. Free-only fallback: the API on Render's free
plan, accepting cold starts and no Telegram alerts. Not recommended for judging.

### Accounts the owner creates (logins only the owner does; never share passwords)

1. GitHub: a public repo `Terhemba10/qrow` (the fest requires one). Claude pushes `main`; Git asks the owner to sign in.
2. Cloudflare: Pages project connected to the repo (build `npm ci && npm run build` in `web/`, output `web/dist`).
3. Render: Blueprint from `render.yaml`, Starter plan, secrets entered in the dashboard.
4. Anthropic Console (if AI wording is wanted): a key for Qrow only, with a **monthly spend limit** set in the console.
5. Optional: Reown (WalletConnect) project ID; UptimeRobot.

### Secrets and safety

- Secrets live only in Render's environment settings: `ANTHROPIC_API_KEY`, `CMC_API_KEY`, `TELEGRAM_BOT_TOKEN`.
  `contracts/.env` (deployer and Drill private keys) never leaves this PC; the live app needs no private keys.
- The frontend bundle holds public values only: contract addresses, RPC URLs, `VITE_API_BASE` (the Render URL).
- API protection, in place or to add before launch:
  - Done: per-IP rate limits; 16 KB request bodies; GET-only allowlisted REST relay; cached CoinMarketCap (10 min) and news (15 min); daily AI cap.
  - To add: CORS limited to the Pages domain; per-wallet limits where a request names a wallet (AI explain, Telegram linking).
  - Owner: a hard monthly cap on the Anthropic key, set in the Anthropic Console.
  - AI is never required: if the key, quota or cap runs out, every check still shows without the AI wording.
- Security headers: strict CSP, HTTPS only (HSTS), no framing, no referrer. No personal data stored beyond public
  wallet addresses and, for opted-in alerts, a Telegram chat ID. New page: Privacy & Testnet notice.

### Works for everyone, on any device (checked against the QoreX docs, 2026-11-13)

- Desktop: QoreX extension (Chrome, Firefox, Safari on macOS).
- Mobile: open Qrow inside the QoreX app's dApp Browser (Home tab, "Enter a dApp URL"). QoreX injects `window.qorex`
  there, connections are per session, and only `https://` sites connect.
  - In the dApp Browser, QoreX can sign native transactions (staking, opening and closing EVM windows).
  - Its EVM provider is read-only: it does not sign EVM transactions or messages (the desktop extension can't either).
  - So on a phone, Staking works fully and the EVM actions (send, claim, mint, list, buy, launch) need an
    EVM-signing wallet that holds the same key. Qrow says this plainly on the phone and in the How to test page,
    and it goes into the network feedback for QoreChain.
- Friendly screens for no wallet / wrong network: how to install QoreX, switch to Testnet, and get free tokens from
  `dashboard.qorechain.io/faucet`.
- Banner on every page: "Testnet: tokens have no real value."
- New page "How to test Qrow": wallet, testnet, faucet, send to a friend, claim, NFT, stake, launch a coin.
- Telegram alerts for anyone: link a chat to a wallet in @qrow_alerts_bot with a signed proof (a one-time code the
  wallet signs on chain or in QoreX), opt-in, `/unlink` anytime.
- Admin & Analytics behind Sign In With QoreChain plus the owner's allowlisted address.

### Process

- Every push to `main` auto-deploys (Pages and Render); pull requests get Pages preview links.
- First public version as soon as approved (Send and Receive already work end to end); then update after every stage.
- Roll back: Render "Rollback" on a previous deploy; Cloudflare Pages "Rollback to this deployment". Both are instant.
- Before the 28 Nov freeze: test the live link on Chrome desktop and in the QoreX phone app, run the end-to-end
  tests against the live URL, fix what breaks.
- Hand-off: live URL, accounts and settings, rollback steps, and "What judges should try first" in the README and
  on the project page.

### First-run experience (owner request, 2026-11-13)

Journey for a brand-new visitor, desktop or phone, testnet only. Built tab by tab; tested on the live link with a fresh
wallet on desktop and phone before the 28 Nov freeze.

1. **Landing → Connect:** one-sentence pitch, the testnet banner, one button **Connect QoreX**; address shown with the
   first and last 4 characters highlighted, balances right after. Before connecting, every tab shows "Connect your
   QoreX wallet to use this" instead of empty data.
2. **"Ready to test?" card** (runs after connect), each item with a live status and a fix:
   QoreX installed (link to qorechain.io/qorex) · on Testnet (explain Settings → "Use testnet (developers)"; never
   switch for them) · has test QOR (**Get test tokens** → dashboard.qorechain.io/faucet, free, once per 24 h; re-check
   on return) · ML-DSA key registered (QoreX registers it with the first transfer: offer a tiny self-transfer) ·
   EVM window (Qrow's own "Open window in QoreX" button) · fUSD on the EVM side (one-click **Convert fUSD**,
   MsgConvertCoin signed in QoreX).
3. **"Try Qrow" checklist** (collapsible, saved per wallet in local storage, ticks itself from on-chain events,
   "5 of 9 tried"): Send, Receive, Portfolio, NFT Shop, NFT Market, Staking, Market News, Launch, Alerts. Each task
   links to its screen with a one-line hint.
4. **Every tab works for a stranger:** teaching empty states; every action is checking agent → confirm → the user
   signs; plain-language errors with the fix (fees, window closed, wrong network, key not registered, rejected).
   **"Test with a demo recipient"** for solo testers (see open question C).
5. **Feedback button** on every page → a GitHub issue template (no personal data needed).

#### Facts from the QoreX docs that change parts of this (checked 2026-11-13)

- QoreX (extension and app) **never sends EVM transactions**. QoreChain's documented flow is: open the EVM window in
  QoreX, then send from MetaMask (or another EVM wallet) holding the same account. So "the user signs in QoreX" holds
  for native actions (staking, windows, fUSD conversion, alerts linking); EVM actions are signed in MetaMask. The
  "Ready to test?" card gets a MetaMask item, and the How to test page shows how to hold one testnet account in both
  wallets (create it in MetaMask, restore that phrase into QoreX; a fresh testnet-only wallet).
- QoreX registers the ML-DSA key automatically with the first transfer; websites can't ask it to register.
- QoreX does **not** support message signing (`signArbitrary`), and gives users no QRC1 PQC recovery code.

#### Open questions for the owner

- **A. DECIDED 2026-11-13: Qrow app key (option 1).** Implemented as `QrowKeys` (shared registry). Original question:
  per-action ML-DSA signatures for QoreX users. Qrow's contracts verify an ML-DSA signature
  (`pqcVerify`) against the key registered on chain. QoreX holds that key and won't sign messages, so a QoreX user
  can't authorise Send, Claim, Mint, List, Buy or Launch today. Only accounts with a QRC1 code (Qrow's script
  accounts) can. Options:
  1. *Recommended:* a **Qrow app key**. Qrow generates a separate ML-DSA-87 key in the browser, shown once as a QRC1
     code to save. It's registered once in Qrow's contracts by a transaction inside a QoreX-opened window, and from
     then on every action is still checked with `pqcVerify`, against that key. Needs a contract change and a
     redeploy of all four Qrow contracts (escrow, Genesis, Market, Coin Factory), new tests, and a fresh demo run,
     before the Drill registration on 17 Nov. About a day.
  2. Wait for QoreX message signing: core tabs stay unusable for QoreX users until it ships (no date).
  3. Ask users for their 24 words so Qrow can derive the key: **rejected**. It hands a website full control of the
     account and is exactly what phishing sites do.
- **B. Staking terms:** the chain offers 3, 6 and 12 months only, so "240 days" can't be offered; Qrow keeps
  90 days / 180 days / 1 year (decision D1).
- **C. Demo recipient:** auto-claiming needs a server-held key for a dedicated testnet demo account (it signs claims
  and opens its own windows). That's an exception to "no private keys on servers": a separate account holding only
  fee dust, never the deployer or Drill keys. Needs the owner's yes.
- **D. Sign In With QoreChain** for Admin: to check how SIWQ proves ownership when QoreX has no message signing
  (likely a signed native transaction); confirmed when Admin is built.


## Launch priority (owner, 2026-11-13; overrides earlier ordering)

Goal: real people using Qrow on QoreChain testnet as early as possible, to grow usage and collect feedback.

1. **App key + redeploy.** `QrowKeys` registry; escrow, Genesis, Market and Coin Factory take its address and check the
   app key first, then the chain key. Status 13 Nov: contracts and 14 new tests done (150 pass). Next: deploy all
   five contracts, on-chain smoke tests, new addresses to the owner for the Drill (registration closes 17 Nov 23:59 UTC).
2. **Public beta v0.1** as soon as Send and Receive work end to end for a normal QoreX user (connect → readiness
   checklist → app key → send → claim, cancel or refund → alerts), on the approved hosting, labelled
   **"Public beta: testnet"**. Unfinished tabs show "Coming soon", never hidden or broken.
3. **Ship tabs live as they finish:** Portfolio, NFT Shop, NFT Market, Staking, Market News, Launch, Admin & Analytics,
   each deployed the day it passes its tests. The live link must always work.
4. **Feedback loop:** Feedback button → GitHub issue template; reviewed daily, top issues first; public changelog page.
5. **Usage stats** (Admin & Analytics, README): unique wallets, payments, claims, NFTs minted and listed, stakes,
   coins launched. Public on-chain events only.
6. **Launch kit for the owner** (Claude posts nothing): an X post with #BuildBeforeQDay and the link, a message for
   QoreChain's Discord and Telegram, a 30-second screen recording of send → claim, and the How to test Qrow guide.

### Dates (estimate, 13 Nov)

| When | What |
| --- | --- |
| Fri 14 Nov | Redeploy all Qrow contracts with the app key; on-chain smoke tests; addresses to the owner for the Drill |
| Fri 14 to Sat 15 Nov | Web: app-key setup, readiness card, beta banner, Coming soon tabs, Feedback, How to test, Privacy |
| **Sun 16 Nov** | **Public beta v0.1 live**, if by Sat 15 Nov the owner has the GitHub repo, Cloudflare and Render accounts ready and has done one real QoreX + MetaMask send → claim on the staging link |
| Then daily | One tab live per passing day; feedback triage |

Risks: QoreX or MetaMask behaving differently from the docs on a real account (only testable by the owner); Render disk
permissions on the first deploy.


### Hosting change (owner, 2026-11-13): Vercel instead of Cloudflare Pages

The owner has a Vercel account. Supersedes the Pages row and the Render web service above.

| Part | Host | Notes |
| --- | --- | --- |
| Frontend (`web/`) | **Vercel** (Hobby) | Auto-deploy from `main`, a preview URL per pull request, HTTPS, instant rollback, security headers in `vercel.json`. |
| Agent API + REST relay (`/agent/*`, `/lcd-testnet/*`) | **Vercel Functions**, same domain as the app | Stateless request/response, so they fit. Same origin, so no CORS and the CSP stays `'self'`. CoinMarketCap and news cached at Vercel's edge (`s-maxage`), so prices cost one call per 10 minutes per region, not per visitor. In-memory rate limits only last per function instance, so the hard AI ceiling is the Anthropic Console spend limit (owner sets it) plus a per-instance cap. |
| Watcher (Telegram alerts) | **Render background worker** (Starter, $7/month + 1 GB disk) | Vercel can't run it: it holds a WebSocket and long-polls Telegram all the time. |

Owner accounts: GitHub (repo), Vercel (import the repo), Render (worker only), Anthropic Console (spend limit).
Order (owner, 13 Nov): v2 redeploy ✓ → Send + Receive for a QoreX user → push to GitHub after the owner's OK →
Vercel deploy → live URL to the owner.

Implemented 13 Nov: the agent API and REST relay moved to `web/server` and run as Vercel functions (`web/api`);
`agent/` is now only the local dev server for the same code; Render runs only the watcher (`render.yaml`,
`Dockerfile`). Details and env vars: `docs/DEPLOY.md`.


## Live-user rules (owner, 2026-11-13)

1. Users never create, copy, paste, save or import any key, phrase or recovery code. They open the site, connect
   QoreX, use free test QOR, and sign in their wallet. Server-side keys live only in hosting env vars.
2. Every transaction is signed in QoreX if at all possible (research below; design awaits the owner's OK).
3. Every tab testable with free test QOR and fest tokens from dashboard.qorechain.io/faucet. Landing line: "Try every
   feature with free test QOR. Every transaction you make helps test and improve QoreChain before Q-Day." (done)
4. "Built in Doha, Qatar, Middle East" in the footer and How to test page (done); README "About the builder" (done);
   submission: select **Qatar** as the country (Middle East & Africa region, Regional Award). The owner fills in the form.
5. QoreChain-ecosystem look: QoreX palette (navy, soft-border cards, cyan-to-purple gradient buttons, teal
   addresses), Qrow's own logo only. Done with the brief's values; all 25 text/background pairs pass WCAG AA in
   `brand/src/build-tokens.mjs`. To do: sample exact values once `brand/reference/qorex-palette.png` is added.

### Research: can QoreX sign everything? (13 Nov, with sources)

| Question | Answer | Source |
| --- | --- | --- |
| Can QoreX send an EVM transaction? | **No.** Its EVM provider rejects `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4` ("not yet supported"). | `@qorechain/qorex-types` 0.1.0 (latest on npm); docs.qorechain.io/qorex/dapp-browser |
| Can it sign a message for `pqcVerify`? | **No.** `signArbitrary` is "present but refused in current builds". | same |
| Can it sign native-lane messages? | **Yes**, `signAndBroadcast`, with the hybrid secp256k1 + ML-DSA-87 signature; it refuses key-management messages and types it can't display. | same |
| Can a native message call an EVM contract? | **Yes, on testnet:** `/qorechain.crossvm.v1.MsgCrossVMCall` runs "as your own `0x` address" (`msg.sender` is the user); no EVM window is needed for a call the sender signs itself. No QOR can be attached (`funds` is only for Native targets). | docs.qorechain.io/developer-guide/cross-vm-reference |
| Does it really work? | **Proven 13 Nov** with a script account (same hybrid signing as QoreX), no window open: `fUSD.approve(escrow, 12345)` via MsgCrossVMCall, tx `383E0DA437F912638A0E1E157C81DA584BE25DE1C77C22FC7D21E31AF2345F98`; allowance read back = 12345. Quirk: `source_vm` must be a known VM name (`cosmwasm` or `svm`) although the chain ignores it. | `contracts/scripts/crossvm-probe.ts` |
| Will QoreX itself sign MsgCrossVMCall? | **Unknown** until the owner runs `/dev/qorex-check` in a browser with QoreX (harmless `fUSD.approve(escrow, 0)`). | |

### Proposed design: QoreX only (awaiting the owner's OK)

- **Every EVM action** (send, claim, cancel, refund, mint, list, buy, launch, claim coin, register a device key) is a
  `MsgCrossVMCall` signed in QoreX. No MetaMask and no EVM windows: the account's EVM lane stays shut, which is
  stronger for the Q-Day Drill (a leaked classical key can neither open a window nor sign a native transaction).
- **`pqcVerify` stays** (category requirement and defence in depth): each device holds an invisible Qrow *device key*
  (ML-DSA-87), created automatically on first connect, stored encrypted under a passkey (WebAuthn PRF: fingerprint,
  face or PIN prompt) and never shown or exported. Where PRF isn't supported, a non-extractable browser key protects
  it (weaker against a compromised page; the UI says so).
- **Contract change (QrowKeys v3; needs a redeploy of all Qrow contracts before the Drill registration on 17 Nov):**
  several device keys per account. The first registers instantly (one QoreX transaction). A new device is added
  instantly if an existing device approves it, otherwise after a 3-day wait that any device or the account can
  cancel, with a Telegram alert. No recovery code anywhere.
- **Limits:** cross-VM calls can't carry QOR, so payments, mints and listings use fest tokens (fUSD, fETH, fBTC); QOR
  stays for fees and staking. Faucet fest tokens arrive as bank coins: one-click Convert needs `MsgConvertCoin`,
  which the SDK doesn't build; whether QoreX signs it is still to be tested.
- Staking already signs in QoreX. The readiness card and How to test page change to: QoreX installed, testnet, test
  QOR and fUSD, quantum-safe key registered (first transfer), device key (automatic).

## Scale to 3k (owner, 2026-11-13; reduced from 15k). Plan and costs, awaiting OK

**Assumptions:** 3,000 users over the fest; peaks of 200 to 400 online (right after a link is posted and during
People's Choice, 6 to 15 Dec); a visitor does about 5 actions and 50 page views.

| Area | Bottleneck at 3k | Fix |
| --- | --- | --- |
| Frontend | One 3.9 MB JS bundle (minified, before gzip) | Code-split per tab, lazy-load wallet libraries, target under 2 MB first load; hashed assets cached a year (done) |
| Our API | Per-instance caches and limits on Vercel | Fine at this size with edge caching (done); a shared Redis store only if the load test shows duplicate upstream calls |
| CoinMarketCap | Each region's cache fetching on its own | Edge cache 10 min (done): worst case a few fetches per window, well under 10,000 credits a month |
| AI | Cost and latency | Never blocks (checks show first); per-IP limit (done) plus 10 per wallet per day; daily cap; Anthropic Console monthly cap |
| Chain reads | Browsers polling public endpoints; QoreChain publishes no limits | Slower polling, paused in background tabs; shared lists (listings, floor, history, coins) from the indexer; back-off on errors |
| Indexer | Portfolio, history and market scan the chain from every browser | One indexer beside the watcher on the always-on Render service, SQLite on its disk, paginated read API cached at the edge |
| Watcher | Telegram limits (about 30 messages a second, 1 a second per chat) | Send queue with retry and back-off; opt-in only |
| Monitoring | None yet | UptimeRobot on /agent/health; Telegram alerts to the owner; status line in the app; runbook |

**Load testing:** `autocannon` (MIT) against a Vercel preview with 400 concurrent connections (peak) and a 1,000
burst, on reads and API routes; writes only as a small manual sample. Report: p95, errors, first failure, fixes.

**Costs (nothing paid without the owner's OK):**

| Item | At 3k users | Monthly |
| --- | --- | --- |
| Vercel Hobby (app and API): 100 GB transfer, 1M function calls, 4 h active CPU | Fits comfortably with edge caching | $0 |
| Render Starter: watcher, indexer and read API, 1 GB disk | Needed for always-on alerts and the indexer | about $7.25 |
| Anthropic, Claude Haiku 5.5 ($0.10/M input, $0.50/M output) | about 15k explanations at about $0.0002 | about $3, capped at $10 |
| CoinMarketCap free plan | a few thousand of 10,000 credits | $0 |
| Redis | Only if the load test needs it (free tier) | $0 |
| **Total** | | **about $7.25 base, about $10 with AI** |

Draft message for QoreChain's Discord about endpoint limits: `docs/LAUNCH_KIT.md`.


## Research: AMM, test tokens, convert, QOR (13 Nov, all on testnet with hybrid-signed native transactions)

**Native AMM (`qorechain.amm.v1`)**: enabled; constant-product pools; swap fee 0.30% (of which 0.10% protocol fee);
pool creation fee 100 QOR; max swap impact 5% (`max_swap_impact_bps` 500, enforced by the chain); min liquidity
1,000. Messages (SDK `msg.amm.*`): `swapExactIn`, `swapExactOut`, `addLiquidity`, `removeLiquidity`, `createPool`.
Pools read with `GET /qorechain/amm/v1/pools`. LP shares are bank coins `amm-lp/<id>` (6 decimals).

| Pool | Pair | Reserves (13 Nov) |
| --- | --- | --- |
| 1 | fETH / QOR | 0.000000000000979 fETH / 1.02 QOR (dust) |
| 2 | fUSD / QOR | 601 fUSD / 5,989 QOR (the useful one: about 0.1 fUSD per QOR) |
| 3 | fETH / fUSD | 0.15 fETH / 338 fUSD |
| 4 | fBTC / QOR | 0.015 fBTC / 11,636 QOR |
| 5 | fBTC / fUSD | empty |

**Test tokens**: fUSD `erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA` (6 decimals), fETH
`erc20:0x02292293c13880a26242690eb70a0e42B8E91c28` (18), fBTC `erc20:0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A`
(8), all registered token pairs (`/cosmos/evm/erc20/v1/token_pairs`). No "fUSDT" exists. **No ERC-20 form of QOR**
is registered.

**Faucet** (docs.qorechain.io/dashboard/faucet): 100 QOR plus 1,000 fUSD, 0.5 fETH, 0.02 fBTC per claim (as of
27 Oct); once per 24 hours per account and per address; Dashboard sign-in; `qor1…` addresses only; fest tokens arrive
as **bank coins**.

**Proven on chain (deployer, hybrid signature, `scripts/amm-probe.ts`)**:
- Swap 0.1 QOR → 0.010006 fUSD on pool 2 (exactly the constant-product quote): tx `39FAA0F1…D3D99F`.
- Convert bank fUSD → ERC-20 with a hand-encoded `/cosmos.evm.erc20.v1.MsgConvertCoin` (coin, receiver 0x, sender
  qor1): tx `19B5FBFA…0154F8`, 442,763 gas.
- Convert ERC-20 → bank with `/cosmos.evm.erc20.v1.MsgConvertERC20` (contract, amount, receiver qor1, **sender qor1**,
  not 0x): tx `50A2771B…DF65FA`, 432,038 gas. Neither message is built by the SDK; Qrow encodes them itself.
- A plain bank send of QOR to a contract's address credits its EVM balance (1 uqor = 10^12 wei): tx `FB15427D…336049`.

**What that means**
- Swap and Liquidity are native messages QoreX signs directly (if QoreX displays them; part of the owner's QoreX check).
- Paying in fUSD/fETH/fBTC works today: faucet bank coins → Convert → escrow/NFT contracts (cross-VM).
- **Paying in QOR** can't go through a cross-VM call (no value attached) and QOR has no ERC-20 form. It *can* work
  as one native transaction with two messages: a bank send of the QOR to the contract, then the cross-VM call that
  books it (`createPaymentQor`, `mintQor`, `buyQor`), atomic in one transaction. That's a contract change (v4):
  proposed for **after the Q-Day Drill** (18 Nov), so the Drill tests the v3 addresses already registered.

## Swap tab (after the payments core)

Swap QOR, fUSD, fETH, fBTC (and launched coins that have a pool) on the native AMM, signed in QoreX.
- Direct pools only: if no pool exists for the pair, say so; never route through unknown tokens.
- Live quote from reserves (constant product, 0.30% fee), price impact, minimum received with slippage (default 0.5%,
  warn above 3%, block above 15%; the chain itself refuses impact above 5%), "rate updated" refresh.
- Checking agent: balance plus fee, pool exists and has liquidity, impact warning, simulate (`/cosmos/tx/v1beta1/simulate`).
- Converts where needed: AMM pools hold bank coins; contracts need ERC-20. Convert is offered in one click.

## Earn: Staking + Liquidity

- **Liquidity tab:** add/remove liquidity on native pools (pool share, reserves, fee explanation, impermanent loss in
  plain words), optional pool creation for a launched coin vs QOR or fUSD (100 QOR creation fee, shown up front).
  Positions (`amm-lp/<id>` balances) appear in Portfolio.
- **Staking:** QOR only (native staking); fUSD holders are pointed to Liquidity.

## Pay with QOR or fUSD across the app

- fUSD/fETH/fBTC: now (Convert + cross-VM).
- QOR: v4 contracts after the Drill (bank send + cross-VM in one transaction, see above).
- NFT Shop/Market: listing currency chosen by the seller; floor per currency plus an approximate value in the other
  (pool rate, labelled approximate); "Swap first" opens Swap prefilled.
- Launch: coin pools against QOR or fUSD. Request-payment QR keeps the token (config tokens only).
- Token addresses and denoms only from config, never from user input or QR codes.

## Faucet tab (with the payments core)

Link to https://dashboard.qorechain.io/faucet (new tab, `rel="noopener"`); never embedded, proxied or automated.
Shows the `qor1…` address with first/last 4 highlighted and **Copy address**; steps (sign in on the Dashboard,
Testnet, "Use my address", Request Tokens); the documented amounts and the 24-hour rule; a gentle balance watcher
that shows "Tokens received ✓" with the amounts, then next steps (Convert fUSD, Swap, Send, NFT). "Next claim in…"
only if a faucet payment can be read from chain, otherwise the 24-hour rule. Label: "Test tokens have no real value."
Linked from the readiness card and How to test. Analytics: tab visits (aggregate count, no personal data) and
"tokens received after visiting" from public chain data.

## Rule for every tab: every transaction carries a verifiable hash

- Store and show the **native transaction hash** (what explore.qore.network searches by), block height, time, status
  (pending / confirmed / failed with the plain reason) and the contract or module. With QoreX every Qrow transaction is
  a native transaction (cross-VM calls included), so the native hash is the one to verify; a separate EVM hash
  exists only for the rare EVM-wallet transaction and is shown too when there is one.
- "Pending" with the hash right after signing; "done" only once confirmed on chain.
- Shown everywhere (success screens, payment timeline, history, Portfolio, NFT and coin pages, staking positions,
  Admin) as first/last 6 with Copy and View on explorer, plus the note "Explorer: switch to Testnet if it opens on
  mainnet". Telegram alerts, sealed notices, receipts (and receipt QR) and CSV exports include it.
- Qrow reference IDs (`QRW-PAY-000123`, `QRW-NFT-000045`, `QRW-SWP-…`) map to the chain of hashes (create, then
  claim/cancel/refund) shown on the detail page.
- **Verify page** (no wallet): paste a hash or reference → fetched from the chain, not our database: status, block,
  time, from/to, amount/token, which Qrow contract/action, receipt signature check; flags non-Qrow, mainnet and
  malformed hashes.
- Tests for each action type, pending → confirmed and failed, and the Verify page (valid, unknown, mainnet, malformed).
- Built into each tab as it's made, not as a later stage.

## Updated estimate (13 Nov)

| Days | Work |
| --- | --- |
| 0.5 | Faucet tab, Convert helper (both directions), hash display + Verify page groundwork |
| — | **Public beta v0.1** as soon as the owner runs the QoreX check and imports to Vercel |
| 1 | Swap tab |
| 1 | Liquidity tab (Earn) + LP positions in Portfolio |
| 1 | Hash rule across tabs, reference IDs, Verify page, receipts |
| 1.5 | v4 contracts for QOR payments (after the Drill, 19 Nov) + web |
| 1 | NFT Shop/Market in both currencies + Swap first |
| 1 | Staking, Launch, NFT tabs live (tested with a QoreX account) |
| 1.5 | Admin & Analytics + indexer on Render (state-based) |
| 1 | Scale: code-splitting, load test, monitoring, status line |
| 1 | Submission: README, THREAT_MODEL, AI_USAGE, video script, final tests on the live link |
| **≈ 10.5** | **finishing about 25 to 26 Nov**, before the 28 Nov freeze, if the owner's QoreX check passes |

Risk: if QoreX refuses to display `MsgCrossVMCall`, AMM or convert messages, the QoreX-only design needs a fallback;
that's the first thing the owner's check answers.


## QoreX check results and the proposed fallback (13 Nov) — awaiting the owner's OK

**Owner's QoreX check** (account `qor1tvke…qjdd5f`):
1. `MsgCrossVMCall`: refused ×3 ("QoreX cannot show what /qorechain.crossvm.v1.MsgCrossVMCall does, so it will not sign it").
2. AMM swap 0.01 QOR → fUSD: **signed**, tx `4A676D5F23…E3CD`, code 0.
3. `MsgConvertCoin`: refused (same reason).

So Swap and Liquidity stay QoreX-only. Contract actions and Convert need another route.

**Proven on chain 13 Nov (script accounts, `scripts/authz-probe.ts`):**
- `x/authz`: an account can grant another key permission for `MsgCrossVMCall` and `MsgConvertCoin`
  (tx `EE52AD48…5BAC`), and revoke it (tx `9E3190E5…A0E`).
- The grantee converted the granter's bank fUSD to ERC-20 *as the granter* with `MsgExec` (tx `5E7C1AC8…6238`).
- The grantee's cross-VM call as the granter was **refused** while the granter had no EVM window: "did not send this
  call itself, and its EVM authorisation window does not admit it".
- With a window the granter opened (1 tx, fUSD only), the same `MsgExec` **ran** as the granter
  (tx `099ED9DC…D503`, allowance 10,000 → 7) and used the window up (0 txs left).

**Proposed design ("QoreX authorises, this device executes"):**
- Each browser gets a small **Qrow device account** (secp256k1 + ML-DSA-87, created behind a passkey, never shown).
  It registers its own quantum-safe key on chain, so everything it signs is hybrid-signed.
- **Set up once per device (QoreX, one confirmation):** send the device account about 1 test QOR for its network fees,
  and grant it permission for `MsgCrossVMCall` (30 days). The device key is also registered in `QrowKeys`.
- **Each protected action (send, claim, cancel, mint, list, buy, launch):**
  1. QoreX opens a short EVM window: only the contracts this action touches, only the transactions it needs,
     about 10 minutes, signed with the user's ML-DSA-87 key.
  2. The device signs the `pqcVerify` authorisation (passkey prompt) and runs the calls as the user (`MsgExec`).
  The window bounds everything: without it, the device key can do nothing on the EVM; with it, only the approved
  contracts and transaction count.
- **Convert:** the convert permission isn't bounded by a window and `MsgConvertCoin` names its own receiver, so a
  stolen device key could redirect tokens while that grant lasts. It's therefore granted only together with a
  convert, expiring after 10 minutes, then revoked.
- Swap, Liquidity and Staking: plain QoreX (native messages it already signs).
- Quantum-safe throughout: windows and grants need the user's ML-DSA-87 signature; the device account's own
  transactions are hybrid-signed; Qrow's contracts still check `pqcVerify`. A leaked classical key of either account
  can't open a window, sign a native transaction or produce a device signature. The Q-Day Drill design is unchanged.
- No MetaMask, no recovery phrases, nothing to copy or save.

**Still unknown (owner's QoreX check, tests 4 and 5):** whether QoreX signs `MsgGrant` (authz), and whether a dApp can
ask it to open an EVM window. If the window can't be requested by the site, users open it in QoreX (Settings →
Security → EVM access window) before each protected action; the app shows the exact settings to use.

**Rejected alternative:** MetaMask holding the same account (QoreChain's documented flow) means importing a recovery
phrase into a second wallet, which the live-user rules forbid.


## Public beta live (13 Nov)

**https://qrow-app.vercel.app** (Vercel project `qrow`; `qrow.vercel.app` was taken). App, agent API and REST relay
on Vercel; details, env vars and rollback in `docs/DEPLOY.md`. Verified from the in-app browser (not the dev server)
at desktop and phone width: pages, news headlines, chain reads through the relay, a signed-transaction broadcast
reaching the chain, security headers, no dev page in the bundle.

Honest beta: live by default only Portfolio (read-only) and Market News. Coming soon, in this order as each works
end to end: Faucet, Swap, Verify a transaction (being built), then Send, Receive and other contract actions once the
owner's QoreX passes the grant and window checks (tests 4 and 5) for the device-account fallback.

Owner steps open: GitHub login connection in Vercel (auto-deploy on push), `CMC_API_KEY` in Vercel, Render account
for the watcher, QoreX checks 4 and 5, testing the live link on desktop Chrome with QoreX and on a phone.
