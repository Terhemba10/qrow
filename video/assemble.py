"""Assemble the demo video: footage cut to each scene, the soundtrack, captions. Under 3:00.

    .venv/Scripts/python assemble.py          the full cut  -> out/qrow-demo.mp4
    .venv/Scripts/python assemble.py --alt    payments not live in QoreX yet: s05-alt, no s06 -> out/qrow-demo-alt.mp4

Rules: the voice is never changed. Each scene lasts max(scene length, voice clip + 0.6 s), exactly as mix.mjs
lays out the soundtrack, so picture and voice stay in sync. Footage longer than its slot is trimmed, or sped
up by at most 1.35x where edit.json says `fit: speed`; shorter footage holds its last frame. Missing owner
clips show a labelled slate so the cut can be previewed before they are recorded.
Captions go in as a soft subtitle track (and out/captions*.srt for the YouTube upload).
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW, OUT, TMP = HERE / "raw", HERE / "out", HERE / "out" / "_segments"
ALT = "--alt" in sys.argv
FPS, MAX_SPEED = 30, 1.35
FONT = "C\\:/Windows/Fonts/segoeui.ttf"


def run(args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def duration(f: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)], capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def shot_list(script):
    if not ALT:
        return script["shots"]
    alt = next(a for a in script.get("alternates", []) if a["id"] == "s05-alt")
    return [alt if s["id"] == "s05-send" else s for s in script["shots"] if s["id"] != "s06-claim"]


def slate(path: Path, seconds: float, label: str):
    text = label.replace(":", "\\:").replace("'", "")
    run(["-f", "lavfi", "-i", f"color=c=0x14162c:s=1920x1080:r={FPS}:d={seconds:.3f}",
         "-vf", f"drawtext=fontfile='{FONT}':text='{text}':fontcolor=0xb9bde0:fontsize=44:x=(w-tw)/2:y=(h-th)/2",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", str(path)])


def segment(path: Path, src: Path, start: float, take: float, slot: float, speed: float):
    """`take` seconds of `src` from `start`, played at `speed`, padded (last frame held) to exactly `slot`."""
    vf = f"setpts=(PTS-STARTPTS)/{speed:.4f},fps={FPS},scale=1920:1080:flags=lanczos,format=yuv420p,tpad=stop_mode=clone:stop_duration=30"
    run(["-ss", f"{start:.3f}", "-t", f"{take:.3f}", "-i", str(src), "-vf", vf, "-t", f"{slot:.3f}", "-an",
         "-c:v", "libx264", "-preset", "medium", "-crf", "18", str(path)])


def main():
    script = json.loads((HERE / "script.json").read_text(encoding="utf-8"))
    timing = json.loads((HERE / "audio" / "shots" / "timing.json").read_text(encoding="utf-8"))
    edit = json.loads((HERE / "edit.json").read_text(encoding="utf-8"))["shots"]
    TMP.mkdir(parents=True, exist_ok=True)
    parts, report, missing = [], [], []
    total = 0.0
    for shot in shot_list(script):
        sid = shot["id"]
        scene = max(shot["seconds"], timing[sid]["seconds"] + 0.6)
        segs = []
        for s in edit[sid]:
            src = RAW / s["file"]
            if not src.exists():
                if s.get("optional"):
                    continue
                missing.append(s["file"])
                segs.append({**s, "avail": None})
                continue
            avail = duration(src) - s.get("in", 0.0)
            segs.append({**s, "avail": min(avail, s.get("max", avail))})
        # Fixed segments keep their length; the flexible one (owner clip, or the last) takes the rest.
        flex = next((i for i, s in enumerate(segs) if s.get("owner")), len(segs) - 1)
        fixed = sum(s["avail"] for i, s in enumerate(segs) if i != flex and s["avail"] is not None)
        slots = [s["avail"] if i != flex else max(scene - fixed, 1.5) for i, s in enumerate(segs)]
        overflow = sum(slots) - scene
        if overflow > 0:  # fixed parts too long: shorten them from the end
            for i in reversed(range(len(segs))):
                if i != flex and overflow > 0:
                    cut = min(overflow, slots[i] - 1.5)
                    slots[i] -= cut
                    overflow -= cut
        for i, (s, slot) in enumerate(zip(segs, slots)):
            out = TMP / f"{sid}-{i}.mp4"
            if s["avail"] is None:
                slate(out, slot, f"Owner recording: {s['file']}  ({slot:.0f} s)")
                report.append(f"{sid}: slate for {s['file']} ({slot:.1f} s)")
            else:
                speed = 1.0
                if s["avail"] > slot and s.get("fit") == "speed":
                    speed = min(MAX_SPEED, s["avail"] / slot)
                take = min(s["avail"], slot * speed)
                segment(out, RAW / s["file"], s.get("in", 0.0), take, slot, speed)
                note = f"speed x{speed:.2f}" if speed > 1.001 else ("trimmed" if s["avail"] > slot + 0.05 else ("held last frame" if s["avail"] < slot - 0.05 else "exact"))
                report.append(f"{sid}: {s['file']} {slot:.1f} s ({note})")
            parts.append(out)
        total += scene

    concat = TMP / "list.txt"
    concat.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    picture = TMP / "picture.mp4"
    run(["-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(picture)])
    sound = OUT / ("soundtrack-alt.wav" if ALT else "soundtrack.wav")
    subs = OUT / ("captions-alt.srt" if ALT else "captions.srt")
    final = OUT / ("qrow-demo-alt.mp4" if ALT else "qrow-demo.mp4")
    run(["-i", str(picture), "-i", str(sound), "-i", str(subs), "-map", "0:v", "-map", "1:a", "-map", "2:s",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng",
         "-shortest", "-movflags", "+faststart", str(final)])
    length = duration(final)
    print("\n".join(report))
    print(f"\n{final}\n  length {int(length // 60)}:{round(length % 60):02d} (limit 3:00), picture {duration(picture):.1f} s, sound {duration(sound):.1f} s")
    if missing:
        print(f"  still to record: {', '.join(sorted(set(missing)))}")


if __name__ == "__main__":
    main()
