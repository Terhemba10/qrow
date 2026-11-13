# Qrow demo video — BRIEF (make-a-video, Gate 4)

**Status:** waiting for the owner's approval. Nothing is built until "yes, build it".

## Gate 1 · Intent & format (already decided)
- **Slug:** `qrow-demo`
- **For:** the QoreChain "Build Before Q-Day" hackathon submission (Post-Quantum dApp category), and the public launch.
- **Audience:** hackathon judges and QoreChain testnet users; crypto-literate, not all technical.
- **Duration:** 2:26 (full cut) or 2:08 (alternate cut, if QoreX can't approve payments yet). Hard limit 3:00.
- **Format:** 16:9, 1920×1080, 30 fps. **Delivery:** YouTube (title includes "elevenlabs.io"; non-commercial; personal account).

## Gate 2 · Script & voice (already decided)
- **Script:** `video/script.json` (9 shots + 1 alternate), 232 words, phonetic spellings for the voice only.
- **Voice:** ElevenLabs free plan, **Bella**, `eleven_v4`, already generated per shot (`video/audio/shots/`), every clip fits its scene.
- **Captions:** from the script (match the voice word for word), split at the voice's pauses. Style proposal: **minimal** (bottom-centre, General Sans, white on a soft dark band), burned in, plus the SRT for YouTube.
- **No face-cam.** (So no hand-off to short-form-edit.)

## Gate 3 · Style (from the workspace; nothing new imposed)
- **Brand:** Qrow's own: navy `#14162c`, deep `#0d0f22`, ink `#eef0ff`, ink-2 `#b9bde0`, accent gradient teal `#3ef0d2` → violet `#9b4dff`. Fonts **General Sans** (display/body) + **Geist Mono** (addresses, hashes, numbers). Logo: the Qrow lockup (`web/src/components/Logo.tsx`).
- **Style library:** **Kallaway "aurora glass"** (02-kallaway) re-tinted to Qrow's tokens (its blue → Qrow teal/violet; its fonts → General Sans / Geist Mono). Fits Qrow's dark UI; Vox's paper collage does not.
- **Pacing:** balanced (2–3 s per visual change), calm voice ~150 wpm.
- **Music:** "Good Days" by Aylex (Free To Use) as a low bed (~−30 LUFS, ducked under the voice): `video/audio/music/`.
- **Assets:** footage of the live site (`video/raw/*.mp4`, recorded with Playwright; owner's QoreX clips to come), brand fonts (`brand/fonts`), logo SVG.
- **Outro / CTA:** "Try it free on testnet: qrow-app.vercel.app" · github.com/Terhemba10/qrow · Built in Doha, Qatar · "Voiceover: AI-generated (ElevenLabs)" · "Music: Good Days by Aylex (freetouse.com)".

## Which kit skill does what (proposal)

| Part of the video | Skill | What it does here |
| --- | --- | --- |
| The whole process | **make-a-video** | This brief, the storyboard with a timing table, the HyperFrames project, lint, Studio preview (gate 1), draft render, frame-by-frame verification, MP4 preview (gate 2), final render. |
| Story and beats | **video-storytelling** | Review the 9-shot script for hook, tension and payoff; propose small wording changes (each changed line costs one regenerated voice clip; you approve first). |
| Look of every card | **style-library** | Kallaway aurora-glass cards in Qrow colours: tier-1 takeovers (e.g. "One approval per action", "ML-DSA-87, verified by the chain") and tier-2 labels floating over the footage (e.g. pointing at the receipt hash). |
| Opening hook (s01) and end lockup (s09) | **motion-showreel** | One brand motif (the Qrow "Q" lattice) transformed across the 12 s hook and answered by the held logo lockup at the end, cut to the music's beat. |
| Building and rendering | **hyperframes** (+ gsap) | The composition: footage tracks, cards, captions, transitions, soundtrack; lint, preview, render to MP4. |
| Silences / mistakes | **cut-silences, cut-mistakes** | **Not applicable**: both edit a recorded speaker (dead air, stutters, retakes) from a word-level transcript. Qrow's narration is generated (no stutters; pause check already clean) and the screen clips have no speech. I'd run neither unless you record narration yourself. |

## Demonstration layer (owner's request: show the mouse, the clicks and where to type)
- **Cursor:** the highlighted teal cursor in every automatic clip, now with a **ripple on each click** and a slower,
  deliberate glide; in the owner's QoreX clips the real cursor (Game Bar "capture cursor").
- **Typing you can follow:** amounts and addresses typed character by character at reading speed (amount "1",
  recipient pasted then highlighted), with a small **key chip** on screen ("1", "Paste") while typing.
- **Camera push (hyperframes):** a smooth zoom (about 1.4×) onto the field being used: "You pay" on Swap, "Recipient"
  and "Amount" on Send, the hash box and "verified by the chain" on Verify; back out before the next click.
- **Step callouts (style-library tier-2 glass labels):** one short label per action, pointing at it:
  "Type the amount here", "Paste the recipient's address", "Review, then one approval in QoreX",
  "Your receipt and its hash", "Paste any hash to verify". Never covering the thing being pointed at.
- **Step counter** on the Swap and Send scenes ("1 Type · 2 Review · 3 Approve"), lit as each step happens, so judges
  see the one-approval flow at a glance.
- Applies to the automatic clips (re-recorded with click ripples and slower typing) and, in post, to the owner's
  QoreX clips (callouts and zooms added in the edit; the approval itself is shown as recorded, never faked).

## Pacing structure (rule of threes)
- Act 1, hook (≈20%): s01 hook + s02 what.
- Act 2, body (≈55%): s03 connect/faucet, s04 swap, s05 send, s06 claim, s07 verify.
- Act 3, payoff (≈25%): s08 more + s09 end card with a 4–6 s hold.

## Project folder
`qrow/video/hf/` (HyperFrames project; renders in `qrow/video/hf/renders/`, git-ignored). The kit stays in Downloads; nothing from it enters Qrow's app or repo except the project's own HTML.

## Open points for the owner
1. Approve the skill map above (especially: cut-silences and cut-mistakes not used, with the reason).
2. Caption style: **minimal** burned-in (proposal), or captions only as the YouTube SRT (cleaner picture).
3. Script edits from video-storytelling: allowed (I'll show them before regenerating any voice line)?
