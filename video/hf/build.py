"""Generate the HyperFrames composition for the Qrow demo (index.html). Edit this generator, never index.html.

    ../.venv/Scripts/python build.py          full cut   (uses ../out/edl.json, captions.srt, soundtrack.wav)
    ../.venv/Scripts/python build.py --alt    alternate  (edl-alt.json, captions-alt.srt, soundtrack-alt.wav)

Skills: make-a-video (gates), hyperframes + gsap (framework rules), video-storytelling (persistent journey
rail, one spotlight at a time, camera is the edit, open loop closed at the end), style-library (Kallaway
"aurora glass" labels re-tinted to Qrow: tokens.css, DESIGN.md), motion-showreel (Q-motif opener and the
held logo lockup, timed to the music's beat grid).

Inputs: ../out/edl*.json (where each footage segment sits), ../raw/<clip>.events.json (what was clicked,
typed or pointed at, where and when), ../out/captions*.srt, ../out/soundtrack*.wav.
"""
import html
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIDEO = HERE.parent
ALT = "--alt" in sys.argv
ASSETS = HERE / "assets"

# ---------------------------------------------------------------- frame & grid
W, H = 1920, 1080
WIN_X, WIN_Y, K = 134, 62, 0.86          # the footage window: 1651x929, room for the rail above and captions below
WIN_W, WIN_H = round(W * K), round(H * K)
PERIOD, PHASE, LOOP_AT = 0.4644, 0.225, 118.85 - 3.0   # Good Days: 129.2 BPM; mix.mjs loops it with a 3 s crossfade


def beat(n: float, after_loop=False) -> float:
    return (LOOP_AT if after_loop else 0.0) + PHASE + n * PERIOD


RAIL = ["CONNECT", "FAUCET", "SWAP", "SEND", "CLAIM", "VERIFY"]
SCENE_STEP = {"s03-connect-faucet": [0, 1], "s04-swap": [2], "s05-send": [3], "s05-alt": [3], "s06-claim": [4], "s07-verify": [5]}
OWNER_NOTES = {  # labels over the owner's real QoreX clips (no coordinates: placed in the window's lower right)
    "s03a-connect.mp4": [(0.4, "Connect once, in QoreX")],
    "s04-swap.mp4": [(0.5, "Type the amount here"), (0.42, "Review, then one approval in QoreX"), (0.78, "Your receipt and its hash")],
    "s05b-send.mp4": [(0.15, "One approval in QoreX"), (0.75, "Your receipt and its hash")],
    "s06-claim.mp4": [(0.2, "Claim with one approval"), (0.75, "Claimed: receipt and hash")],
}
STEPS3 = ["Type", "Review", "Approve"]


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def srt(path: Path):
    blocks = re.split(r"\r?\n\r?\n", path.read_text(encoding="utf-8").strip())
    out = []
    for b in blocks:
        lines = b.splitlines()
        a, c = lines[1].split(" --> ")
        to_s = lambda x: (lambda h, m, s: int(h) * 3600 + int(m) * 60 + float(s.replace(",", ".")))(*x.strip().split(":"))
        out.append((to_s(a), to_s(c), " ".join(lines[2:])))
    return out


def load():
    edl = json.loads((VIDEO / "out" / ("edl-alt.json" if ALT else "edl.json")).read_text(encoding="utf-8"))
    caps = srt(VIDEO / "out" / ("captions-alt.srt" if ALT else "captions.srt"))
    return edl, caps


def copy_assets(edl):
    (ASSETS / "clips").mkdir(parents=True, exist_ok=True)
    (ASSETS / "fonts").mkdir(parents=True, exist_ok=True)
    for sc in edl["scenes"]:
        for sg in sc["segments"]:
            src = VIDEO / "out" / "_segments" / sg["segment"]
            dst = ASSETS / "clips" / sg["segment"]
            if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
                shutil.copy2(src, dst)
    sound = VIDEO / "out" / ("soundtrack-alt.wav" if ALT else "soundtrack.wav")
    shutil.copy2(sound, ASSETS / "soundtrack.wav")
    for f in (VIDEO.parent / "brand" / "fonts").glob("GeneralSans-*.otf"):  # local render only (licence: no redistribution; git-ignored)
        shutil.copy2(f, ASSETS / "fonts" / f.name)


# ---------------------------------------------------------------- camera & labels from recorded events
def events_for(sg):
    p = VIDEO / "raw" / sg["file"].replace(".mp4", ".events.json")
    if sg["missing"] or not p.exists():
        return []
    out = []
    for e in json.loads(p.read_text(encoding="utf-8"))["events"]:
        t = sg["start"] + (e["t"] - sg["in"]) / sg["speed"]
        if sg["start"] + 0.2 <= t <= sg["start"] + sg["slot"] - 0.6 and e.get("label"):
            out.append({**e, "T": round(t, 3)})
    # group consecutive events with the same label (click + type on one field = one beat)
    groups = []
    for e in out:
        if groups and groups[-1]["label"] == e["label"] and e["T"] - groups[-1]["T_end"] < 2.5:
            groups[-1]["T_end"] = e["T"] + e.get("dur", 0)
            groups[-1]["events"].append(e)
        else:
            groups.append({"label": e["label"], "T": e["T"], "T_end": e["T"] + e.get("dur", 0), "box": e["box"], "events": [e]})
    return groups


def framing(box):
    """Camera (scale s, translate tx, ty in video px) centring `box`, never exposing the frame edge."""
    x, y, w, h = box
    s = min(1.5, (0.5 * W) / max(w, 1), (0.42 * H) / max(h, 1))
    if s < 1.12:
        return 1.0, 0.0, 0.0
    cx, cy = x + w / 2, y + h / 2
    tx = min(0.0, max(W - W * s, W / 2 - cx * s))
    ty = min(0.0, max(H - H * s, H / 2 - cy * s))
    return round(s, 3), round(tx, 1), round(ty, 1)


def to_screen(box, cam):
    s, tx, ty = cam
    x, y, w, h = box
    return (WIN_X + K * (tx + s * x), WIN_Y + K * (ty + s * y), K * s * w, K * s * h)


# ---------------------------------------------------------------- build
def main():
    edl, caps = load()
    copy_assets(edl)
    total = edl["total"]
    scenes = edl["scenes"]
    sc_by_id = {s["id"]: s for s in scenes}
    body = [s for s in scenes if s["id"] not in ("s01-hook", "s09-end")]
    body_start, body_end = body[0]["start"], body[-1]["start"] + body[-1]["dur"]
    end_start = sc_by_id["s09-end"]["start"]

    clips, overlays, js = [], [], []
    track = [10]

    def next_track():
        track[0] += 1
        return track[0]

    # Footage segments (body scenes only; hook and end are motion compositions)
    for sc in body:
        for i, sg in enumerate(sc["segments"]):
            clips.append(f'<video id="v-{sc["id"]}-{i}" class="seg" src="assets/clips/{sg["segment"]}" data-start="{sg["start"]}" data-duration="{sg["slot"]}" data-track-index="{1 if i % 2 == 0 else 4}" muted playsinline></video>')

    # Camera moves + labels + key chips
    cam_moves = []  # (t_start, dur, (s,tx,ty))
    label_n = 0
    for sc in body:
        for sg in sc["segments"]:
            seg_end = sg["start"] + sg["slot"]
            js.append(f'tl.set("#cam", {{scale: 1, x: 0, y: 0}}, {sg["start"]});')
            groups = events_for(sg)
            current = (1.0, 0.0, 0.0)
            prev_free = sg["start"] + 0.1
            for gi, g in enumerate(groups):
                cam = framing(g["box"])
                nxt = groups[gi + 1]["T"] if gi + 1 < len(groups) else seg_end
                move_at = max(prev_free, g["T"] - 0.55)
                if cam != current:
                    js.append(f'tl.to("#cam", {{scale: {cam[0]}, x: {cam[1]}, y: {cam[2]}, duration: 0.9, ease: "power2.inOut"}}, {move_at:.3f});')
                    current = cam
                release = min(nxt - 0.6, g["T_end"] + 3.0, seg_end - 0.9)
                if (nxt - g["T"] > 3.6 or gi + 1 == len(groups)) and current != (1.0, 0.0, 0.0) and release > move_at + 1.2:
                    js.append(f'tl.to("#cam", {{scale: 1, x: 0, y: 0, duration: 0.9, ease: "power2.inOut"}}, {release:.3f});')
                    current = (1.0, 0.0, 0.0)
                    prev_free = release + 0.95
                else:
                    prev_free = move_at + 0.95
                # The label (one at a time): from arrival until just before the next beat
                t_in = move_at + 0.75
                t_out = min(nxt - 0.15, release + 0.4 if release > t_in else nxt - 0.15, t_in + 3.2)
                if t_out - t_in < 0.9:
                    continue
                sx, sy, sw, shh = to_screen(g["box"], cam)
                overlays.append(label_card(f"lb{label_n}", g["label"], (sx, sy, sw, shh), t_in, t_out - t_in, next_track()))
                js.extend(label_js(f"lb{label_n}", t_in))
                label_n += 1
                for e in g["events"]:
                    if e["kind"] in ("type", "paste"):
                        key = "Ctrl + V" if e["kind"] == "paste" else e["text"]
                        overlays.append(key_chip(f"kc{label_n}", key, (sx, sy, sw, shh), e["T"], 1.6, next_track()))
                        js.extend(key_js(f"kc{label_n}", e["T"]))
                        label_n += 1
            # Labels over the owner's clips
            for frac, text in OWNER_NOTES.get(sg["file"], []):
                t_in = sg["start"] + frac * sg["slot"]
                d = min(2.6, sg["start"] + sg["slot"] - t_in - 0.3)
                if d > 0.9:
                    overlays.append(label_card(f"lb{label_n}", text, None, t_in, d, next_track()))
                    js.extend(label_js(f"lb{label_n}", t_in))
                    label_n += 1

    # Step counter on Swap and Send ("1 Type · 2 Review · 3 Approve")
    for sid in ("s04-swap", "s05-send"):
        sc = sc_by_id.get(sid)
        if not sc:
            continue
        t0, dur = sc["start"], sc["dur"]
        if sid == "s05-send":
            form = sc["segments"][0]
            lights = [form["start"] + 1.0, form["start"] + form["slot"] - 0.2, form["start"] + form["slot"] + 0.35 * (dur - form["slot"])]
        else:
            lights = [t0 + 0.25 * dur, t0 + 0.42 * dur, t0 + 0.6 * dur]
        overlays.append(steps3(f"st-{sid}", t0 + 0.4, dur - 0.6, next_track()))
        js.append(f'tl.from("#st-{sid}", {{y: -18, opacity: 0, duration: 0.6, ease: "expo.out"}}, {t0 + 0.5:.3f});')
        for k, tl_ in enumerate(lights):
            js.append(f'tl.to("#st-{sid} .step{k}", {{opacity: 1, duration: 0.35, ease: "power2.out"}}, {tl_:.3f});')
            js.append(f'tl.to("#st-{sid} .step{k} .num", {{backgroundColor: "#3ef0d2", color: "#07081a", duration: 0.35}}, {tl_:.3f});')

    # Journey rail (open loop): planted ghosted in the hook, advanced each scene, all lit at the end
    rail_start = beat(21)
    js.append(f'tl.from("#rail .rstep", {{opacity: 0, y: -10, duration: 0.5, ease: "expo.out", stagger: 0.09}}, {rail_start:.3f});')
    lit_at: dict[int, float] = {}
    for sc in body:
        for k in SCENE_STEP.get(sc["id"], []):
            t = sc["start"] + 0.2 + (0 if k != 1 or sc["id"] != "s03-connect-faucet" else sc["segments"][0]["slot"])
            lit_at[k] = min(lit_at.get(k, 1e9), t)
    order = sorted(lit_at.items(), key=lambda kv: kv[1])
    for i, (k, t) in enumerate(order):
        js.append(f'tl.to("#rail .r{k}", {{opacity: 1, duration: 0.4, ease: "power2.out"}}, {t:.3f});')
        js.append(f'tl.to("#rail .r{k} .dot", {{backgroundColor: "#3ef0d2", boxShadow: "0 0 14px rgba(62,240,210,.8)", scale: 1.25, duration: 0.4}}, {t:.3f});')
        if i + 1 < len(order):  # done: quiet but legible
            js.append(f'tl.to("#rail .r{k}", {{opacity: 0.62, duration: 0.4}}, {order[i + 1][1]:.3f});')
            js.append(f'tl.to("#rail .r{k} .dot", {{scale: 1, boxShadow: "0 0 0 rgba(0,0,0,0)", duration: 0.4}}, {order[i + 1][1]:.3f});')
    js.append(f'tl.to("#rail .rstep", {{opacity: 1, duration: 0.6, stagger: 0.08}}, {end_start + 0.6:.3f});')
    js.append(f'tl.to("#rail .dot", {{backgroundColor: "#3ef0d2", boxShadow: "0 0 14px rgba(62,240,210,.8)", scale: 1.15, duration: 0.5, stagger: 0.08}}, {end_start + 0.6:.3f});')

    # Counter chip: numeral + name, swapped per scene (stacked spans, opacity only)
    counter_items = []
    for sc in body:
        steps = SCENE_STEP.get(sc["id"])
        if not steps:
            continue
        for j, k in enumerate(steps):
            t = sc["start"] + (0 if j == 0 else sc["segments"][0]["slot"])
            counter_items.append((t, k))
    for i, (t, k) in enumerate(counter_items):
        js.append(f'tl.fromTo("#counter .c{k}", {{opacity: 0, y: 14}}, {{opacity: 1, y: 0, duration: 0.45, ease: "expo.out"}}, {t + 0.15:.3f});')
        if i + 1 < len(counter_items):
            js.append(f'tl.to("#counter .c{k}", {{opacity: 0, y: -14, duration: 0.3, ease: "power2.in"}}, {counter_items[i + 1][0] - 0.32:.3f});')
            js.append(f'tl.set("#counter .c{k}", {{opacity: 0}}, {counter_items[i + 1][0]:.3f});')  # hard kill for seeking

    # Window: wipes open after the hook, closes before the end card; a gradient sweep covers each scene cut
    js.append(f'tl.fromTo("#win", {{clipPath: "inset(50% 50% 50% 50% round 22px)"}}, {{clipPath: "inset(0% 0% 0% 0% round 22px)", duration: 0.8, ease: "expo.out"}}, {body_start - 0.4:.3f});')
    js.append(f'tl.to("#win", {{clipPath: "inset(50% 0% 50% 0% round 22px)", duration: 0.6, ease: "power3.in"}}, {body_end - 0.6:.3f});')
    for sc in body[1:]:
        t = sc["start"]
        overlays.append(f'<div id="sw-{sc["id"]}" class="sweep clip" data-start="{t - 0.35:.3f}" data-duration="0.7" data-track-index="{next_track()}"></div>')
        js.append(f'tl.fromTo("#sw-{sc["id"]}", {{x: -260}}, {{x: {WIN_W + 260}, duration: 0.7, ease: "power2.inOut"}}, {t - 0.35:.3f});')

    # Captions (minimal, burned in): each on the lowest free track, so none overlap on a track
    lanes: list[float] = []
    for i, (a, c, text) in enumerate(caps):
        d = max(0.4, c - a)
        lane = next((k for k, end in enumerate(lanes) if end <= a + 1e-3), len(lanes))
        if lane == len(lanes):
            lanes.append(0.0)
        lanes[lane] = a + d
        overlays.append(f'<div id="cap{i}" class="cap clip" data-start="{a:.3f}" data-duration="{d:.3f}" data-track-index="{90 + lane}">{esc(text)}</div>')
        js.append(f'tl.from("#cap{i}", {{opacity: 0, y: 8, duration: 0.25, ease: "power2.out"}}, {a:.3f});')

    hook_js, end_js = hook_timeline(), end_timeline(end_start)
    page = TEMPLATE.format(
        total=f"{total:.3f}",
        clips="\n      ".join(clips),
        overlays="\n    ".join(overlays),
        rail="".join(f'<div class="rstep r{k}"><span class="dot"></span>{n}</div>' for k, n in enumerate(RAIL)),
        counter="".join(f'<span class="c{k}"><b>{k + 1:02d}</b> {n}</span>' for k, n in enumerate(RAIL)),
        hook=HOOK_HTML, end=END_HTML.format(end_start=f"{end_start:.3f}", end_dur=f"{total - end_start:.3f}"),
        body_start=f"{body_start - 0.4:.3f}", body_dur=f"{body_end - body_start + 0.4:.3f}",
        rail_start=f"{rail_start:.3f}", rail_dur=f"{total - rail_start:.3f}",
        counter_start=f"{body_start:.3f}", counter_dur=f"{body_end - body_start:.3f}",
        js="\n      ".join(js + hook_js + end_js),
        win=f"left:{WIN_X}px;top:{WIN_Y}px;width:{WIN_W}px;height:{WIN_H}px;",
        k=K,
    )
    (HERE / "index.html").write_text(page, encoding="utf-8")
    print(f"index.html: {total:.1f} s, {len(clips)} footage segments, {label_n} labels/key chips, {len(caps)} captions, rail lit at {[round(t, 1) for _, t in order]}")


def label_card(i, text, box, t, d, tr):
    """Kallaway 'pointer' label (style-library t2-lb-pointer), re-tinted: glass card + dashed connector + glowing dot."""
    cw, ch = max(300, 18 * len(text) + 70), 74
    if box is None:  # owner clip: lower right of the window, no connector
        x, y = WIN_X + WIN_W - cw - 40, WIN_Y + WIN_H - ch - 40
        return f'<div id="{i}" class="lab clip" data-start="{t:.3f}" data-duration="{d:.3f}" data-track-index="{tr}" style="left:{x:.0f}px;top:{y:.0f}px;width:{cw}px"><span class="lab-t">{esc(text)}</span></div>'
    bx, by, bw, bh = box
    gap = 70
    right_space = W - 80 - (bx + bw + gap)
    if right_space >= cw:
        x, y, ax, ay = bx + bw + gap, by + bh / 2 - ch / 2, bx + bw + 8, by + bh / 2
        lx1, ly1 = x, y + ch / 2
    elif bx - gap - cw >= 80:
        x, y, ax, ay = bx - gap - cw, by + bh / 2 - ch / 2, bx - 8, by + bh / 2
        lx1, ly1 = x + cw, y + ch / 2
    else:  # below (or above when near the bottom)
        below = by + bh + gap + ch <= H - 110
        x = min(max(80, bx + bw / 2 - cw / 2), W - 80 - cw)
        y = by + bh + gap if below else by - gap - ch
        ax, ay = bx + bw / 2, (by + bh + 8) if below else (by - 8)
        lx1, ly1 = x + cw / 2, y if below else y + ch
    y = min(max(WIN_Y + 20, y), H - 110 - ch)
    return (f'<div id="{i}" class="labwrap clip" data-start="{t:.3f}" data-duration="{d:.3f}" data-track-index="{tr}">'
            f'<svg class="conn" viewBox="0 0 {W} {H}"><line x1="{lx1:.0f}" y1="{ly1:.0f}" x2="{ax:.0f}" y2="{ay:.0f}"/><circle cx="{ax:.0f}" cy="{ay:.0f}" r="7"/></svg>'
            f'<div class="lab" style="left:{x:.0f}px;top:{y:.0f}px;width:{cw}px"><span class="lab-t">{esc(text)}</span></div></div>')


def label_js(i, t):
    return [
        f'tl.from("#{i} .lab", {{opacity: 0, x: 24, scale: 0.96, duration: 0.6, ease: "back.out(1.4)"}}, {t:.3f});',
        f'tl.from("#{i} line", {{opacity: 0, duration: 0.35, ease: "power2.out"}}, {t + 0.25:.3f});',
        f'tl.from("#{i} circle", {{scale: 0, transformOrigin: "50% 50%", duration: 0.35, ease: "back.out(1.6)"}}, {t + 0.45:.3f});',
    ]


def key_chip(i, key, box, t, d, tr):
    """Kallaway 'keycap' (style-library t2-lb-keycap), re-tinted: the key being pressed, above the field."""
    bx, by, bw, bh = box
    x = min(bx + bw - 40, W - 260)
    y = max(WIN_Y + 10, by - 92)
    return f'<div id="{i}" class="key clip" data-start="{t:.3f}" data-duration="{d:.3f}" data-track-index="{tr}" style="left:{x:.0f}px;top:{y:.0f}px">{esc(key)}</div>'


def key_js(i, t):
    return [f'tl.from("#{i}", {{y: 10, scale: 0.8, opacity: 0, duration: 0.3, ease: "back.out(1.8)"}}, {t:.3f});',
            f'tl.to("#{i}", {{y: 4, duration: 0.12, yoyo: true, repeat: 1, ease: "power1.inOut"}}, {t + 0.32:.3f});']


def steps3(i, t, d, tr):
    pills = "".join(f'<div class="s step{k}"><span class="num">{k + 1}</span>{n}</div>' for k, n in enumerate(STEPS3))
    return f'<div id="{i}" class="steps3 clip" data-start="{t:.3f}" data-duration="{d:.3f}" data-track-index="{tr}">{pills}</div>'


# ---------------------------------------------------------------- motion-showreel: the Q motif opener and the lockup
Q_PATH = "M17.09 24.16A10 10 0 1 1 24.16 17.09C25.7 20.3 27.4 24.5 28.3 27.1C28.8 28.6 27.6 29.4 26.2 28.5C23.6 26.8 20 25.4 17.09 24.16Z"
ROW_G = '<g transform="translate(9.6 0)" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path class="row" d="M21.2 24V9.9M21.2 16.2c0-4.4 2.7-6.3 6.9-6.3"/><circle class="row" cx="38.1" cy="16" r="6.3"/><path class="row" d="M48.2 9.9 52.6 22.3 57.3 11.4 62 22.3 66.4 9.9"/></g>'


def mulberry(seed):
    def r():
        nonlocal seed
        seed = (seed + 0x6D2B79F5) & 0xFFFFFFFF
        t = seed
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return r


# A handwritten "signature" across the frame, as 16 fragments that can shatter (seeded, deterministic).
SIG_PTS = [(560 + i * 50, 560 + 60 * __import__("math").sin(i * 0.9) + (18 if i % 3 == 0 else -6)) for i in range(17)]
FRAGS = [(SIG_PTS[i], SIG_PTS[i + 1]) for i in range(16)]

HOOK_HTML = (
    '<div id="hook" class="full clip" data-start="0" data-duration="12.4" data-track-index="3">'
    '<div class="ambient"></div><div class="grain"></div>'
    '<div class="hud"><span class="crop tl"></span><span class="crop tr"></span><span class="crop bl"></span><span class="crop br"></span>'
    '<div class="spec">1920×1080 · 30P · 129 BPM <i class="blink"></i></div><div class="tc" id="tc-hook">00:00:00</div></div>'
    '<div class="seed"></div>'
    '<div class="mono hook-label l1">ECDSA SIGNATURE · TODAY</div>'
    '<div class="mono hook-label l2">BROKEN BY A QUANTUM COMPUTER</div>'
    '<div class="mono hook-label l3">ML-DSA-87 · QUANTUM-SAFE</div>'
    f'<svg class="sig" viewBox="0 0 1920 1080">{"".join(f"<line class=frag id=f{i} x1={a[0]:.0f} y1={a[1]:.0f} x2={b[0]:.0f} y2={b[1]:.0f} />" for i, (a, b) in enumerate(FRAGS))}</svg>'
    '<div class="flash"></div>'
    f'<svg class="qlogo" viewBox="0 0 78 32"><g transform="translate(-1.5 -1.4) scale(1.02)"><path class="q" d="{Q_PATH}" fill="none" stroke="currentColor" stroke-width="3.3" stroke-linejoin="round"/></g>{ROW_G}</svg>'
    '<h1 class="hook-title">' + "".join(f'<span class="w">{w}</span> ' for w in "Payments that stay safe after Q-Day".split()) + "</h1>"
    "</div>"
)

END_HTML = (
    '<div id="endc" class="full clip" data-start="{end_start}" data-duration="{end_dur}" data-track-index="3">'
    '<div class="ambient"></div><div class="grain"></div>'
    '<div class="hud"><span class="crop tl"></span><span class="crop tr"></span><span class="crop bl"></span><span class="crop br"></span>'
    '<div class="spec">QORECHAIN TESTNET · PUBLIC BETA <i class="blink"></i></div><div class="tc" id="tc-end">00:00:00</div></div>'
    f'<svg class="endlogo" viewBox="0 0 78 32"><g transform="translate(-1.5 -1.4) scale(1.02)"><path class="q" d="{Q_PATH}" fill="none" stroke="currentColor" stroke-width="3.3" stroke-linejoin="round"/></g>{ROW_G}</svg>'
    '<div class="endrule"></div>'
    '<h2 class="end-title">Payments that stay safe after Q-Day</h2>'
    '<div class="url mono">' + "".join(f'<span class="ch">{c}</span>' for c in "qrow-app.vercel.app") + '<span class="cursor"></span></div>'
    '<div class="end-meta"><span class="mono">github.com/Terhemba10/qrow</span><span>Built in Doha, Qatar · Public beta: QoreChain testnet, tokens have no value</span></div>'
    '<div class="credits">Voiceover: AI-generated (ElevenLabs) · Music: Good Days by Aylex (freetouse.com)</div>'
    '<div class="motif"></div>'
    "</div>"
)


def hook_timeline():
    r = mulberry(7)
    js = []
    # The seed dot pulses on beats 0-3, then becomes the pen tip.
    js.append(f'tl.from("#hook .seed", {{scale: 0, opacity: 0, duration: 0.5, ease: "back.out(2)"}}, {beat(0) - 0.15:.3f});')
    js.append(f'tl.to("#hook .seed", {{scale: 1.35, duration: {PERIOD / 2:.4f}, yoyo: true, repeat: 1, ease: "sine.inOut"}}, {beat(1):.3f});')
    js.append(f'tl.to("#hook .seed", {{x: -400, y: 20, scale: 0.5, duration: 0.36, ease: "power3.inOut"}}, {beat(2):.3f});')
    # The signature draws (fragment by fragment), labelled as today's signature.
    for i in range(16):
        js.append(f'tl.from("#f{i}", {{opacity: 0, scale: 0.2, transformOrigin: "0% 50%", duration: 0.14, ease: "power2.out"}}, {beat(2.8) + i * 0.025:.3f});')
    js.append(f'tl.to("#hook .seed", {{x: 400, duration: 0.5, ease: "none"}}, {beat(2.8):.3f});')
    js.append(f'tl.to("#hook .seed", {{opacity: 0, duration: 0.1}}, {beat(2.8) + 0.5:.3f});')
    js.append(f'tl.from("#hook .l1", {{opacity: 0, y: 12, duration: 0.5, ease: "expo.out"}}, {beat(2.6):.3f});')
    # On the break (beat 4): violet flash (the held-back colour), fragments scatter, label swaps.
    js.append(f'tl.fromTo("#hook .flash", {{opacity: 0}}, {{opacity: 0.55, duration: 0.06, yoyo: true, repeat: 1, ease: "none"}}, {beat(4):.3f});')
    js.append(f'tl.to("#hook .l1", {{opacity: 0, duration: 0.15}}, {beat(4):.3f});')
    js.append(f'tl.from("#hook .l2", {{opacity: 0, x: -10, duration: 0.25, ease: "power4.out"}}, {beat(4) + 0.05:.3f});')
    for i in range(16):
        dx, dy, rot = (r() - 0.5) * 520, (r() - 0.5) * 360, (r() - 0.5) * 140
        js.append(f'tl.to("#f{i}", {{x: {dx:.0f}, y: {dy:.0f}, rotation: {rot:.0f}, stroke: "#9b4dff", opacity: 0.55, duration: 1.4, ease: "expo.out"}}, {beat(4):.3f});')
    js.append(f'tl.to("#hook .frag", {{opacity: 0.22, duration: 2.0, ease: "sine.inOut"}}, {beat(7):.3f});')
    # "Qrow is built for that day" (beat 13): fragments converge, the Q draws, the wordmark lands on beat 16.
    js.append(f'tl.to("#hook .l2", {{opacity: 0, duration: 0.3}}, {beat(12.5):.3f});')
    js.append(f'tl.to("#hook .frag", {{x: 0, y: 0, rotation: 0, scale: 0, opacity: 0, transformOrigin: "50% 50%", duration: 0.7, ease: "power3.in", stagger: 0.02}}, {beat(12.4):.3f});')
    js.append(f'tl.fromTo("#hook .q", {{strokeDashoffset: 80, strokeDasharray: 80}}, {{strokeDashoffset: 0, duration: 1.0, ease: "power2.inOut"}}, {beat(13):.3f});')
    js.append(f'tl.from("#hook .qlogo", {{opacity: 0, duration: 0.3}}, {beat(13):.3f});')
    js.append(f'tl.from("#hook .l3", {{opacity: 0, y: 12, duration: 0.5, ease: "expo.out"}}, {beat(14.5):.3f});')
    js.append(f'tl.from("#hook .row", {{opacity: 0, x: -6, duration: 0.45, ease: "expo.out", stagger: 0.09}}, {beat(15.2):.3f});')
    js.append(f'tl.fromTo("#hook .qlogo", {{scaleY: 0.86, scaleX: 1.08}}, {{scaleY: 1, scaleX: 1, duration: 0.55, ease: "back.out(2.2)", transformOrigin: "50% 100%"}}, {beat(16):.3f});')
    js.append(f'tl.to("#hook .l3", {{opacity: 0.0, duration: 0.3}}, {beat(17.6):.3f});')
    js.append(f'tl.from("#hook .w", {{opacity: 0, y: 26, duration: 0.7, ease: "expo.out", stagger: 0.08}}, {beat(18):.3f});')
    js.append(f'tl.to("#hook .qlogo", {{y: -70, scale: 0.8, duration: 0.9, ease: "power2.inOut"}}, {beat(17.4):.3f});')
    return js


def end_timeline(t0):
    js = [
        f'tl.from("#endc .endlogo", {{opacity: 0, scale: 0.94, filter: "blur(14px)", duration: 1.4, ease: "expo.out"}}, {t0 + 0.3:.3f});',
        f'tl.fromTo("#endc .endrule", {{scaleX: 0}}, {{scaleX: 1, duration: 0.9, ease: "expo.out"}}, {t0 + 1.4:.3f});',
        f'tl.from("#endc .end-title", {{opacity: 0, y: 18, duration: 0.8, ease: "expo.out"}}, {t0 + 1.8:.3f});',
        f'tl.from("#endc .url .ch", {{opacity: 0, duration: 0.01, stagger: 0.055}}, {t0 + 2.8:.3f});',
        f'tl.from("#endc .url .cursor", {{opacity: 0, duration: 0.01}}, {t0 + 2.75:.3f});',
        f'tl.to("#endc .url .cursor", {{opacity: 0, duration: 0.01, yoyo: true, repeat: 9, repeatDelay: {PERIOD - 0.01:.3f}}}, {t0 + 4.0:.3f});',
        f'tl.from("#endc .end-meta span", {{opacity: 0, y: 10, duration: 0.6, ease: "power3.out", stagger: 0.18}}, {t0 + 4.2:.3f});',
        # The motif lands last, as punctuation, with a squash.
        f'tl.from("#endc .motif", {{y: -220, opacity: 0, duration: 0.55, ease: "power3.in"}}, {t0 + 5.0:.3f});',
        f'tl.to("#endc .motif", {{scaleY: 0.62, scaleX: 1.35, duration: 0.09, yoyo: true, repeat: 1, ease: "power1.out", transformOrigin: "50% 100%"}}, {t0 + 5.55:.3f});',
        f'tl.from("#endc .credits", {{opacity: 0, duration: 0.8, ease: "power2.out"}}, {t0 + 6.2:.3f});',
        f'tl.to("#endc .full-fade", {{opacity: 1, duration: 0.8}}, {t0 + 11.1:.3f});',
    ]
    return js


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Qrow demo</title>
<link rel="stylesheet" href="tokens.css" />
<style>
  @font-face {{ font-family: "General Sans"; src: url("assets/fonts/GeneralSans-Regular.otf"); font-weight: 400; }}
  @font-face {{ font-family: "General Sans"; src: url("assets/fonts/GeneralSans-Medium.otf"); font-weight: 500; }}
  @font-face {{ font-family: "General Sans"; src: url("assets/fonts/GeneralSans-Semibold.otf"); font-weight: 600; }}
  html, body {{ margin: 0; background: #0d0f22; }}
  #root {{ position: relative; width: 1920px; height: 1080px; overflow: hidden; background: var(--canvas-deep); font-family: var(--font-body); color: var(--text); }}
  .bg {{ position: absolute; inset: 0; background: radial-gradient(70% 60% at 50% 50%, #191b36 0%, var(--canvas-deep) 75%); }}
  .bg::after {{ content: ""; position: absolute; inset: 0; background: var(--vignette); }}
  #win {{ position: absolute; {win} z-index: 25; border-radius: 22px; overflow: hidden; background: var(--canvas);
         box-shadow: 0 30px 90px rgba(0,0,0,.55), 0 0 0 1.5px rgba(238,240,255,.12), 0 0 60px rgba(62,240,210,.10); }}
  #camk {{ position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0; transform: scale({k}); }}
  #cam {{ position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0; }}
  #cam video.seg {{ position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; }}
  .sweep {{ position: absolute; left: {win_left}px; top: {win_top}px; width: 220px; height: {win_h}px; z-index: 30;
           background: linear-gradient(90deg, transparent, rgba(62,240,210,.55), rgba(155,77,255,.55), transparent); filter: blur(6px); }}
  /* Journey rail and counter (video-storytelling: one persistent world) */
  #rail {{ position: absolute; left: 380px; right: 134px; top: 12px; height: 40px; display: flex; gap: 18px; align-items: center; justify-content: flex-end; z-index: 40; }}
  .rstep {{ display: flex; align-items: center; gap: 10px; font: 500 20px/1 var(--font-body); letter-spacing: .14em; color: var(--text-dim); opacity: .34; }}
  .rstep .dot {{ width: 12px; height: 12px; border-radius: 50%; background: rgba(238,240,255,.35); }}
  #counter {{ position: absolute; left: 134px; top: 10px; height: 44px; width: 260px; z-index: 40; }}
  #counter span {{ position: absolute; left: 0; top: 0; padding: 8px 16px; border-radius: 999px; font: 500 21px/1.3 var(--font-body); letter-spacing: .14em;
                  background: var(--glass-bg-dark); border: 1.5px solid var(--glass-border); opacity: 0; white-space: nowrap; }}
  #counter b {{ font-family: var(--font-mono); font-weight: 500; color: var(--accent); margin-right: 6px; }}
  /* Labels (style-library: Kallaway pointer + keycap, re-tinted) */
  .labwrap {{ position: absolute; inset: 0; z-index: 50; }}
  .conn {{ position: absolute; inset: 0; width: 1920px; height: 1080px; overflow: visible; }}
  .conn line {{ stroke: rgba(62,240,210,.7); stroke-width: 2.5; stroke-dasharray: 8 6; }}
  .conn circle {{ fill: var(--accent); filter: drop-shadow(0 0 6px rgba(62,240,210,.9)); }}
  .lab {{ position: absolute; z-index: 51; height: 74px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 0 28px;
         background: var(--glass-bg-dark); border: 1.5px solid var(--glass-border); border-radius: 20px; box-shadow: var(--glass-shadow); overflow: hidden; }}
  .lab::before {{ content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2.5px; background: var(--gradient); }}
  .lab-t {{ font: 600 30px/1 var(--font-display); letter-spacing: -0.01em; color: var(--text); white-space: nowrap; }}
  .key {{ position: absolute; z-index: 52; min-width: 64px; padding: 14px 22px; text-align: center; border-radius: 14px; box-sizing: border-box;
         font: 500 30px/1 var(--font-mono); color: var(--text); background: linear-gradient(175deg, rgba(30,34,64,.95), rgba(13,15,34,.97));
         border: 1.5px solid rgba(62,240,210,.5); border-bottom: 4px solid rgba(62,240,210,.7); box-shadow: 0 6px 0 rgba(0,0,0,.6), 0 0 26px rgba(62,240,210,.35); }}
  /* In the top bar, between the counter chip and the rail: never over the app itself */
  .steps3 {{ position: absolute; left: 420px; top: 8px; z-index: 45; display: flex; gap: 6px;
            padding: 5px 8px; border-radius: 999px; background: var(--glass-bg-dark); border: 1.5px solid var(--glass-border); }}
  .steps3 .s {{ display: flex; align-items: center; gap: 8px; padding: 3px 10px; font: 600 21px/1 var(--font-body); opacity: .45; }}
  .steps3 .num {{ width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font: 500 18px/1 var(--font-mono); background: rgba(238,240,255,.14); }}
  /* Captions (minimal, burned in) */
  .cap {{ position: absolute; left: 160px; right: 160px; bottom: 16px; text-align: center; z-index: 60;
         font: 500 31px/1.25 var(--font-body); color: var(--text); text-shadow: 0 2px 10px rgba(0,0,0,.8); }}
  /* Hook and end (motion-showreel) */
  .full {{ position: absolute; inset: 0; background: var(--canvas-deep); overflow: hidden; z-index: 20; }}
  .ambient {{ position: absolute; inset: 0; background: radial-gradient(90% 70% at 50% 120%, rgba(62,240,210,.16), transparent 60%), radial-gradient(70% 60% at 50% 45%, #191b36, var(--canvas-deep) 75%); }}
  .grain {{ position: absolute; inset: 0; opacity: .06; background-image: radial-gradient(rgba(255,255,255,.5) 1px, transparent 1.4px); background-size: 46px 46px; }}
  .hud {{ position: absolute; inset: 0; font: 500 16px/1 var(--font-mono); letter-spacing: .2em; color: var(--text-faint); }}
  .crop {{ position: absolute; width: 26px; height: 26px; border: 0 solid rgba(238,240,255,.35); }}
  .crop.tl {{ left: 60px; top: 60px; border-left-width: 2px; border-top-width: 2px; }} .crop.tr {{ right: 60px; top: 60px; border-right-width: 2px; border-top-width: 2px; }}
  .crop.bl {{ left: 60px; bottom: 60px; border-left-width: 2px; border-bottom-width: 2px; }} .crop.br {{ right: 60px; bottom: 60px; border-right-width: 2px; border-bottom-width: 2px; }}
  .spec {{ position: absolute; right: 100px; top: 70px; }} .tc {{ position: absolute; left: 100px; bottom: 70px; }}
  .blink {{ display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); margin-left: 8px; }}
  .seed {{ position: absolute; left: 946px; top: 546px; width: 28px; height: 28px; border-radius: 50%; background: var(--accent); box-shadow: var(--glow-accent); }}
  .sig {{ position: absolute; inset: 0; width: 1920px; height: 1080px; }}
  .frag {{ stroke: var(--text); stroke-width: 7; stroke-linecap: round; }}
  .flash {{ position: absolute; inset: 0; background: #9b4dff; opacity: 0; }}
  .hook-label {{ position: absolute; left: 0; right: 0; top: 380px; text-align: center; font: 500 26px/1 var(--font-mono); letter-spacing: .2em; color: var(--text-dim); }}
  .hook-label.l2 {{ color: #b98bff; }} .hook-label.l3 {{ color: var(--accent); top: 690px; }}
  .qlogo {{ position: absolute; left: 727px; top: 380px; width: 466px; height: 191px; color: var(--text); }}
  .hook-title {{ position: absolute; left: 0; right: 0; top: 600px; margin: 0; text-align: center; font: 600 84px/1.05 var(--font-display); letter-spacing: -0.03em; }}
  .hook-title .w {{ display: inline-block; }}
  .endlogo {{ position: absolute; left: 812px; top: 250px; width: 296px; height: 121px; color: var(--text); }}
  .endrule {{ position: absolute; left: 780px; top: 400px; width: 360px; height: 3px; border-radius: 3px; background: var(--gradient); transform-origin: 50% 50%; }}
  .end-title {{ position: absolute; left: 0; right: 0; top: 440px; margin: 0; text-align: center; font: 600 64px/1.1 var(--font-display); letter-spacing: -0.03em; }}
  .url {{ position: absolute; left: 0; right: 0; top: 560px; text-align: center; font: 500 58px/1 var(--font-mono); color: var(--accent); }}
  .url .cursor {{ display: inline-block; width: 30px; height: 56px; margin-left: 6px; vertical-align: -6px; background: var(--accent); }}
  .end-meta {{ position: absolute; left: 0; right: 0; top: 670px; display: grid; gap: 16px; text-align: center; font: 400 28px/1.2 var(--font-body); color: var(--text-dim); }}
  .credits {{ position: absolute; left: 0; right: 0; bottom: 120px; text-align: center; font: 400 22px/1 var(--font-body); color: var(--text-faint); }}
  .motif {{ position: absolute; left: 1150px; top: 330px; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); box-shadow: var(--glow-accent); }}
  .mono {{ font-family: var(--font-mono); }}
  .full-fade {{ position: absolute; inset: 0; background: #000; opacity: 0; z-index: 99; }}
</style>
</head>
<body>
  <div id="root" data-composition-id="qrow-demo" data-start="0" data-duration="{total}" data-width="1920" data-height="1080">
    <div class="bg"></div>
    <div id="win">
      <div id="camk"><div id="cam">
      {clips}
      </div></div>
    </div>
    <audio id="soundtrack" src="assets/soundtrack.wav" data-start="0" data-duration="{total}" data-track-index="2" data-volume="1"></audio>
    {hook}
    {end}
    <div id="rail" class="clip" data-start="{rail_start}" data-duration="{rail_dur}" data-track-index="7">{rail}</div>
    <div id="counter" class="clip" data-start="{counter_start}" data-duration="{counter_dur}" data-track-index="8">{counter}</div>
    {overlays}
    <div class="full-fade"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    (function () {{
      window.__timelines = window.__timelines || {{}};
      const tl = gsap.timeline({{ paused: true }});
      // Timecode (pure function of time) for the hook and end HUDs.
      const drv = {{ t: 0 }};
      const pad = (n) => String(n).padStart(2, "0");
      const tc = (t) => pad(Math.floor(t / 60)) + ":" + pad(Math.floor(t % 60)) + ":" + pad(Math.floor((t % 1) * 30));
      tl.fromTo(drv, {{ t: 0 }}, {{ t: {total}, duration: {total}, ease: "none", onUpdate: () => {{
        const a = document.getElementById("tc-hook"), b = document.getElementById("tc-end");
        if (a) a.textContent = tc(drv.t); if (b) b.textContent = tc(drv.t);
      }} }}, 0);
      {js}
      tl.to({{}}, {{ duration: {total} }}, 0); // anchor: the timeline spans the whole video
      window.__timelines["qrow-demo"] = tl;
    }})();
  </script>
</body>
</html>
"""

if __name__ == "__main__":
    TEMPLATE = TEMPLATE.replace("{win_left}", str(WIN_X)).replace("{win_top}", str(WIN_Y)).replace("{win_h}", str(WIN_H))
    main()
