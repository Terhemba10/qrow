"""Capture the Three.js intro (intro3d.html) frame by frame with Playwright, then encode it.

    ../.venv/Scripts/python capture_intro.py [seconds] [fps]     -> out/intro3d.mp4

Frame-by-frame (window.renderAt(t) + a screenshot per frame) keeps the motion smooth whatever the machine is doing.
"""
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
SECONDS = float(sys.argv[1]) if len(sys.argv) > 1 else 4.6
FPS = int(sys.argv[2]) if len(sys.argv) > 2 else 30


def main():
    frames = OUT / "intro_frames"
    frames.mkdir(parents=True, exist_ok=True)
    for f in frames.glob("*.png"):
        f.unlink()
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        page = b.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        page.goto((HERE / "intro3d.html").as_uri())
        page.wait_for_function("window.introReady === true", timeout=120_000)
        page.wait_for_timeout(800)  # fonts
        n = round(SECONDS * FPS)
        for i in range(n):
            page.evaluate(f"window.renderAt({i / FPS})")
            page.screenshot(path=str(frames / f"f{i:04d}.png"))
        b.close()
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", str(FPS), "-i", str(frames / "f%04d.png"),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-preset", "medium", str(OUT / "intro3d.mp4")], check=True)
    print(f"{OUT / 'intro3d.mp4'}: {n} frames, {SECONDS} s")


if __name__ == "__main__":
    main()
