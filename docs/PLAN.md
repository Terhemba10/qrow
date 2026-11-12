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

## Decisions requested from the owner (each conflicts with what the chain allows)

| # | Request | What the chain allows | Recommendation |
|---|---|---|---|
| D1 | Lock-ups of 90 days, 240 days and 1 year | Native 3, 6 or 12 months; a custom lock contract is impossible (no staking precompile, no CosmWasm) | Offer **90 days, 180 days and 1 year**, all native. Drop 240 days. |
| D2 | Pro-rata rewards on early unstake | Base staking rewards accrue per block and stay yours (pro-rata). The tier bonus is forfeited and **5% of the lock is burned**. | Show both on the confirm screen, with the exact numbers from chain parameters, before signing. Qrow can't waive the chain's penalty. |
| D3 | Opt-in capped auto-restake | `x/authz` exists. A capped, expiring `StakeAuthorization` plus withdraw-only permission is possible, but needs a Qrow restaker account with its own PQC key | Build "Claim & restake" plus the reminder alert in step 8. Auto-restake only if step 8 finishes early, default off. |
| D4 | Launch: AMM pool with locked creator liquidity | 100 QOR pool fee, token-pair registration, LP can't be locked by our contracts | **Drop** (it was optional). |
| D5 | Strict order "each step works before the next" vs. the Drill (17 Nov) | Drill points at deployed contracts | Write, test and **deploy QrowGenesis, QrowMarket and QrowCoinFactory by 16 Nov**, ahead of their UI steps, so all four contracts are in the Drill. The UI steps stay in strict order. |

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
| QrowEscrow | deployed `0xcf36b836872a0b277919eac1fb976722e32d824b`, 90 tests | yes |
| QrowGenesis (ERC-721) | sprint | yes, if deployed by 16 Nov |
| QrowMarket | sprint | yes, if deployed by 16 Nov |
| QrowCoinFactory (and the coins it deploys) | sprint | yes, if deployed by 16 Nov |

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
