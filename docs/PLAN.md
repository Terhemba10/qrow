# Qrow build plan

Approved 2026-11-12. Testnet only (`qorechain-diana`, EVM chain id 9800).

**Key dates (UTC):**
- Q-Day Drill registration: **17 Nov 23:59**. Drill: 18 Nov.
- Feature freeze: **28 Nov**.
- Submission: **2 Dec 23:59**.

## Architecture decisions

- **Wallet signing.** QoreX connects and reads, and it signs native-lane transactions (opening and closing the EVM window, `MsgConvertCoin`). EVM transactions are signed by an injected wallet holding the same account, because QoreX doesn't answer EVM signing methods yet.
- **Post-quantum signatures.** ML-DSA-87 signatures for `pqcVerify` are made in the app from the account's PQC recovery code. The code is held in memory only, never stored. Demo and Drill accounts are created as a private key plus a recovery code.
- **EVM windows.** Every window is as small as possible: the exact transaction count, targets limited to the escrow and the token, and closed straight after use.
- **Sign In With QoreChain.** The full verifier is tested with the wallet mock. It goes live when QoreX supports `signArbitrary`.

## Stages

| # | Stage | Status |
|---|---|---|
| 1 | Research and plan | done |
| 2 | Logo and design tokens | done (B. Return) |
| 3 | Escrow contract, tests, QCAI audit, testnet deploy | contract and tests written; **waiting for Foundry**; deploy before 17 Nov |
| 4 | Frontend: connect, Sign In With QoreChain, Send, checking agent, Confirm, sign | |
| 5 | Inbox/Claim with the QoreSeal notice; PQ claim, cancel, refund | |
| 6 | Alerts watcher and Telegram bot | |
| 7 | History, CSV export, receipts, payment detail | |
| — | **Core complete: everything above works end to end** | |
| 8 | Extras, one at a time, each fully tested or removed: **8a QR codes**, 8b AI history chat, 8c Security page (QoreScan), 8d Arabic/RTL, 8e Keplr/Leap | |
| 9 | impeccable audit and polish, end-to-end tests, hallmark sweep (**freeze 28 Nov**) | |
| 10 | Submission package | |

## 8a. QR codes (spec added 2026-11-12)

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
