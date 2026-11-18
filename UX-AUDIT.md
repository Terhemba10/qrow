# Qrow UX audit (18 Nov 2026)

Live site https://qrow-app.vercel.app, audited at **1280 × 900** and **375 × 812** across all 19 routes, plus the code in `web/src`.
Method: `design:design-critique` and `design:accessibility-review` (WCAG 2.1 AA), a scripted pass on every route
(tap-target sizes, computed text contrast, labels, alt text, headings, overflow, header height, loading states),
screenshots, and a scan of all UI copy. Nothing has been changed yet.

## Step 0: skills and Figma budget

**Skills I'll use (all available):** `frontend-design`, `design:design-critique`, `design:accessibility-review`, `design:ux-copy`,
`design:design-system`, `figma:figma-use`, `figma:figma-generate-library`, `figma:figma-generate-design`,
`figma:figma-design-to-code`, `figma:figma-implement-motion`.
**Not available:** `figma:figma-3d-transforms`. I'll do the 3D hub in code: CSS 3D transforms, which the hub already uses.

**Figma plan (at most 8 of your ~11 calls; I'll tell you before each one):**
1. `create_new_file` "Qrow UI v2" (exempt from the read limit, but I'll count it)
2. `create_session`
3. `use_figma`: token variables + text styles + core components in one batch
4. `use_figma`: Hub + Trade at desktop and mobile
5. `use_figma`: Predictions + TxReviewSheet at desktop and mobile
6. `use_figma`: one fix pass, only if the screenshots show problems
7. `get_screenshot`: contact sheet for you to review
8. spare, kept for a fix after your review

Note: the earlier "Qrow — Redesign" file (36 frames, 18 Nov) still exists and was never approved. "Qrow UI v2" replaces it as the reference.

## What works well
- Strong safety foundations: Send's first-4/last-4 address check, look-alike warnings, receipts with hashes, a Verify page, no key ever asked for.
- No horizontal scroll at 375 px on any route; every route has exactly one `h1`; no inputs without labels; no images without alt text.
- Body text contrast passes AA everywhere I measured (muted #a3a7c9 on #14162c ≈ 7.9:1).
- The 3D hub already respects reduced motion and has a flat view.

## Top 15 issues, ranked by impact

| # | Issue (where) | Evidence | Impact | Fix |
|---|---|---|---|---|
| 1 | **Four different "review before signing" screens.** Send has its own ConfirmSheet; contract actions use ActionFlow; Swap and Staking have their own; AI top-ups and the Predictions "Authorise" go straight to QoreX with no review. | Code: `ConfirmSheet`, `ActionFlow`, `SwapPage`, `StakingPage`, `AiPage` each build their own | 🔴 Users can't learn one pattern; AI top-ups send QOR without a review | One `TxReviewSheet` for every transaction: send / get / one total fee (expandable) / recipient chip / network, then one "Confirm in QoreX" |
| 2 | **No fee shown before most contract actions.** ActionFlow lists details but never the network fee. | `ActionFlow.tsx` shows no fee row | 🔴 People sign without knowing the cost; "not enough QOR" surprises | Estimate and show one total fee with a breakdown (device fee, QoreX fee, per step) |
| 3 | **Mobile: content starts 272 px down** (a third of the screen) under the header (89 px), beta banner and welcome tip, then an 18-tab sideways-scrolling strip. | Measured `main` top = 272 px on every route at 375 px | 🔴 Every phone screen opens mostly chrome; tabs past the 6th are hidden | Bottom nav (Hub, Trade, Predict, NFTs, More), compact top bar with a TESTNET pill + wallet chip, banner merged into the pill, welcome as a dismissible 3-step strip |
| 4 | **Tabs hide their content until you connect** (Send, Receive, Portfolio, History, AI, Create NFT form, Trade form). | Send shows only "Connect QoreX to start" | 🔴 Visitors can't see what a tab does; the brief asks to browse first, connect only to sign | Show forms and sample/empty states for everyone; ask to connect on the action button ("Connect QoreX to send") |
| 5 | **Tap targets under 44 px** on 20–37 elements per page on mobile: every nav tab (40 px), Connect (40 px), the logo link (26 px), quiet buttons (40 px), NFT Market's "Create your own" (40 px), News source links (17 px). | Scripted measurement, all routes | 🟡 Mis-taps on phones; fails WCAG 2.5.5 | 44 px minimum on every control; bigger hit areas for inline links |
| 6 | **Jargon without explanation**: "EVM window" (14×), "quantum-safe key / ML-DSA" (13×), "slippage" (4), "uqor", "permission", "MsgCrossVMCall" in errors. | Copy scan of `pages/` + `components/` | 🟡 New users don't know what they're approving | Plain-English copy (`design:ux-copy`); a "What's this?" tip for the 3 terms that must stay |
| 7 | **Errors don't always give a fix.** Some say "The chain refused it: …raw log…"; others link to the right fix (faucet). | `xvm.ts friendlyChainError`, `explainError` | 🟡 Dead ends after a failure | Every error = what happened + one fix button ("Not enough test QOR. Get more from the Faucet") |
| 8 | **No transaction status after confirm.** Status is a line of text inside the sheet; leaving the tab loses it. | `ActionFlow` phase text | 🟡 Users wonder whether it worked | `TxStatusToast`: pending → confirmed → failed, persists across tabs, with an explorer link |
| 9 | **Loading states are mostly blank or text** ("Checking…", "Working…"). Only 14 of 23 pages use any skeleton, and lists like Predictions, Trade positions and AI show nothing while loading. | Code scan | 🟡 Looks broken on slow testnet RPC | Skeletons on every list and stat; spinners nowhere |
| 10 | **Empty states are flat sentences** ("No positions.", "Nothing listed yet.") with no next step. | Market, Trade, Portfolio, History | 🟡 Dead ends for new users | `EmptyState` with an icon, one line and one action ("List your first NFT") |
| 11 | **Steps that can go:** Predictions' "Authorise in QoreX" (the account is now confirmed once per session); the duplicate beta banner + welcome tip; a "Review" step followed by a second "…in QoreX" button on simple actions where the review sheet can show both. | Flow walkthrough | 🟡 Extra clicks and prompts | Remove Authorise; merge banner into the TESTNET pill; one review sheet with a single confirm |
| 12 | **Weak hierarchy:** pages open with a long paragraph; headings are 40 px sentence case; stat numbers are the same size as body text (Admin, AI price list, Portfolio). | Screenshots | 🟢 Hard to scan; doesn't feel like a dashboard | Condensed uppercase display headings, big stat numbers with sparklines, one-line subtitles |
| 13 | **Inconsistent spacing, radius and colour:** newer CSS uses fallback values (`var(--surface, #121a30)`) beside the token file; three different card radii (14/16/28); accent colours hard-coded per page. | `app.css`, `hub.css` | 🟢 Looks assembled rather than designed | One token set (colour, type, space, radius, shadow, motion) used by shared components |
| 14 | **Addresses shown four different ways** (`0xD5…cb37`, `0xD517…cb37`, full, qor1…), not always copyable. | Header chip, Market, History, Portfolio | 🟢 Confusing; harder to compare addresses | `AddressChip`: first 6 + last 4, copy button, full address on long-press/hover |
| 15 | **Gradient buttons need care:** dark text on the cyan→purple gradient measures ≈ 4.9:1 at the purple end (passes, narrowly); the focus ring is a light teal that's faint on cyan tiles. | Manual contrast check (the script can't read gradients) | 🟢 Borderline for low-vision users | Solid accent buttons, plus a 2-colour focus ring that shows on every accent |

## Accessibility summary (WCAG 2.1 AA)
**Issues:** 7 (critical 0, major 3, minor 4)
- **2.5.5 Target size**, major: see #5.
- **1.4.11 Non-text contrast**, minor: the focus ring on cyan/mint tiles is faint (#15).
- **4.1.2 Name, role, value**, minor: the segmented controls are radio groups (good), but the hub tiles' "Coming soon" state isn't announced.
- **3.3.1 Error identification**, major: errors aren't always tied to the field (`aria-describedby`) and some have no fix (#7).
- **4.1.3 Status messages**, major: transaction progress isn't in a live region that survives leaving the tab (#8).
- **1.4.3 Contrast**, pass: body, muted and link text all pass on the measured backgrounds.
- **2.4.7 Focus visible**, pass on the default theme; to recheck after the redesign.

## Proposed order (after your OK)
1. Tokens + shared components (Button, Pill, Card, StatCard, TokenAmount, AddressChip, TxReviewSheet, TxStatusToast, EmptyState, Skeleton, NetworkBadge).
2. Mobile shell: bottom nav, compact header, onboarding strip; browse-before-connect on every tab.
3. TxReviewSheet + TxStatusToast wired into every transaction (Send, Receive, Swap, Trade, Predictions, NFTs, Launch, Staking, AI top-up).
4. Copy pass, empty/loading states, hub smoothing, micro-interactions.
5. Figma "Qrow UI v2" (≤ 8 calls) → your approval → implement across all tabs → verify → push only after you approve.

Contract addresses, on-chain logic and env vars stay as they are.
