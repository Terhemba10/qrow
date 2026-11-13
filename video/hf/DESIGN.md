# Qrow demo — DESIGN

Source: the Herk Edit Kit style library, **02-kallaway ("aurora glass")**, re-tinted to Qrow's own brand
(`web/src/styles/tokens.css`, `brand/`). Structure, glass, glow and motion from Kallaway; colours and type from Qrow.

## Style Prompt
Premium dark product demo. The real Qrow app is the hero: full-frame screen footage of the live site on Qrow's navy,
with a smooth camera that pushes in on the exact field being used and pulls back out. Over it float frosted-glass
labels with a hairline teal-to-violet top edge and a dashed connector ending in a glowing dot on the thing to do:
one label at a time, never covering it. A slim journey rail runs across the top (Connect → Faucet → Swap → Send →
Claim → Verify), quiet until its step is live. Everything glides (long expo eases); nothing snaps or stutters.

## Colors
- Canvas navy `#14162c`, deep well `#0d0f22` (vignette, card backs)
- Text `#eef0ff`, dim `#b9bde0`, faint `rgba(238,240,255,.42)`
- Accent teal `#3ef0d2` (the one glow per beat), accent violet `#9b4dff` (gradient partner only)
- Ok green `#4ade80` only for "confirmed / verified" ticks

## Typography
- **General Sans** 500–600: labels, rail, counter, captions, cards.
- **Geist Mono** 400–500: addresses, hashes, numbers, key chips.

## Motion
- Entrances `expo.out` / `power4.out` 0.6–0.9 s; cards `back.out(1.4)` once per scene at most.
- Camera: one gesture per move, `power2.inOut`, 0.9–1.3 s, push ≤ 1.5×, framing windows never cut a label at the edge.
- No cross-fades on full-frame layers; scene changes are a short gradient sweep on an opaque edge.

## What NOT to Do
- No fake wallet UI: QoreX approvals appear only as the owner recorded them.
- No more than one label and one glow at a time; no decorative shapes without a word.
- No pure white type, no labels within 60 px of the frame edge, no full-screen linear gradients (banding).
- No Kallaway blue or yellow: Qrow teal/violet only.
