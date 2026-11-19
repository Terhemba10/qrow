"""Capture the live Qrow site for the walkthrough video and the Figma prototype.

Every tab except AI, at a 1440x900 viewport (device scale 4/3 -> 1920 px wide images), full page.
Each tab has 1-3 "beats": screenshot after a few harmless UI actions (typing sample values, choosing a
segment, opening a market). Nothing is ever submitted or signed; no wallet is connected.
The AI tab is removed from the page (nav link and Hub tile) before every screenshot.

Writes shots/<id>-<n>.png and shots/meta.json (CSS-pixel coordinates, 1440 basis).
"""
import json, os, sys
from playwright.sync_api import sync_playwright

BASE = "https://qrow-app.vercel.app"
OUT = os.path.join(os.path.dirname(__file__), "shots")
SAMPLE_TO = "qor16g00mst7mksjx9u0q5tmrfavmh8s7kqvn8nqxz"  # Qrow's own keeper wallet (testnet), never a person's
SAMPLE_TX = "53779BFC85C48545016F1686457EC7BDE636E5BF286B14F5BFF08ADF42BAA903"  # keeper key registration
ART = os.path.join(os.path.dirname(__file__), "sample-art.png")

STRIP_AI = """() => {
  document.querySelectorAll('a[href="/ai"]').forEach(a => (a.closest('.hub__grid li') || a).remove());
  document.querySelectorAll('[data-qrow-tour], .q-onboarding').forEach(e => e.remove());
}"""

# id, path, beats. A beat is a list of actions; ("focus", selector) marks where the cursor goes.
TABS = [
    ("hub", "/", [[("focus", "header button:has-text('Connect QoreX')")]]),
    ("faucet", "/faucet", [[("focus", "main :text('Open QoreChain Faucet')")]]),
    ("swap", "/swap", [[("focus", "main label:has-text('You pay')")], [("fill", "main input[type=text] >> nth=0", "25"), ("focus", "main input[type=text] >> nth=0")]]),
    ("trade", "/trade", [[("focus", "main .pairchip >> nth=0")], [("click", "main .pairchip >> nth=3"), ("focus", "main .pairchip >> nth=3")], [("click", "main label:has-text('Swap QOR')"), ("focus", "main label:has-text('Swap QOR')")]]),
    ("send", "/send", [[("focus", "main input[type=text] >> nth=0")], [("fill", "main input[type=text] >> nth=0", SAMPLE_TO), ("fill", "main input[inputmode=decimal], main input[type=text] >> nth=1", "5"), ("fill", "main textarea", "Testnet payment for logo design"), ("focus", "main textarea")]]),
    ("receive", "/receive", [[("focus", "main button:has-text('Connect QoreX')")]]),
    ("shop", "/shop", [[("focus", "main button:has-text('Connect QoreX to mint')")]]),
    ("create", "/create", [[("focus", "main button:has-text('Mint a Genesis NFT')")], [("file", "main input[type=file]", ART), ("fill", "main input[type=text] >> nth=0", "Doha Sunrise"), ("fill", "main textarea", "A sunrise over West Bay, minted on QoreChain testnet."), ("fill", "main input[type=text] >> nth=1", "50"), ("focus", "main input[type=text] >> nth=1")]]),
    ("market", "/market", [[("focus", "main button:has-text('Create your own')")]]),
    ("portfolio", "/portfolio", [[("focus", "main h1")]]),
    ("history", "/history", [[("focus", "main h1")]]),
    ("staking", "/staking", [[("focus", "main select >> nth=0")], [("fill", "main input[type=text] >> nth=0", "15"), ("click", "main label:has-text('180 days')"), ("focus", "main label:has-text('180 days')")]]),
    ("news", "/news", [[("focus", "main table")]]),
    ("launch", "/launch", [[("focus", "main input[type=text] >> nth=0")], [("fill", "main input[type=text] >> nth=0", "Doha Falcon"), ("fill", "main input[type=text] >> nth=1", "FALCON"), ("fill", "main input[type=text] >> nth=2", "1000000"), ("fill", "main input[type=text] >> nth=3", "10"), ("focus", "main input[type=text] >> nth=3")]]),
    ("predict", "/predict", [[("focus", "main .pmcard >> nth=0")], [("click", "main .pmcard >> nth=0"), ("wait", 1500), ("focus", "main h1")]]),
    ("admin", "/admin", [[("focus", "main .hub__stats")]]),
    ("verify", "/verify", [[("focus", "main input[type=text]")], [("fill", "main input[type=text]", SAMPLE_TX), ("click", "main button:has-text('Verify')"), ("wait", 4000), ("focus", "main button:has-text('Verify')")]]),
    ("help", "/help", [[("focus", "main h1")]]),
]


def rect(page, sel):
    try:
        loc = page.locator(sel).first
        loc.wait_for(state="visible", timeout=4000)
        b = loc.bounding_box()
        sy = page.evaluate("scrollY")
        return {"x": round(b["x"]), "y": round(b["y"] + sy), "w": round(b["width"]), "h": round(b["height"])}
    except Exception as e:
        print(f"   ! focus not found: {sel} ({str(e)[:60]})")
        return None


def main(only=None):
    os.makedirs(OUT, exist_ok=True)
    meta, failed = {}, []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=4 / 3)
        ctx.add_init_script("try{localStorage.setItem('qrow.onboarding.v2','done')}catch(e){}")
        page = ctx.new_page()
        for tid, path, beats in TABS:
            if only and tid not in only:
                continue
            try:
                page.goto(BASE + path, wait_until="networkidle", timeout=60000)
                page.wait_for_timeout(2500)
            except Exception as e:
                failed.append(f"{tid}: {e}")
                continue
            meta[tid] = []
            for n, beat in enumerate(beats, 1):
                focus = None
                for act in beat:
                    kind = act[0]
                    try:
                        if kind == "fill":
                            page.locator(act[1]).first.fill(act[2], timeout=4000)
                        elif kind == "click":
                            page.locator(act[1]).first.click(timeout=4000)
                            page.wait_for_timeout(700)
                        elif kind == "file":
                            page.locator(act[1]).first.set_input_files(act[2], timeout=4000)
                            page.wait_for_timeout(800)
                        elif kind == "wait":
                            page.wait_for_timeout(act[1])
                    except Exception as e:
                        print(f"   ! {tid} beat {n} {kind} failed: {str(e)[:80]}")
                page.evaluate(STRIP_AI)
                page.evaluate("document.activeElement && document.activeElement.blur()")
                page.wait_for_timeout(400)
                for act in beat:
                    if act[0] == "focus":
                        focus = rect(page, act[1])
                page.evaluate("scrollTo(0,0)")
                f = f"{tid}-{n}.png"
                page.screenshot(path=os.path.join(OUT, f), full_page=True, type="png")
                h = page.evaluate("document.documentElement.scrollHeight")
                meta[tid].append({"file": f, "h": h, "focus": focus})
                print(f"{tid}-{n}: h={h} focus={focus}")
        b.close()
    old = {}
    mp = os.path.join(OUT, "meta.json")
    if only and os.path.exists(mp):
        old = json.load(open(mp))
    old.update(meta)
    json.dump(old, open(mp, "w"), indent=1)
    print("failed:", failed or "none")


if __name__ == "__main__":
    main(sys.argv[1:] or None)
