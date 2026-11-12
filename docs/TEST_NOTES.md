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
| 1 | Send | deployer → Wallet 2, **1 QOR**, Direct, via `npm run pay` (the same calls as the app) | PaymentCreated #1 | **Done 2026-11-12.** tx `0xba048ad3147cb7d88baccba87026b91fbfd07d979bf5e6977177a78118577df8`, block 9,958,584, gas 420,983, refundable after 2026-11-19 15:06 UTC. Window: 1 tx, escrow-only target, 1.75 QOR cap, opened `48B4E6FD…5B90` / closed `95D43BAF…04FF`. Note and alert pending stages 5/6. |
| 2 | Claim | deployer → Drill account 0.5 QOR (#2); the Drill account claims with ML-DSA via `npm run action` (the same calls as the app) | PaymentClaimed | **Done 2026-11-12.** #2 created tx `0x1184def88ffe5e94d8b5661519f5b54b87919788af650cd639b1a8bc086b0947`; claim tx `0x6bbc0e1cefd09cff18cd241b5c94cd6217ffae8c42f3c8711c5ca4b92c26eda0` (gas 273,435) → Claimed. Drill window: 1 tx, escrow only, closed `3F7D5475…1BE`. |
| 3 | Cancel | deployer → Drill account 0.5 QOR (#3); the deployer cancels with ML-DSA | PaymentCancelled; funds back | **Done 2026-11-12.** #3 created tx `0x5d6496352a9683eee599383bfbc16f9ed9c0d1635c75e967e365bb14f9471393`; cancel tx `0xcb59dedeed81d543997350a5ccedcda16a5e19f6cac51918aae82f2de2a100e0` (gas 255,883) → Cancelled. Deployer window: 3 txs, escrow only, closed `A84CDEC8…9A98`. Afterwards the escrow holds exactly 1 QOR (#1, still pending). |
| 4 | Refund | **Demo escrow** `0x5005f0efa49ae70e7d785983a610c997c80d3bb4` (QrowEscrowDemo, 10-minute period, own domain tag): deployer → Drill account 0.1 QOR; after 10 min the **recipient** calls `refundExpired` | PaymentRefunded to the **sender** | **Done 2026-11-12.** Demo #1 tx `0x752f3b463de78039702cf68ef77a4b8e0a5534b798ce4ed53b195957bdaeceec`; refund tx `0x0665720717e432e0a7975c408b2663f4aff6d966e99984eb8847a6cf9f4b9b42` (gas 47,722, no PQ signature needed) → Refunded. The real escrow's #1 becomes refundable after 2026-11-19 16:06 UTC. |
| 5 | Lookalike | as the deployer (dev watch wallet, browser storage cleared), enter `0x5b2d00000000000000000000000000000000304a` | red "Possible scam" block | **Done 2026-11-12.** Caught from on-chain history alone (payment #1 logs): 10 checks in 689 ms; comparison shows `0x5B2d9c0F…304A` vs `0x5B2d0000…304A`. The real Wallet 2 then passes every check, including "You've paid this address before". |

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

**Wallet 2, re-checked 2026-11-12:**
- ML-DSA key **registered**: `hybrid`, algorithm 1, possession proven, at height 9,956,381.
- Registration tx: `744CCAB7C216ADEC3FED4ADEF693C4E6B4B0BB8CCE38CC4148F9C62CE8F75BF0`. A second `MsgRegisterPQCKeyV2` tx, `5351117A…B114A2`, also returned code 0.
- The account key is **`ethsecp256k1`** (Ethereum-style), so the account can send EVM transactions.
- Sequence 4, balance 22.775 QOR, no EVM window.
- `QrowEscrow.hasPqKey(Wallet 2) == true`, so it can claim once it can sign.

## Contract sprint deployment (2026-11-12)

| Contract | Address | Deploy tx | Gas |
|---|---|---|---|
| QrowGenesis | `0xb82ba02428506ad69be84ee932c844e0d99bc67f` | `0xeb2a4d3bec382485fbc68dae404be3080dc6d37d9550198a5d810712c0e68ae7` | 2,885,174 |
| QrowMarket | `0x92da580048b7cedfd6d834a0f839d38121fc347b` (predicted from nonce 9, matched) | `0xd3af09ae0aa79efac47de585fa6089f36506735d002d5c2c4ec7127472a67fa6` | 1,936,508 |
| QrowCoinFactory | `0x3571ac216de6fd72ce8e1d9ecebf79d030142f12` | `0x07736635cf539007a3c211f0399495e24b51fd3d667f5cd6db25eb59756249e0` | 3,918,260 |

- Window: 3 txs, 200 blocks, no targets (contract creation). Opened, used and closed (`3D8CDE1B…2402`). No window open afterwards.
- Read back on chain:
  - Genesis names the market as its only mover; the beneficiary is the deployer; prices are 1 QOR and 1 fUSD; `nativeChainId` is `qorechain-diana`.
  - The factory refuses "Bitcoin Cash" (`bitcoin`) and accepts "Paper Lantern".
  - All three see the Drill account's ML-DSA key.

### Q-Day Drill registration: contract addresses (4 of 5)

1. QrowEscrow `0xcf36b836872a0b277919eac1fb976722e32d824b`
2. QrowGenesis `0xb82ba02428506ad69be84ee932c844e0d99bc67f`
3. QrowMarket `0x92da580048b7cedfd6d834a0f839d38121fc347b`
4. QrowCoinFactory `0x3571ac216de6fd72ce8e1d9ecebf79d030142f12`

## QoreSeal notices (step 4b, 2026-11-12)

- **Drill account ML-KEM-1024 key registered:** tx `CB28FF41D8704E0E16004BBAE885E28019C7BE55FFE770006269787CD74DA38F`. The key comes from the ML-DSA secret, as `SHA-256("qrow-qoreseal-seed-v1|" || sk)`.
- **Payment #4:** deployer → Drill account, 0.1 QOR, with a note. tx `0x59169daee54b91f9163630febd8d8382ef5ad6a42f8a50994e89fb5cbcdc67a5`, gas 397,802 (+48k for the 1,869-byte envelope). Window: 1 tx, escrow only, closed `DE975888…2C60`.
- **Decryption:**
  - The recipient's `npm run seal -- read --id 4 --drill` returns the exact notice JSON. The `<b>` in the note stays text.
  - The deployer's key fails ("the envelope has no entry for this key").
- **Web:** the Drill account's Receive tab lists #4 with "Read the encrypted notice". On Send, the note field is disabled, with an explanation, for recipients without an ML-KEM key (deployer, Wallet 2).

## NFTs on chain (steps 6–7, 2026-11-12)

| Step | Who | Tx | Result |
|---|---|---|---|
| Mint Genesis #1 (1 QOR, ML-DSA) | deployer | `0x0da6311ca4b54eb99f16541ceae50ab1aa9aa372178525461fdf1e75616485d5` (353,862 gas) | Minted #1; 1 QOR straight to the beneficiary |
| List #1 for 2 QOR (ML-DSA) | deployer | `0x7df63bd6a00fad4e67375bcd8dddf98a782372918835df8b39e4fb48dc79e8c1` (473,121 gas) | Listing #1; NFT escrowed in the market |
| Buy listing #1 (ML-DSA, price bound in the signature) | Drill account | `0xfaabbc6edcb37f41dd8925b52f62050fb32b1cbed0ea24690c730067c45a7a9c` (312,659 gas) | Sold; Drill account owns #1; 2 QOR to the seller in the same tx; market holds 0 QOR, 0 listings |

Each step used a 1-tx window scoped to the one contract, closed straight after.

## Launch (step 10), 12 Nov
- Coin launched with `npm run pq -- launch` (deployer, PQ-signed): Paper Lantern (LANT), 1,000,000 supply, creator 5%.
  Coin `0xd7C48A7220D8EE176a152a7a5DC1E6A025E90b84`, tx `0xb1fbeeb289ba7b147540b2575f26f5af89224d9f1229c7d919bf5ab203d5a191` (block 9966315, gas 1,956,662).
- Public claim (PQ-signed): 950 LANT to the deployer, tx `0xae5f0dce0ba10a4f6b71f247d46dce115582a76c3c4c834c84f484e27373589e` (block 9966346). Each window held 1 tx, scoped to one target, and was closed.
- In the app: the list shows LANT with safety badges read from chain; the Drill account sees "Claim 950 LANT"; Send offers LANT, and the checking agent adds "LANT was launched in Qrow" (factory `isQrowCoin` read) and blocks on a 0 balance.
- Checks seen in the browser: "B1tc0in Cat" / "B7C" pass the factory's on-chain rules but the agent blocks both as lookalikes.
- Not shown on chain: an escrow payment in LANT (the escrow accepts any standard ERC-20; covered by the Foundry tests).

## v2 redeploy: Qrow app key (13 Nov)
Deployer `0xD517…cb37`, one creation window (6 txs, 200 blocks), closed afterwards. Wiring read back from chain:
every contract's `KEYS` is QrowKeys; Genesis's `market` is the new Market.

| Contract | Address | Tx | Block | Gas |
| --- | --- | --- | --- | --- |
| QrowKeys | `0x4ee5ca4c4d4ce7a7458a44c8eb155d7026f23db8` | `0x9a0ca8bf047a90bc9d7881c4ef6edd8864ce964709d2fe3df07a48bbea00a073` | 9974920 | 1,625,081 |
| QrowEscrow | `0xe51f1a2d28661bead6b0a75d3e4e2b3edff766da` | `0x5ff16c40a2ee2c4b67384d75a1d4655425fd81bd9e59ec29fa5f75fc037cc6ca` | 9974922 | 2,383,619 |
| QrowEscrowDemo | `0xc985a2bf1e87409ff63433e29d2e9a8b891a1d09` | `0xcf0578377f74e1e31fe4c4771d95cfa4b1d162e1804d3a077274e2536b906eb2` | 9974924 | 2,383,175 |
| QrowGenesis | `0x73fe0fb443962c1e1503f57aba3cc6e895117287` | `0x5b38b603c15c8457342acdff78996a37a3a179b9763339d1885d08643efce549` | 9974926 | 2,967,974 |
| QrowMarket | `0xc9c9dab84f368d879aa8f96b5dbf5c22062da373` | `0x93b330c200800b2e4618b872e8d1231238535f72fdc79f6a19b3c72ad0698866` | 9974928 | 2,024,592 |
| QrowCoinFactory | `0x7ff6a8a047d9558c6b152a3cffe1adea19407836` | `0xee52e2270c857913c85d7cd63b1b15ad164c8a24cde76b1f84e28fc0b36578bb` | 9974930 | 4,101,232 |

On-chain smoke tests (each in its own 1-tx window scoped to one contract, closed after):
- App key registered for the deployer (`npm run appkey -- register`): tx `0x9a6d0ff9cd69413de030fc0c4f3905e680115d94716aa40724df8a6aa0a0535f`, block 9975032; `keyOf` returns it.
- Payment #1, 0.1 QOR deployer → Drill, **signed with the app key**: tx `0xf229788c5d911eeaafa862031512176ae8488978aee3b1dc8300d86d558b4c68`, block 9975066.
- Claimed by the Drill account with its **chain key** (no app key: fallback path): tx `0xf6df00552cda814765dd9fdacf94f49b3f71c2387f76cc4cc2c6f12ca75185fd`, block 9975099.
- Watcher back-filled the three events from the v2 escrow and produced the created, notified and claimed alerts.
- v1 addresses stay in `deployments/testnet.json` under `v1`; LANT and the v1 NFTs live on the v1 contracts.
