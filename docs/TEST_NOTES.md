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

## Testnet deployment (2026-11-12)

| Item | Value |
|---|---|
| **QrowEscrow** | `0xcf36b836872a0b277919eac1fb976722e32d824b` |
| Constructor | `nativeChainId = "qorechain-diana"`; no owner |
| Deploy tx (EVM hash) | `0x9e1f7c2dd3a2ae004392680ad61217fc5490ec0a7e159f83597d6d2d6f6f07ec`, block 9,955,775, gas used 2,292,049 |
| Deployer | `0xD517458c6b083B964342C604D35Be6afC2dCcb37` / `qor165t5trrtpqaevs6zcczdxklx4lpdejehs68qf9` |
| Drill account | `0xdBA1B390218aF72ACFD5E262850C90c079F0e78d` / `qor1mwsm8ypp3tmj4n74uf3g2ryscpulpeud6v4el4` |

**Verified on chain after the deploy:**
- The runtime bytecode is byte-identical to the local `forge build` (9,731 bytes).
- `nativeChainId() == "qorechain-diana"`, `paymentCount() == 0`, `REFUND_PERIOD == 604800`.
- `hasPqKey`: deployer true, Drill true, **Wallet 2 false**.

**Live ML-DSA self-test** (`npm run pq:selftest`, read-only, against the real 0x0A01/0x0A02 precompiles):
- Deployer and Drill keys are registered (`hybrid`, possession proven, 2,592-byte key).
- `escrow.pqMessage` matches QoreSign byte-for-byte.
- A real signature verifies: `true`. A tampered one fails: `false`.

**Transaction log (Cosmos hashes):**

| Step | Tx hash | Result |
|---|---|---|
| Register deployer key | `5E3BB521A5F34277E8147D569F3933D5A7B2C53FD1924728D8E386931F5B489E` | code 0 |
| Register Drill key | `949DE3FD612A514DF642559AA7B3BA98D94511705EFA2EB3A101FE9C5244BC23` | code 0 |
| Open deployer window (1 tx, 120 blocks, no targets) | `BAD3DB15962D604907D5046D30D91D49A18D818EA235AC5CECAE5EEE20A213B9` | |
| Close deployer window | `C10DEE2F689704E9CCC65D894682FA1036EA791BE7AFBA3F33AAE6E25AE60939` | |

After closing, **no EVM window is open on the deployer or the Drill account**.

**Explorer findings (for stage-6 alert links):**
- explore.qore.network keeps the Mainnet/Testnet choice in the browser, not in the URL, so a fresh visitor lands on mainnet.
- `/tx/<hash>` expects the **Cosmos** tx hash. The EVM hash isn't found.
- Alerts will need the Cosmos hash of each EVM transaction, plus a note to switch the explorer to Testnet. An EVM-aware viewer is the other option.

**Open:** Wallet 2's ML-DSA key is still not registered on chain (`found: false`). Its balance is 30 QOR and its sequence is 0, so it has never sent a transaction.
