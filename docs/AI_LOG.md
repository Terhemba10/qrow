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
