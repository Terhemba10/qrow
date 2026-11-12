# Qrow

**Escrow payments on QoreChain, every step signed with a quantum-safe key.**
Public beta on QoreChain testnet (`qorechain-diana`, EVM chain 9800). Testnet tokens have no value.

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
- **Qrow key:** QoreX keeps the account's chain key and doesn't sign messages for websites, so Qrow creates a
  separate ML-DSA-87 key in the browser, registered once in `QrowKeys` and used by every Qrow contract.
- Also built, going live tab by tab: NFT Shop and Market, Portfolio, Staking, Market News, memecoin Launch,
  Telegram alerts, Admin & Analytics.

## Try it

See **How to test Qrow** in the app (`/how-to-test`). In short: QoreX (testnet) + MetaMask holding the same
testnet-only account, free QOR from the [faucet](https://dashboard.qorechain.io/faucet), create your Qrow key on the
Start page, then send 1 QOR to a friend.

## Contracts (testnet, v2)

| Contract | Address |
| --- | --- |
| QrowKeys | `0x4ee5ca4c4d4ce7a7458a44c8eb155d7026f23db8` |
| QrowEscrow | `0xe51f1a2d28661bead6b0a75d3e4e2b3edff766da` |
| QrowGenesis | `0x73fe0fb443962c1e1503f57aba3cc6e895117287` |
| QrowMarket | `0xc9c9dab84f368d879aa8f96b5dbf5c22062da373` |
| QrowCoinFactory | `0x7ff6a8a047d9558c6b152a3cffe1adea19407836` |

Deployment details and every on-chain test transaction: [`docs/TEST_NOTES.md`](docs/TEST_NOTES.md).

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
