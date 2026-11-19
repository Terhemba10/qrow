# AI usage in Qrow

Qrow was built solo by Terhemba Jonathan Alumo with **Claude Code** (Anthropic, model Claude Opus 5.5) as the
development assistant. This file summarises how AI was used, what the human decided, and how the work was checked.
The full, dated build log is [`docs/AI_LOG.md`](docs/AI_LOG.md); 124 of the repository's 125 commits carry a
`Co-Authored-By: Claude` line.

## How the work was split

| The human (owner) | Claude Code |
| --- | --- |
| Wrote the brief, set the rules and approved the plan, every design decision and every contract design change | Researched the QoreChain docs, kits and SDK source, then proposed a plan with options |
| Funded every account, filled every `.env` and key file, approved every deploy and on-chain test | Wrote the contracts, tests, web app, servers, scripts and video pipeline |
| Ran the QoreX approvals (Claude never signs with the owner's wallet) | Ran tests, testnet scripts and browser checks, and reported what passed and what wasn't checked |
| Picked the logo, voice, music and final video | Made the options (logo directions, voice samples, video cuts) and the renders |

Standing rules the owner set and Claude followed throughout: testnet only, never mainnet; ask before contract design
changes, deletions and deploys; secrets only in `.env` and host settings, never committed, printed or logged; never
ask anyone for a private key, recovery phrase or code; dependency licences MIT / Apache-2.0 / BSD / ISC (one
owner-approved exception, below); nothing paid without approval; "never publish a button that will fail"; log AI use.

## What AI built, by area

**Contracts (Solidity, Foundry).** `QrowEscrow` (escrow with 7-day refunds, no owner, strict checks-effects-interactions),
`QrowKeys` (device keys), `QrowGenesis` and `QrowMarket` (on-chain NFT art and market), `QrowCoinFactory` (memecoin launch
with anti-scam rules), and later `QrowEditions`, `QrowPredict` and `QrowPerps` (with a take-profit / stop-loss keeper).
Every sensitive action carries an ML-DSA-87 signature checked on chain with QoreChain's `pqcVerify` precompile, bound to
the chain, contract, action, signer, nonce, expiry and parameters. The first contract run had 82/84 tests passing; Claude
fixed one test bug and one unclear revert, and the escrow reached 100% line coverage at its first release. The suite later grew to 150 tests.

**Web app (React, wagmi, viem).** Every tab: Hub, Faucet, Swap, Trade, Predictions, Send (with a 10-check agent for bad,
lookalike or poisoned addresses), Receive (QoreSeal encrypted notes, payment links and QR codes), NFT Shop, Create NFT,
NFT Market, Portfolio, History, Staking, Launch, Market News, Verify and Admin & Analytics. It also built the signing
design: QoreX approves every transaction, and a passkey-protected device key runs the contract call inside that approval
(see the README).

**Servers and tools.** The agent API and the read-only REST relay, the Telegram alert watcher, the keeper, the deploy and
test scripts, and the design system (tokens, components, a UX audit, and a Figma review sheet).

**Brand.** Three hand-written SVG logo directions (the owner picked "Return"), the export pipeline and colour tokens with a
built-in WCAG contrast check.

**Demo video.** Playwright recordings of the live site with real clicks and typing; a Three.js 3D intro; HTML title,
outro and thumbnail; HyperFrames and GSAP motion for an earlier cut; ffmpeg assembly, captions and a −13 LUFS mix. The
voiceover is AI-generated: first ElevenLabs (Bella, free plan), then Microsoft Edge's neural voice (en-US-AndrewNeural)
through `edge-tts` once the free credits ran out.

## AI inside the app

- **Send explanation.** After Qrow's own checks finish, one call to a small Claude model (`claude-haiku-5-5`, low effort,
  4-second timeout) rewords the results in plain language. It only rewords finished results: warnings are decided by
  code, show first and never wait for the AI. Addresses are replaced with `[address]` and the note never reaches the
  model. The API key stays on the server.

## How the work was checked

- Unit tests across contracts (Foundry), web (Vitest), agent and watcher, run before every commit.
- On-chain proofs on QoreChain testnet: the live `pqcVerify` precompile accepted the app's signature format; real
  payments, NFT mints, listings, a coin launch and swaps, with hashes in [`docs/TEST_NOTES.md`](docs/TEST_NOTES.md).
- Browser checks of the live site at desktop and 375 px, including console errors and sideways scrolling.
- Design reviews with the Hallmark and Impeccable skills (sloplint, detector, critique).
- For the video: frame sheets of every scene and transition, loudness measurement, and a check that no hidden tab or
  private data appears on screen.

## Mistakes AI caught or made, and how they were handled

- Found early that QoreX couldn't sign EVM transactions or arbitrary messages for websites, which changed the signing
  design. The owner approved the new plan before any code was written.
- Caught env files whose names weren't covered by `.gitignore` and fixed that before any commit.
- Found that QoreChain doesn't expose EVM logs from cross-VM calls, so the owner's Genesis NFT was missing from
  Portfolio. Portfolio, the Shop and History now read contract and chain state instead.
- A misleading "key not registered" error on Send (wrong pattern match) and a Verify amount shown in raw units (a lost
  backslash), both fixed with regression tests.
- While recording the video: a mistyped address checksum in the script (the app correctly refused it). Features that
  didn't load were reported to the owner, never faked; nothing was signed on camera.

## Licences and disclosures

- Qrow's own code is MIT. Every dependency is listed with its licence in the README's Credits.
- **One exception, approved by the owner:** `edge-tts` (LGPL-3.0) is used only as a local video tool in `video/.venv`.
  It is not an app dependency and isn't shipped.
- Demo video: "Voiceover: AI-generated". Music: Good Days by Aylex (Free To Use, https://freetouse.com/music).
