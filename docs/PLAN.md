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

**Libraries** (MIT, both actively maintained; credited in the README):
- [`qrcode`](https://github.com/soldair/node-qrcode) 1.5.x generates the codes.
- [`@zxing/browser`](https://github.com/zxing-js/browser) 0.2.x scans, from the camera or from an uploaded image.
- I'm not using `qr-scanner`, which has had no release since 2022.

### Payload, version 1

```
qrow:pay?v=1&chain=9800&to=<0x address>&amount=<decimal>&token=<symbol>&note=<text>
```

| Field | Rule |
|---|---|
| `v` | Required. An unknown version is rejected and explained. |
| `chain` | Required, and must be `9800`. Added to the brief's example so the app can reject a code made for the wrong network. |
| `to` | A checksummed `0x` address, validated with the custody-kit `validateAddress`. |
| `amount` | Optional. A plain decimal: no exponent, no more decimals than the token has, greater than 0. |
| `token` | Only `QOR`, `fUSD`, `fETH` or `fBTC`, mapped to fixed testnet addresses inside the app. A QR code can never name a contract address. Anything else is rejected. |
| `note` | Optional, at most 140 characters. Shown as escaped plain text. **Never passed to the AI** as anything but quoted data, so a hostile note can't steer the explanation. |

**Plain address codes:**
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
- a wrong-chain code
- an over-limit amount
- a **lookalike-address code, which must show the red "Possible scam" block**
