# Qrow demo video

Under 3:00, AI voiceover (ElevenLabs), captions from the script. The script lives in git ([script.json](script.json));
generated audio (`audio/`) and renders (`out/`) stay local and are git-ignored.

## Voiceover workflow

1. Owner: create an ElevenLabs account and put `ELEVENLABS_API_KEY=...` in `qrow/video/.env` (git-ignored; never
   pasted into chat). `tts.mjs` reads it from there and never prints it.
2. `node tts.mjs samples`: the opening lines in three voices (default Sarah, Brian, George, all pre-made, so they
   work on any plan) → `audio/samples/`. The owner picks one.
3. `node tts.mjs shots --voice <Name>`: one clip per shot, stitched with the neighbouring lines so the tone flows,
   → `audio/shots/<shot>.mp3` plus `timing.json`. It reports each clip's length against its scene and the pace
   (target about 150 words per minute). Default model `eleven_v4` (best quality, no speed control); if the pace is
   off, use `--model eleven_multilingual_v2 --speed 0.95` (or similar).
4. `node tts.mjs captions` → `out/captions.srt`, built from the same words the voice reads, so they match exactly.
5. Edit: each clip starts 0.3 s into its scene. When a clip is longer than its footage, trim or slightly speed up the
   **footage**, never the voice. Music, if any, sits well under the voice (about −20 dB below it); master to about
   −14 LUFS integrated, true peak ≤ −1 dBTP (YouTube's loudness target, no clipping), for example
   `ffmpeg -i in.mp4 -af loudnorm=I=-14:TP=-1:LRA=11 -c:v copy out.mp4`.

Pronunciations (in `script.json`, applied only to what the voice reads): Qrow = "crow", QoreChain = "core-chain",
QoreX = "core-ex", QOR = "core", fUSD = "F-U-S-D", ML-DSA = "M-L-D-S-A".

Shots s05 (Send) and s06 (Claim) need QoreX to approve the combined one-step approval (the owner's QoreX check,
tests 4 and 5). If those tabs are still "Coming soon" when recording, use `s05-alt` instead and drop s06: the video
only shows what works.

## Licence and attribution (ElevenLabs, checked 13 Nov 2026)

- **Free plan:** non-commercial only, and published content must credit ElevenLabs by putting **"elevenlabs.io"**
  (or "11.ai") **in the title**. Its 10,000 credits a month cover this script (about 1,400 characters) several
  times over.
- **Paid plans (Starter $6/month, $1 the first month):** include a commercial licence for content made while
  subscribed; the help page leaves any credit requirement to your agreement with ElevenLabs.
- A hackathon entry with prizes is arguably promotional, so the safe choices are: Starter for the month you
  generate the audio (needs the owner's OK: it's paid), or the free plan with "elevenlabs.io" in the video title.
- **Decision (owner, 13 Nov, replaces the earlier Starter plan):** the **free plan**. So the video is
  **non-commercial** (no monetisation, ads or sponsorships) and its **title includes "elevenlabs.io"**:
  *Qrow: quantum-safe payments on QoreChain testnet (voice: elevenlabs.io)*. The "Voiceover: AI-generated
  (ElevenLabs)" disclosure stays in the end card and the description.
- Sources: [Can I publish the content I generate?](https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform),
  [Pricing](https://elevenlabs.io/pricing).

## Transparency

- End card (shot s09) shows **"Voiceover: AI-generated"**.
- YouTube title (free-plan rule): **Qrow: quantum-safe payments on QoreChain testnet (voice: elevenlabs.io)**
- YouTube description (draft):

> Qrow: escrow payments on QoreChain testnet, every step signed with a quantum-safe key (ML-DSA-87). Connect QoreX
> once, then one approval per action, with a receipt and a transaction hash you can verify on testnet.
> Try it: https://qrow-app.vercel.app · Code (MIT): https://github.com/Terhemba10/qrow
> Built in Doha, Qatar, for QoreChain's Build Before Q-Day Developer Fest. Public beta on testnet: tokens have no value.
> Voiceover: AI-generated (ElevenLabs). Captions match the narration.
