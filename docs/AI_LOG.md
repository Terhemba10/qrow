# AI usage log (raw notes for AI_USAGE.md)

Running log kept during the build. Each entry: what was asked, what AI (Claude Code, Opus 5.5) produced, what the human decided or changed.

## 2026-11-12 — Stage 1: research + plan

- **Prompt (human):** full Qrow brief (escrow dApp, PQ-protected actions, checking agent, QoreSeal inbox, Telegram alerts, AR/RTL, submission package).
- **AI did:** read build.qorechain.io rules/kits, docs.qorechain.io EVM + precompiles + PQ security pages, and the source of `@qorechain/qorex-types`, `@qorechain/qorex-rainbowkit`, `@qorechain/evm`, `create-qorechain-dapp` templates.
- **AI findings that changed the brief:**
  - QoreX does not yet answer EVM signing methods (`eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`) or `signArbitrary` → EVM txs signed by an injected wallet; QoreX used to connect/read.
  - ML-DSA-87 signatures for `pqcVerify` produced in-app from the account's PQC recovery code (QRC1), never stored.
  - Exact precompile ABIs: `pqcVerify` @ `0x…0A01`, `pqcKeyStatus` @ `0x…0A02` (requires `possessionProven`).
  - Q-Day Drill registration deadline (17 Nov) → contract deployed before logo work.
  - "Two-stage QCAI audit" not publicly documented; human to confirm the submission route.
- **Human decision:** approved plan with all recommended options (injected-wallet signing + in-app ML-DSA, contract first, Foundry, user funds their own accounts and fills `.env`).

## 2026-11-12 — Stage 3a: escrow contract + tests (written, not yet run)

- **AI generated:** `contracts/src/QrowEscrow.sol`, `IQorePQC.sol` (precompile wrappers that fail closed), Foundry tests (`QrowEscrow.t.sol`, `QDayAttack.t.sol`), mocks for the 0x0A01/0x0A02 precompiles and hostile tokens/contracts, and scripts (`window.ts` adapted from the create-qorechain-dapp foundry template, `deploy.ts`, `pq-selftest.ts`).
- **Design choices made by AI (approved plan):** ML-DSA-87 signature on every sensitive action, bound to chain id, contract, action, signer, per-signer nonce, ≤1h expiry and all params; `refundExpired` callable by anyone but pays only the sender; refunds to contracts that reject QOR become a pull credit; per-sender/per-token limits; no owner.
- **Verified by AI:** compiled with solc-js 0.8.28 (0 errors, 0 warnings). Foundry install was blocked by the agent's permission policy (remote installer script) → human to install.
- **Bug caught during compile:** precompile address literals needed EIP-55 checksum casing.

## 2026-11-12 — Stage 2a: logo directions (awaiting pick)

- **Human (hallmark ask-once):** tone austere; colour left to Hallmark; audience everyday senders; no material yet.
- **AI:** dealt three Hallmark themes and picked Coral (warm stationery paper, near-black ink, coral only for the settled state). Hand-wrote three SVG directions in `brand/src/marks.mjs` (A Sealed, B Return, C Lattice) plus custom monoline wordmarks, and generated `brand/preview.html`.
- **Checks:** impeccable detector (one cream-palette warning, waived because it's the dealt theme), Hallmark sloplint (3 FAIL for middle-dot score strings fixed; 1 REFLEX waived because there are no controls), and a logo-specific critique per direction, done in a single context rather than with dual sub-agents.
- **AI revision after looking at the render:** slimmed the Return loop because it read as a speech bubble.

## 2026-11-12 — Stage 2b: logo chosen, exports and tokens

- **Human decision:** picked **B. Return** (the AI's recommendation).
- **AI generated:** the export pipeline (`brand/src/export.mjs`, resvg rasteriser, a hand-written ICO writer), all logo files, the 1200×630 featured image, and `tokens.css`/`tokens.json` with a built-in WCAG contrast check (28/28 pairs pass AA in light and dark).
- **AI caught:** the General Sans licence (ITF FFL) forbids redistribution, so the font files are git-ignored and the app will load them from the Fontshare CDN. Coral is kept apart from the safety colours (amber caution, crimson scam) so "settled" can't be mistaken for "danger".
- **AI revisions after looking at the renders:** featured-image mark moved so it no longer overlapped the headline; a heavier stroke cut for 16/32 px.
- **Open point for the human:** at large sizes the pointed tail can read as a speech bubble.

## 2026-11-12 — Stage 3b: tests run (Foundry 1.9.0, installed by the human)

- First run: 82/84 passed. AI fixes: (1) a test bug, where `expectEmit` was armed before the helper's own calls; (2) the contract now reverts with a clear `InvalidToken` error for a token address with no code (before, it was an empty revert). The behaviour is unchanged.
- Result: **84/84 pass**. Coverage of src: 100% lines, 98.9% statements, 95.2% branches, 100% functions.
- `forge lint` triage by AI: block-timestamp, unsafe-typecast and arbitrary-send-eth were reviewed and dismissed (7-day deadlines; uint64 time; payouts only go to the recorded sender or recipient). The reentrancy-eth/no-eth warnings are false positives: every state-changing function holds the same lock. **One real point:** in `createPayment` the token is pulled before state is written (to support fee-on-transfer tokens). Proposed a strict checks-effects-interactions change, awaiting the human's decision.

## 2026-11-12 — Stage 3c: CEI, QoreSign message format, account tooling

- **Human decisions:** strict checks-effects-interactions; then the "recommended path" for signing (the contract is ready for QoreX's planned `signArbitrary`, and fresh script-made accounts are used for tests and the Drill). Rule: connect via QoreX and never ask for keys or recovery phrases.
- **AI:**
  - `createPayment` now records state before pulling tokens and rejects non-standard tokens (`NonStandardToken`).
  - The contract verifies ML-DSA over QoreSign's `messagePqSignBytes` (`qorechain-msg-v1|qorechain-diana|0x…`). The constructor takes the native chain id. New `PqMessage.t.sol`.
  - Byte-for-byte check against `@qorechain/qoresign` 0.2.0 with a real ML-DSA-87 signature (`scripts/check/pq-message-compat.ts`).
  - `account-new.ts` writes fresh secrets straight to `.env` and prints only addresses.
- **AI investigation of the owner's wallets** (read-only): verified `qor1↔0x` with the SDK. Found that Wallet 1 has a Cosmos-style secp256k1 account key, so it can't send EVM transactions; Wallet 2 isn't on chain yet. Recorded in `docs/TEST_NOTES.md`.
- Tests: **90/90 pass**.

## 2026-11-12 — Stage 3d: testnet deployment

- **Human:** funded the deployer, the Drill account and Wallet 2 from Wallet 1 via QoreX, and authorised the registrations, the self-test, the deploy and closing the window.
- **AI ran:**
  - registered both ML-DSA keys
  - ran the live `pqcVerify` self-test (pass)
  - built and tested the contract (90/90)
  - opened a 1-tx window, deployed `QrowEscrow` at `0xcf36…824b`, and closed the window at once
  - verified that the on-chain bytecode matches the local build
- **AI caught:**
  - The faucet hadn't reached the fresh addresses. The AI checked the chain's sync and tx search before telling the human, then suggested funding from Wallet 1.
  - Wallet 2's QoreX key registration never reached the chain.
  - viem rejects the mixed-case precompile addresses. Fixed in the self-test.
  - The explorer needs Cosmos hashes and a client-side Testnet switch.

## 2026-11-12 — Stage 4b: checking agent, Confirm screen, signing flow

- **AI generated:**
  - `web/src/agent/*`: 10 deterministic, parallel, timed checks, logged to `window.qrowAgentLog` and the console. Covers:
    - address validity (custody kit `validateAddress`, vendored with its Apache-2.0 LICENSE and NOTICE)
    - self-send
    - lookalike/poisoning against the sender's past recipients (local index, topped up from `PaymentCreated` logs)
    - new recipient
    - recipient ML-DSA key (via `escrow.hasPqKey`)
    - contract vs wallet
    - recipient history and age (REST)
    - balance, fee reserve, limits
  - Confirm sheet: the first and last 4 characters set large, warnings above the sheet, a side-by-side comparison for lookalikes, an acknowledgement checkbox for danger findings, and Confirm & Send disabled on blocking findings.
  - Signing flow:
    1. derive the PQ key from the recovery code (memory only, checked against the registered key)
    2. check the EVM window, or show the exact scoped command
    3. exact-amount ERC-20 approval
    4. ML-DSA signature over `pqMessage`
    5. `simulateContract`, shown decoded
    6. wallet signature
- **Verified in the browser** (dev-only read-only watch wallet on Wallet 1, live testnet):
  - 10 checks in 744 ms
  - a lookalike `0x5b2d…304a` of Wallet 2 caught with the red "Possible scam" block
  - the acknowledgement gate works
  - no horizontal scroll at 375 px
  - the production bundle contains no dev connector
- **Sweep:** Hallmark sloplint (app scope) is clean apart from fixed items: the buzzword "Unlock", off-scale padding, typographic quotes.
- **Human decision:** the note field is hidden until QoreSeal works (stage 5), following the rule that a feature fully works or isn't shown.
- **Not yet done:** the one AI explanation call per send; an on-chain signing run with a real wallet.

## 2026-11-12 — Stage 4c: first real escrow payment

- **Human:** approved a real 1 QOR test payment from the deployer to Wallet 2.
- **AI:**
  - wrote `contracts/scripts/pay.ts`, which mirrors the web app's calls exactly (digest, pqMessage, ML-DSA, simulate, send)
  - opened a 1-tx window scoped to the escrow only, with a 1.75 QOR cap
  - sent payment #1, closed the window, and read the payment back (Pending, 1 QOR, deadline 19 Nov)
- **Proven on chain:** the live `pqcVerify` precompile accepts the in-app signature format. Gas for a create with a 4,627-byte signature: 420,983.
- **App check against real history:** with browser storage cleared, the agent found Wallet 2 in the escrow's `PaymentCreated` logs and flagged a lookalike in 689 ms. The real Wallet 2 passes every check.
- **Fix from that run:** a doubled screen-reader prefix on danger checks.

## 2026-11-12 — Stage 4d: the one AI explanation call per send

- **Human:** chose to add the AI explanation next.
- **AI (using the claude-api skill):**
  - `agent/` is a local Node server (127.0.0.1 only, reached through the Vite proxy at `/agent`). It makes one `messages.create` call per send:
    - model `claude-haiku-5-5`, the "small, fast model" from the brief
    - effort `low`
    - a frozen system prompt with `cache_control` (long enough to clear the 512-token cache minimum)
    - 4 s SDK timeout, no retries
    - typed error handling; `refusal` handled
  - Strict input schema: only known check ids and levels, token, amount, mode. Unknown fields are dropped, so the note never reaches the model.
  - The browser replaces every address with `[address]` before sending, and the round trip is capped at 5 s.
- **Rule kept:** the AI only rewords finished check results. Warnings render first and the summary sits below them. Confirm & Send never waits for it.
- **Tested in the browser (live testnet checks), with no real key used:**
  - (1) agent server off → "service isn't reachable"
  - (2) no key → "turned off on this server"
  - (3) a fake key aimed at a local never-answering server → server timeout at 4,029 ms, UI message at 4.9 s, while **Confirm was usable at 933 ms**
  - Unit tests: 4 pass (schema, note dropped, no-key path).
- **AI fix from testing:** the summary was first placed above the warnings, but its text says "every warning above". Moved below.
- **Not yet verified:** a real successful call, which needs the human's `ANTHROPIC_API_KEY` in `agent/.env`.

## 2026-11-12 — Contract sprint (D5): NFT, Market and Coin Factory deployed

- **Human:** approved D1–D5 and dropped D4. Said "we are doing everything today". Saved the Telegram and CoinMarketCap keys.
- **AI caught:** the human first described the env files as `qrow/watcher.env` and `qrow/agent.env`. Those names aren't covered by `.gitignore`, so the AI added `*.env` before any commit. Verified the actual files (`watcher/.env`, `agent/.env`) are ignored and never committed, by reading variable names only.
- **AI generated:** PqAuth, QrowGenesis, QrowMarket, QrowCoin and QrowCoinFactory, with 43 new tests (133 total, all pass), and the deploy script with nonce-predicted market wiring. Licences checked: OpenZeppelin 5.6.1 is MIT, with no GPL text.
- **AI design choices to flag to the human:**
  - Genesis disables approvals and plain transfers, so an NFT moves only with ML-DSA.
  - The public share of a launched coin is a PQ-signed one-time claim.
  - The Genesis mint price is 1 QOR or 1 fUSD.
- **Test fixes, not contract bugs:** fUSD decimals in the test fixtures; a receiver hook on a mock.
- **Deployed:** Genesis `0xb82b…c67f`, Market `0x92da…347b`, Factory `0x3571…2f12`. Window closed. Configuration read back.

## 2026-11-12 — Step 4a: Receive tab, sent payments, request links

- **AI generated:**
  - A generic post-quantum action flow (`PqActionPanel` + `lib/pqAction.ts`), reused for claim, release, cancel and refund, and later for NFT, market and launch actions.
  - Payment lists built from `PaymentCreated` logs plus `getPayment`, with live countdowns.
  - The Receive tab: incoming payments, Claim, a warning when the account has no ML-DSA key, and the request-payment panel (qrow:pay v1 QR via `qrcode` (MIT), Copy link, Download PNG).
  - "Your sent payments" on Send: Cancel, Release, and Refund after the deadline.
  - Strict `parsePayload` with 11 tests covering every case in the plan; link prefill on Send.
- **Verified in the browser** (dev watch wallet, live testnet):
  - Wallet 2 sees payment #1 "Claim within 6d 22h", and Claim opens the recovery-code step.
  - The deployer sees it under sent payments, with Cancel.
  - A valid request link pre-fills 12.5 fUSD; a `<script>` note renders escaped.
  - A mainnet link is blocked with the exact message and nothing filled in.
- **Sweep:** 21 web unit tests pass; Hallmark sloplint is clean.
- **Next (4b):** QoreSeal encrypted notes. ML-KEM key registration from the CLI; notes sealed in `createPayment`; decrypted in Receive with recovery-code-derived seal keys.

## 2026-11-12 — Step 4b: QoreSeal notices

- **Human:** said build 4b, and to build everything today with one tab per feature.
- **AI:**
  - Seal keys derived from the recovery-code ML-DSA key, so the one secret both claims and decrypts.
  - ML-KEM-only seal.
  - The note is authenticated by binding its hash in the sender's ML-DSA authorisation (QoreSeal envelopes aren't signed by themselves).
  - CLI `seal status/register/read`; the pay script seals like the app.
  - Send note field with a live KEM-key check; Receive NoteReader that decrypts with the recovery code in memory only.
- **On chain:** registered the Drill account's KEM key; payment #4 with a note decrypted by the recipient, and refused for another key.

## 2026-11-12 — Step 5: alerts watcher + Portfolio

- **Human:** said "go to step 5" and "everything working today".
- **AI found:** a WebSocket EVM endpoint (`wss://evm-ws-testnet.qore.host`), which allows true event subscription, and the EVM-to-Cosmos hash lookup for explorer links (`ethereum_tx.ethereumTxHash`).
- **AI generated `watcher/`:**
  - Live `eth_subscribe` on escrow logs and new blocks, with a back-fill on start.
  - Pure alert rules with 6 tests: created/waiting, notified, claimed, released, cancelled, refunded, day-5 reminder, 24 h before expiry, refund overdue, failure with the decoded reason.
  - Every alert carries the escrow address, tx hash and explorer link.
  - Telegram bot commands `/watch`, `/unwatch`, `/list`, `/stop`; plain-text messages only.
  - A Notifier interface ready for email.
  - State (chat ids) git-ignored.
- **AI generated the Portfolio tab:** EVM and native balances, a CW20 read, EVM/native/SVM addresses, Genesis NFTs with listings, pending payments, an activity table, CSV export. 2 more tests.
- **Verified:** the watcher back-filled 7 escrow events. Portfolio for the Drill account shows live balances and activity.
- **Waiting on the human:** send `/watch <address>` to @qrow_alerts_bot to receive live alerts.

## 2026-11-12 — Demo refund, steps 6–7: NFT Shop and NFT Market

- **Human:** approved the demo escrow; said again "everything working today".
- **AI:**
  - **QrowEscrowDemo:** an exact copy of the escrow with only 3 lines changed (title, 10-minute period, domain tag), plus 3 tests (136 total).
  - Deployed it; demo mode in the app (banner and wording from one constant).
  - On-chain refund triggered by the recipient, paid to the sender.
  - Exact-amount approval step in the shared PQ action panel.
  - NFT Shop tab (stats, on-chain art gallery, mint with QOR or fUSD).
  - `pq-call.ts` generic script.
  - Market agent checks (price vs floor, seller lookalike, balance; 4 tests).
  - NFT Market tab (floor stats, listings, buy with checks and acknowledgement, list with price-sanity warnings, cancel).
- **On chain:** Genesis #1 minted → listed → bought by the Drill account, atomically.

## 2026-11-12 — Step 8: Staking

- **AI researched:** the QoreX native `signAndBroadcast` request shape (encoded Any messages, memo, gas hint); the SDK builders (`msg.staking`, `msg.distribution`, `msg.stakingtier`); the testnet validators (4 bonded); that tx search needs a height floor because the node prunes history.
- **AI generated:**
  - The Staking tab: validators, stake, 90d/180d/1y native locks with live bonus rates, early-unlock confirm showing days staked, the 5% burn, the forfeited bonus and 21-day unbonding (D2), Claim & restake as one QoreX signature (D3a).
  - Referral link + memo tag, plus a count endpoint in the agent server and a Portfolio badge (tracking only, no payouts).
  - A daily rewards reminder in the watcher.
  - A `stake` CLI for script accounts.
  - Tests for the early-unlock maths and referral capture (29 web tests).
- **On chain:** the deployer staked 2 QOR with graviton, carrying `qrow-ref:<Wallet 2>`; the referral count for Wallet 2 reads 1.
- **Honest limits:**
  - Testnet base staking rewards are effectively 0 (pool `last_base_apy_bps` = 0), so Claim & restake can't be shown with real rewards today.
  - Locks need at least 10 QOR, which the script accounts don't have. A QoreX lock with Wallet 1 is the owner's test.
  - Auto-restake (D3b) is not built; optional, after the core.

## Step 9: Market News tab (12 Nov)
- **Built with Claude (Opus 5.5) in Claude Code:** `agent/src/market.ts` (CoinMarketCap prices cached 10 min server-side, QOR listing check once a day, RSS headlines from Cointelegraph, Decrypt and The Block cached 15 min), `/market/prices` and `/market/news` on the agent server, `web/src/pages/NewsPage.tsx`, and a two-row nav for 9 tabs.
- **Probed first:** CMC quotes work on the free plan (1 credit); `content/latest` is refused (error 1006), so news comes from RSS; QOR is not listed on CMC.
- **Safety:** the API key stays on the server; headlines keep title, source, date and link only (no article text); links must be https and on the feed's own domain (unit test); labels "Market prices are real. Qrow balances are testnet tokens with no value." and "Data from CoinMarketCap".
- **Checked:** agent 5 tests and web 29 tests pass; tab verified in the browser with live data; sloplint 0 FAIL (3 REFLEX on the deliberate pure-white QR background, waived).

## Step 10: Launch tab (12 Nov)
- **Built with Claude (Opus 5.5) in Claude Code:** `web/src/pages/LaunchPage.tsx`, `web/src/agent/launchChecks.ts` (+ 4 tests), `web/src/lib/coins.ts`, launched coins as sendable tokens (`config/tokens.ts` registry, filled only from `QrowCoinFactory.coins()`), a "coin" check in the send agent, coin rows in Portfolio.
- **Checks before launch (no AI):** format, supply, creator share and description mirror the contract; on top, leetspeak and one-letter-off lookalikes of protected names (6+ letters, after "Ethel" tripped the rule on "ether"), ticker lookalikes, duplicate symbols and names, links and profit wording; plus the factory's own `checkNames` read from chain.
- **On chain:** LANT launched and claimed with PQ signatures (see TEST_NOTES).
- **Fixed during review:** positive badges used the coral "earned" colour (read as a warning), long contract address overflowed the card, Send didn't re-render when coins loaded.
- **Checked:** web 33 tests pass, typecheck clean, sloplint 0 FAIL.

## Going public (12 Nov)
- **User direction:** Qrow is a public testnet launch for anyone, anywhere, on PC or phone, not a demo.
- **Built with Claude (Opus 5.5) in Claude Code:** in-app EVM windows signed in QoreX (`WindowOpener`, `WindowCloser`; no command line for users), a public Node server (`agent/src/server.ts`: static app, allowlisted GET-only REST relay, agent API, per-IP rate limits, daily AI cap, strict CSP), `Dockerfile`, `docs/DEPLOY.md`, phone layout for 9 tabs.
- **Checked:** production build served by the new server in the browser with no console errors (News, Staking via the relay, Launch via EVM RPC); relay refuses POST and `..` paths; no sideways scroll at 375 px; agent 7 and web 33 tests pass. Not checked: the Docker build (Docker Desktop wasn't running) and opening a window through QoreX (needs the extension).
