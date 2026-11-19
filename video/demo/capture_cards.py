"""Screenshot the title card, outro and thumbnail (cards.html) to PNG with Playwright -> out/title.png, outro.png, thumbnail.png."""
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"

with sync_playwright() as p:
    # A clean 3D still for the thumbnail: the intro's last frame without its tagline.
    g = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    page = g.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
    page.goto((HERE / "intro3d.html").as_uri())
    page.wait_for_function("window.introReady === true", timeout=120_000)
    page.evaluate("document.querySelector('.tag').remove(); document.querySelector('.kick').remove(); window.renderAt = ((f) => (t) => f(t))(window.renderAt); window.renderAt(4.5)")
    page.screenshot(path=str(OUT / "hero3d.png"))
    g.close()
    b = p.chromium.launch()
    for card, w, h, name in [("title", 1920, 1080, "title.png"), ("outro", 1920, 1080, "outro.png"), ("thumb", 1280, 720, "thumbnail.png")]:
        page = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
        page.goto((HERE / "cards.html").as_uri() + "#" + card)
        page.wait_for_timeout(900)
        page.screenshot(path=str(OUT / name), clip={"x": 0, "y": 0, "width": w, "height": h})
        page.close()
        print(OUT / name)
    b.close()
