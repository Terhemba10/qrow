# Manual test notes (testnet `qorechain-diana`, EVM chain id 9800)

The test accounts belong to the project owner. They're **testnet only**, used through the QoreX extension, and nothing here is a key or recovery phrase.
These addresses are notes for manual testing. They are **not** defaults in code.

## Accounts

| | qor1 (native) | 0x (EVM, EIP-55) |
|---|---|---|
| Wallet 1 (sender) | `qor14xwf9ch3ksmgatauxd283tye3cq35s0ut5walv` | `0xa99c92E2F1b4368eAFBC335478ac998E011a41fc` |
| Wallet 2 (recipient, QoreX Ethereum-style) | `qor1tvkecr694m62k32hftvte378kx4sxvz2qjdd5f` | `0x5B2d9c0F45AEf4AB45574aD8BCc7C7B1AB03304A` |

**Address conversion was verified on 2026-11-12** with `@qorechain/sdk` 0.14.0. Both directions match for both wallets: `qorToEvm(qor1) == 0x` and `evmToQor(0x) == qor1`.

## On-chain state, 2026-11-12 (read-only REST and JSON-RPC)

**Wallet 1:**
- Account #15238 exists. Its account key type is **`/cosmos.crypto.secp256k1.PubKey`** (Cosmos-style, not `eth_secp256k1`).
- ML-DSA-87 key registered: `key_type: hybrid`, `possession_proven: true`.
- No EVM window open.
- Bank balances:
  - 99.685 QOR (`uqor 99685000`)
  - fUSD 1,000 (`erc20:0x9714…`, 1000000000 at 6 decimals)
  - fETH 0.5
  - fBTC 0.02
- The fest tokens are still bank coins and haven't been converted to ERC-20.

**Wallet 2:**
- No on-chain account yet: never funded, no ML-DSA key registered, no window.

## What this means for the manual send → claim → cancel → refund tests

1. **EVM transactions need an Ethereum-style key.** The docs say the EVM window works only for `eth_secp256k1` (coin type 60) keys. Wallet 1's key is Cosmos-style secp256k1, and its `0x` form is the same 20 bytes, not an address any Ethereum key controls. So Wallet 1 can **receive** on the EVM lane but can't **send** EVM transactions. That means it can't create, cancel or claim escrow payments.
2. **QoreX doesn't answer EVM signing methods yet** (`eth_sendTransaction` and the others), nor `signArbitrary` (ML-DSA message signing). Through QoreX alone, nobody can sign the escrow calls today.
3. Wallet 2 needs faucet QOR first. Then it needs its ML-DSA key registered (QoreX can do this on the native lane) before it can claim.

**Decision (2026-11-12, owner chose the recommended path):**
- **Contract:** QrowEscrow verifies ML-DSA-87 signatures over QoreSign's message format, `"qorechain-msg-v1|qorechain-diana|0x<digest hex>"`. Those are the bytes QoreX's planned `signArbitrary` signs, so QoreX works later with no redeploy. This was cross-checked against `@qorechain/qoresign` 0.2.0 (`npm run check:pq-message`).
- **Manual tests and the Q-Day Drill** use fresh Ethereum-style accounts that the owner creates locally with `npm run account:new -- --prefix <NAME>_`. The private key and recovery code go straight into `.env` and are never printed or shared. The owner imports the key into MetaMask themselves.
- **Wallet 2** is the QoreX recipient. To set it up: faucet, then register its ML-DSA key in QoreX.
- **Wallet 1** is a payout recipient, and the source for converting fest tokens through QoreX.
- **Automated end-to-end tests** use `@qorechain/qorex-wallet-mock` in its planned-signing mode.

## Manual test checklist (to fill in once the signing path is settled)

| # | Flow | Steps | Expected | Result / tx hash |
|---|---|---|---|---|
| 1 | Send | sender → recipient, 1 fUSD, Direct | PaymentCreated; QoreSeal note in recipient Inbox; Telegram alert | |
| 2 | Claim | recipient claims #1 before deadline | PaymentClaimed; funds at recipient; receipt | |
| 3 | Cancel | sender sends #2, cancels before claim | PaymentCancelled; funds back | |
| 4 | Refund | sender sends #3; wait 7 days (or use a short-deadline test deployment); anyone calls refundExpired | PaymentRefunded to sender | |
| 5 | Lookalike | type an address with the same first and last 4 characters as the recipient | red "Possible scam" block | |
