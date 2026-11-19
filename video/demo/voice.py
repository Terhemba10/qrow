"""One voice clip per scene with edge-tts (en-US-AndrewNeural, +5%) -> audio/<scene>.mp3 and audio/timing.json.

    ../.venv/Scripts/python voice.py [scene ids...]
"""
import json
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
EDGE = HERE.parent / ".venv" / "Scripts" / "edge-tts.exe"
script = json.loads((HERE / "script.json").read_text(encoding="utf-8"))


def for_speech(text: str) -> str:
    for written, spoken in sorted(script["pronunciations"].items(), key=lambda kv: -len(kv[0])):
        text = re.sub(rf"(?<![\w-]){re.escape(written)}(?![\w-])", spoken, text)
    return text


def duration(f: Path) -> float:
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(f)], capture_output=True, text=True, check=True).stdout)


def main():
    only = sys.argv[1:]
    out = HERE / "audio"
    out.mkdir(exist_ok=True)
    tf = out / "timing.json"
    timing = json.loads(tf.read_text()) if tf.exists() else {}
    for s in script["scenes"]:
        if not s["caption"] or (only and s["id"] not in only):
            continue
        f = out / f"{s['id']}.mp3"
        for attempt in range(4):  # the Edge service drops a request now and then
            r = subprocess.run([str(EDGE), "--voice", script["voice"], f"--rate={script['rate']}", "--text", for_speech(s["caption"]), "--write-media", str(f)], capture_output=True, text=True)
            if r.returncode == 0:
                break
            time.sleep(1.5 * (attempt + 1))
        else:
            sys.exit(f"edge-tts failed for {s['id']}: {r.stderr[-300:]}")
        d = duration(f)
        timing[s["id"]] = round(d, 3)
        tf.write_text(json.dumps(timing, indent=1))
        print(f"{s['id']:16} {d:5.1f} s / budget {s['seconds']} s{'  (voice longer: scene grows)' if d + 0.7 > s['seconds'] else ''}")
    total = sum(max(s["seconds"], timing.get(s["id"], 0) + 0.7) for s in script["scenes"])
    print(f"planned length {total:.1f} s (limit 180)")


if __name__ == "__main__":
    main()
