# Your part of the demo footage (real QoreX only)

Everything else is recorded automatically. Your clips are only the moments that need a real QoreX approval.
Save each clip into `qrow/video/raw/` with **exactly** the file name below (MP4). Then tell me, and I'll assemble.

## Before you record (not filmed)

1. **Screen:** 1920×1080 if you can (Settings → System → Display → resolution 1920×1080, scale 100%). Turn on
   **Focus assist / Do not disturb** so no notifications pop up.
2. **Browser:** Chrome with QoreX, on **testnet**, open https://qrow-app.vercel.app, zoom 100%, then press **F11**
   (full screen: no browser bars or bookmarks on screen).
3. **QoreX accounts:**
   - **Account A:** your test account `0xa99c…41fc` (it has the QOR and fUSD). The automatic clips show this
     account, so use it for clips 1–3.
   - **Account B:** a second QoreX account. It receives the payment in clip 3 and claims it in clip 4.
     **Send me B's public address** (0x… or qor1…, never a key or phrase) and I'll re-record the automatic form part
     so it types B's address; your clip 3 then continues the same payment.
4. **Recorder:** Win + Alt + R (Xbox Game Bar) starts and stops a recording of the active window. In Game Bar
   settings, tick **"Capture mouse cursor when recording"**. Recordings land in `Videos\Captures`.
   **Do a 5-second test first:** Game Bar records one window, and QoreX's approval pop-up is a separate window. If the
   pop-up is missing from the test, record with OBS Studio (Display Capture, 1920×1080, 30 fps) instead.
5. Move slowly, pause about 1 second after each click, and keep the cursor still while QoreX is open.
6. Nothing secret may be on screen: never open QoreX's recovery phrase or key pages while recording.
   Addresses and transaction hashes are fine.

## The clips

| # | File name | Length | Start recording at | Record | Stop after |
| --- | --- | --- | --- | --- | --- |
| 1 | `s03a-connect.mp4` | 5–7 s | Start page, **not connected** (disconnect first, unfilmed) | Click **Connect QoreX** → approve in QoreX | The header shows `0xa9…41fc` (1 s) |
| 2 | `s04-swap.mp4` | 20–25 s | Swap tab, connected as A | Type **1** QOR → fUSD, wait for the quote, **Review swap** → **Swap in QoreX** → approve in QoreX | The receipt "Swap confirmed" with its hash (2 s) |
| 3 | `s05b-send.mp4` | 17–22 s | Send tab with the form **already filled** (unfilmed): recipient = account B, **1 fUSD**, "Recipient claims it" | **Review payment** → the confirm screen → **Send in QoreX** → approve in QoreX (+ fingerprint/face/PIN) | The receipt with QRW-PAY-… and the hash (2 s) |
| 4 | `s06-claim.mp4` | 14–18 s | Switch QoreX to account B (unfilmed), Receive tab | **Claim** on the 1 fUSD payment → **Claim in QoreX** → approve in QoreX (+ fingerprint/face/PIN) | The receipt "Claimed: 1 fUSD" (2 s) |
| 5 (optional) | `s08b-staking.mp4` | 3 s | Staking tab, connected as A | Slow scroll down a little | 3 s |

That's about 60–75 seconds of recording in total. Slightly longer clips are fine: I trim them, or speed them up by
at most 1.35×, to fit each scene. The voice is never changed.

## If QoreX can't approve payments yet

If clip 3 fails (for example QoreX refuses the combined approval), skip clips 3 and 4 and record only 1 and 2.
I'll use the alternate cut: Send is replaced by the Verify page reading a real Qrow payment (QRW-PAY-000003),
and Claim is dropped. That cut is already assembled (2:08).
