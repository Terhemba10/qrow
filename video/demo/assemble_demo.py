"""Put demo_final.mp4 together with ffmpeg: 3D intro, title card, the recorded app scenes, the outro card;
one voice clip per scene laid on its own section; the music bed under it; -14 LUFS; hard limit 3:00.

    ../.venv/Scripts/python assemble_demo.py          -> out/demo_final.mp4 (+ out/demo_edl.json)

Fitting a scene (never speeding anything up): a scene lasts max(budget, voice + 0.7 s). If its footage is longer,
idle stretches between actions are shortened first (cut from their middle), then the page-landing time before the
first action, and only then the tail. Shorter footage holds its last frame.
"""
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE.parent / "raw"
OUT = HERE / "out"
SEG = OUT / "segments"
MUSIC = HERE.parent / "audio" / "music" / "good-days-aylex.mp3"
FPS, LIMIT, VOICE_AT, MAX_IDLE = 30, 180.0, 0.35, 1.8
VOICE_GAIN, QUIET_BOOST, TARGET_LUFS = 2.0, 1.6, -13.0   # voice +6 dB over the music; music up where nobody speaks
script = json.loads((HERE / "script.json").read_text(encoding="utf-8"))
timing = json.loads((HERE / "audio" / "timing.json").read_text())


def ff(args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def duration(f: Path) -> float:
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)], capture_output=True, text=True, check=True).stdout)


def keep_ranges(sid: str, length: float):
    """Pieces of the clip to keep so it fits `length`: shorten idle gaps, then the landing, then the tail."""
    src = RAW / f"{sid}.mp4"
    total = duration(src)
    ev = json.loads((RAW / f"{sid}.events.json").read_text())["events"]
    start = next((e["t"] for e in ev if e["kind"] == "start"), 0.0)
    acts = sorted(e["t"] + e.get("dur", 0) for e in ev if e["kind"] != "start")
    first = acts[0] if acts else start
    # 1. landing: begin at the 'start' mark (page loaded); 2. idle gaps over MAX_IDLE lose their middle
    ranges, cur = [], start
    for a, b in zip([start] + acts, acts + [total]):
        if b - a > MAX_IDLE + 1.0 and b != total:
            ranges.append((cur, a + MAX_IDLE / 2))
            cur = b - MAX_IDLE / 2
    ranges.append((cur, total))
    have = sum(b - a for a, b in ranges)
    if have > length:  # 3. less landing time before the first action (keep 0.6 s)
        cut = min(have - length, max(0.0, first - 0.6 - ranges[0][0]))
        ranges[0] = (ranges[0][0] + cut, ranges[0][1])
        have -= cut
    while have > length + 1e-3 and ranges:  # 4. the tail
        a, b = ranges[-1]
        cut = min(have - length, b - a)
        ranges[-1] = (a, b - cut)
        have -= cut
        if ranges[-1][1] - ranges[-1][0] < 0.05:
            ranges.pop()
    return [(round(a, 3), round(b, 3)) for a, b in ranges if b - a > 0.05], round(have, 3)


def scene_video(s, length: float, out: Path):
    kind = s.get("kind")
    vf_tail = f"fps={FPS},scale=1920:1080:flags=lanczos,format=yuv420p,tpad=stop_mode=clone:stop_duration=60,trim=duration={length:.3f},fade=t=in:st=0:d=0.25,fade=t=out:st={length - 0.25:.3f}:d=0.25"
    if kind == "intro":
        ff(["-i", str(OUT / "intro3d.mp4"), "-vf", vf_tail.replace(",fade=t=in:st=0:d=0.25", ""), "-an", "-c:v", "libx264", "-crf", "17", "-preset", "medium", str(out)])
        return {"source": "intro3d.mp4"}
    if kind == "thumb":
        ff(["-loop", "1", "-i", str(OUT / "thumbnail-1080.png"), "-vf", f"fps={FPS},format=yuv420p,trim=duration={length:.3f},fade=t=out:st={length - 0.3:.3f}:d=0.3",
            "-t", f"{length:.3f}", "-an", "-c:v", "libx264", "-crf", "16", str(out)])
        return {"source": "thumbnail-1080.png"}
    if kind == "card":
        png = OUT / ("title.png" if s["id"].endswith("title") else "outro.png")
        zoom = f"zoompan=z='1+0.035*on/({length * FPS:.0f})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={round(length * FPS)}:s=1920x1080:fps={FPS}"
        ff(["-loop", "1", "-i", str(png), "-vf", f"{zoom},{vf_tail}", "-t", f"{length:.3f}", "-an", "-c:v", "libx264", "-crf", "17", str(out)])
        return {"source": png.name}
    ranges, have = keep_ranges(s["id"], length)
    src = str(RAW / f"{s['id']}.mp4")
    parts = "".join(f"[0:v]trim={a}:{b},setpts=PTS-STARTPTS[p{i}];" for i, (a, b) in enumerate(ranges))
    joined = "".join(f"[p{i}]" for i in range(len(ranges))) + f"concat=n={len(ranges)}:v=1:a=0[j];[j]{vf_tail}[v]"
    ff(["-i", src, "-filter_complex", parts + joined, "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "18", "-preset", "medium", str(out)])
    return {"source": f"{s['id']}.mp4", "kept": ranges, "footage": have}


def main():
    SEG.mkdir(parents=True, exist_ok=True)
    edl, t = [], 0.0
    for s in script["scenes"]:
        voice = timing.get(s["id"])
        length = max(s["seconds"], (voice or 0) + 0.7)
        out = SEG / f"{s['id']}.mp4"
        info = scene_video(s, length, out)
        edl.append({"id": s["id"], "start": round(t, 3), "dur": round(length, 3), "voice": voice, **info})
        t += length
    total = t
    (SEG / "list.txt").write_text("".join(f"file '{(SEG / (e['id'] + '.mp4')).as_posix()}'\n" for e in edl), encoding="utf-8")
    picture = OUT / "picture.mp4"
    ff(["-f", "concat", "-safe", "0", "-i", str(SEG / "list.txt"), "-c", "copy", str(picture)])

    # Sound: each voice clip at its scene's start (+0.35 s), the music bed ducked under the voice, -14 LUFS.
    voiced = [e for e in edl if e["voice"]]
    intro_end = next(e["start"] + e["dur"] for e in edl if e["id"] == "d01-intro3d")
    inputs = []
    for e in voiced:
        inputs += ["-i", str(HERE / "audio" / f"{e['id']}.mp3")]
    inputs += ["-stream_loop", "-1", "-i", str(MUSIC)]
    m = len(voiced)
    fc = "".join(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={int((e['start'] + VOICE_AT) * 1000)}:all=1[v{i}];" for i, e in enumerate(voiced))
    fc += "".join(f"[v{i}]" for i in range(m)) + f"amix=inputs={m}:normalize=0:duration=longest,apad=whole_dur={total:.3f},atrim=0:{total:.3f},acompressor=threshold=0.1:ratio=3:attack=5:release=120:makeup=1.6,volume={VOICE_GAIN}[voice];"
    fc += "[voice]asplit=2[vk][vm];"
    fc += f"[{m}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{total:.3f},volume=1.5,volume='if(lt(t,{intro_end:.3f})+gt(t,{total - 3.2:.3f}),{QUIET_BOOST},1)':eval=frame,afade=t=in:st=0:d=0.6,afade=t=out:st={total - 2.5:.3f}:d=2.5[mus];"
    fc += "[mus][vk]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=450[duck];"
    fc += "[vm][duck]amix=inputs=2:normalize=0[a]"
    raw_mix = OUT / "soundtrack-raw.wav"
    ff([*inputs, "-filter_complex", fc, "-map", "[a]", "-t", f"{total:.3f}", "-ar", "48000", str(raw_mix)])
    # Two passes: measure, then one gain to -14 LUFS and a limiter at -1.5 dBFS (AAC adds a little on top).
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(raw_mix), "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    measured = float(r.rsplit("I:", 1)[1].split("LUFS")[0])
    sound = OUT / "soundtrack.wav"
    ff(["-i", str(raw_mix), "-af", f"volume={TARGET_LUFS - measured:.2f}dB,alimiter=limit=0.84:level=false", "-ar", "48000", str(sound)])

    final = OUT / "demo_final.mp4"
    # Final safety step: hard limit at 3:00 whatever happened above.
    ff(["-i", str(picture), "-i", str(sound), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k",
        "-t", f"{min(total, LIMIT):.3f}", "-movflags", "+faststart", str(final)])
    (OUT / "demo_edl.json").write_text(json.dumps({"total": total, "scenes": edl}, indent=1), encoding="utf-8")
    print(f"{final}\n  planned {total:.1f} s, file {duration(final):.2f} s (limit {LIMIT:.0f} s)")


if __name__ == "__main__":
    main()
