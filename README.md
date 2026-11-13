# Qrow

**Escrow payments on QoreChain, every step signed with a quantum-safe key.**
Public beta on QoreChain testnet (`qorechain-diana`, EVM chain 9800). Testnet tokens have no value.

**Live: https://qrow-app.vercel.app** (desktop and phone; open it inside the QoreX app's dApp Browser on a phone).

Built for the QoreChain *Build Before Q-Day* Developer Fest, Post-Quantum dApp category.

## What it does

- **Send:** money waits in escrow until the recipient claims it; if nobody claims it within 7 days, anyone can return
  it to the sender. A checking agent reviews every payment before you sign (address validity, lookalike/poisoned
  addresses, the recipient's quantum-safe key, balance, fees, your limits), and one AI call explains the results in
  plain language. Warnings never depend on the AI.
- **Receive:** claim payments, read encrypted notes (QoreSeal, ML-KEM-1024), make payment-request links and QR codes.
- **Post-quantum by design:** every sensitive contract action carries an ML-DSA-87 signature checked on chain with
  QoreChain's `pqcVerify` precompile, and every EVM transaction travels through a short, scoped EVM window opened
  with the account's hybrid (secp256k1 + ML-DSA-87) signature. A leaked classical key alone can't move anything.
- **Signed in QoreX:** every transaction is a native-lane `MsgCrossVMCall` that QoreX signs with its hybrid
  secp256k1 + ML-DSA-87 signature, calling Qrow's EVM contracts as the user. No MetaMask, no EVM window.
- **Invisible device key:** QoreX doesn't sign messages for websites, so each browser keeps a Qrow device key
  (ML-DSA-87) behind a passkey, registered in `QrowKeys`. Users never see, copy or save a key or code.
- Also built, going live tab by tab: NFT Shop and Market, Portfolio, Staking, Market News, memecoin Launch,
  Telegram alerts, Admin & Analytics.

## Try it

Open **https://qrow-app.vercel.app**. In the public beta, only what works end to end for a normal QoreX user is
switched on; the other tabs say "Coming soon" until they do (see `docs/PLAN.md`).

See **How to test Qrow** in the app (`/how-to-test`). In short: QoreX (testnet) + MetaMask holding the same
testnet-only account, free QOR from the [faucet](https://dashboard.qorechain.io/faucet), create your Qrow key on the
Start page, then send 1 QOR to a friend.

## Contracts (testnet, v3)

| Contract | Address |
| --- | --- |
| QrowKeys (v3, device keys) | `0xa5242cb348eddef0deb9599f81e55a64d186fd14` |
| QrowEscrow | `0x332937d1918a0f85eacc5167ab87ba91c48a4655` |
| QrowGenesis | `0x5f03380be788bbd17eb3529b77ee27bed879602d` |
| QrowMarket | `0x10e2e663ebb1fdd290b8cabbe6e2634852d65fa9` |
| QrowCoinFactory | `0x764a8586e7a7e9e2b511bf79d9f9c8b3ae7e7c5e` |

Deployment details and every on-chain test transaction: [`docs/TEST_NOTES.md`](docs/TEST_NOTES.md).

## How to verify any Qrow transaction

Every Qrow action is a QoreChain transaction you can check yourself, without trusting Qrow:

1. Copy the transaction hash Qrow shows (success screens, history, Telegram alerts, CSV exports).
2. Open [explore.qore.network](https://explore.qore.network) and search for it. If the explorer opens on mainnet,
   switch it to **Testnet** (it remembers the network in your browser, not in the link).
3. Or ask the chain directly: `https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/<hash>`. A Qrow action made
   through QoreX shows a `crossvm_request` event whose `target_contract` is one of the contracts above, plus
   `pqc_hybrid_verify: verified` (the ML-DSA-87 signature the chain checked).
4. The contract's state confirms the result, e.g. `QrowEscrow.getPayment(id)` for a payment.

A Verify page in the app (paste a hash or a Qrow reference such as `QRW-PAY-000123`) is being added tab by tab.

## Repository

| Folder | What |
| --- | --- |
| `contracts/` | Solidity (Foundry), tests, testnet scripts |
| `web/` | The app (Vite, React, wagmi, viem, RainbowKit) |
| `agent/` | Server: agent API (AI explanation, prices, news, referrals) and REST relay |
| `watcher/` | Telegram alerts for escrow events |
| `docs/` | Plan, test notes, deployment, AI usage log |

Run the tests: `cd contracts && forge test` (150 tests), `cd web && npm test`, `cd agent && npm test`, `cd watcher && npm test`.

## About the builder

Built solo by **Terhemba Jonathan Alumo** ([GitHub: Terhemba10](https://github.com/Terhemba10)) in **Doha, Qatar**,
for QoreChain's *Build Before Q-Day* Developer Fest, representing the **Middle East & Africa** region.
Qrow is an independent community project: it uses QoreChain's public kits and the QoreX palette, never QoreChain's
or QoreX's logos.

## Credits

Every library below is used under its own licence; Qrow's own code is MIT.

| Used | Licence | For |
| --- | --- | --- |
| QoreChain SDK, `@qorechain/evm`, `qoresign`, `qoreseal`, `qorex-types`, `qorex-rainbowkit` | Apache-2.0 | Chain access, PQC keys and signatures, QoreSeal, QoreX |
| QoreChain custody kit (address validation, vendored in `web/src/vendor/custody-kit`) | Apache-2.0 | Address checks (LICENSE and NOTICE kept) |
| `create-qorechain-dapp` templates (viem-wagmi, foundry) | Apache-2.0 | Starting points for `wagmi.ts`, `vite.config.ts`, `scripts/window.ts` |
| OpenZeppelin Contracts 5.6.1 | MIT | ERC-20, ERC-721, ReentrancyGuard |
| forge-std | MIT / Apache-2.0 | Contract tests |
| viem, wagmi, RainbowKit, TanStack Query, React, React Router | MIT | Web app |
| qrcode | MIT | QR codes |
| @bufbuild/protobuf | Apache-2.0 / BSD-3-Clause | Encoding the token-convert messages the SDK doesn't build |
| Anthropic TypeScript SDK | Apache-2.0 | The one AI explanation per send |
| tsx | MIT | Running the servers |
| CosmJS (`@cosmjs/stargate`) | Apache-2.0 | Native-lane scripts |
| General Sans (Fontshare, ITF free font licence) | loaded from Fontshare, not redistributed | Interface type |
| Geist Mono, IBM Plex Sans Arabic | SIL OFL 1.1 (Google Fonts) | Figures and addresses, Arabic |
| CoinMarketCap API | CoinMarketCap terms | Market prices ("Data from CoinMarketCap") |
| Cointelegraph, Decrypt, The Block RSS feeds | their terms | Headlines with links (titles only) |
| Claude (Anthropic) | | Development assistant; see [`docs/AI_LOG.md`](docs/AI_LOG.md) |

## Licence

MIT, see [LICENSE](LICENSE).
