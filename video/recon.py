"""Reconnaissance on the live site: does the read-only view connect, and what do the tabs show?"""
import sys
from playwright.sync_api import sync_playwright
from record_lib import SITE, HERE, read_only_js, CURSOR_JS

ADDR = sys.argv[1] if len(sys.argv) > 1 else "0xa99c92e2f1b4368eafbc335478ac998e011a41fc"
out = HERE / "raw" / "_recon"
out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1920, "height": 1080}, color_scheme="dark")
    ctx.add_init_script(CURSOR_JS)
    ctx.add_init_script(read_only_js(ADDR))
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    for path in ["/", "/portfolio", "/shop", "/staking", "/launch", "/faucet", "/swap", "/send"]:
        page.goto(SITE + path)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2500)
        header = page.locator("header").inner_text().replace("\n", " | ")[-80:]
        main = page.locator("main").inner_text()[:220].replace("\n", " | ")
        page.screenshot(path=str(out / f"{path.strip('/') or 'start'}.png"))
        print(f"{path}: header=…{header}\n   main={main}\n")
    print("console errors:", errors[:5])
    b.close()
