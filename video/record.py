"""Record the automatic demo shots on the live site (https://qrow-app.vercel.app) with Playwright.

    .venv/Scripts/python record.py            all automatic shots
    .venv/Scripts/python record.py s07-verify  one shot

Writes video/raw/<shot>.mp4 (1920x1080, 30 fps). Each clip runs a few seconds longer than its scene.
Shots that need the owner's real QoreX approval are recorded by the owner (see RECORDING.md); nothing
here imitates QoreX. Where a shot needs data, a read-only view of the owner's test address is used; it
refuses every signing method.
"""
import sys
import time

from playwright.sync_api import sync_playwright

from record_lib import HERE, SITE, click, finish, move, new_context, smooth_scroll, type_slowly

TEST_ADDRESS = "0xa99c92e2f1b4368eafbc335478ac998e011a41fc"
# A real, confirmed Qrow transaction (docs/TEST_NOTES.md, one-approval smoke test): createPayment, payment #3,
# run by the device as the user, ML-DSA-87 verified by the chain.
VERIFY_HASH = "0F8F8829A6C2461722ED0417684A3A63E75276E8934F3DA91B16FA8DCFF54D73"
DEMO_RECIPIENT = "0xD517458c6b083B964342C604D35Be6afC2dCcb37"


def open_page(ctx, path):
    page = ctx.new_page()
    page.goto(SITE + path)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1200)
    move(page, 960, 560, steps=1)
    return page


def nav(page, label, pause=3.2):
    click(page, page.locator("nav.nav a", has_text=label).first, pause=0.2)
    page.wait_for_load_state("networkidle")
    time.sleep(pause)


def s02_what(b):  # 16 s scene
    ctx = new_context(b, name="s02")
    page = open_page(ctx, "/")
    time.sleep(2.5)
    move(page, 700, 420, steps=40)
    y = page.locator("#try-title").bounding_box()["y"] - 140
    smooth_scroll(page, y, seconds=5)
    time.sleep(1.5)
    for label in ["Faucet", "Swap", "Send"]:
        link = page.locator(".trylist a", has_text=label).first
        bx = link.bounding_box()
        move(page, bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2, steps=30)
        time.sleep(1.3)
    smooth_scroll(page, y + 420, seconds=4)
    time.sleep(2.5)
    return finish(page, ctx, "s02-what", trim_start=1.0)


def s03_faucet(b):  # second half of the 15 s scene; the owner records Connect + QoreX approval first
    ctx = new_context(b, address=TEST_ADDRESS, name="s03")
    page = open_page(ctx, "/")
    nav(page, "Faucet", pause=2.0)
    for sel in [".faucet-addr", "text=Copy address", "text=Open QoreChain Faucet"]:
        el = page.locator(sel).first
        bx = el.bounding_box()
        move(page, bx["x"] + min(bx["width"] / 2, 260), bx["y"] + bx["height"] / 2, steps=30)
        time.sleep(1.8)
    move(page, 1200, 560, steps=30)
    time.sleep(2.0)
    return finish(page, ctx, "s03b-faucet", trim_start=1.5)


def s05_form(b):  # first part of the 26 s scene: fill the form. The owner's clip starts with "Review payment".
    ctx = new_context(b, address=TEST_ADDRESS, name="s05")
    page = open_page(ctx, "/send")
    time.sleep(1.0)
    to = page.locator("input.input--mono").first
    click(page, to, pause=0.4)
    to.fill(DEMO_RECIPIENT)  # pasted, as people do (typing shows a half-typed address error)
    time.sleep(1.8)
    type_slowly(page, page.locator("input[placeholder='0.00']").first, "1", delay_ms=150)
    time.sleep(1.5)
    btn = page.locator("button[type=submit]", has_text="Review payment")
    bx = btn.bounding_box()
    move(page, bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2, steps=35)
    time.sleep(2.5)
    return finish(page, ctx, "s05a-form", trim_start=1.5)


def s05_alt(b):  # 22 s alternate: a real Qrow payment, made and cancelled with one approval each
    ctx = new_context(b, name="s05alt")
    page = open_page(ctx, "/verify")
    time.sleep(1.0)
    type_slowly(page, page.locator("input.input--mono").first, "QRW-PAY-000003", delay_ms=120)
    time.sleep(0.6)
    click(page, page.locator("main form button[type=submit]"), pause=0.2)
    page.wait_for_selector("text=a real Qrow payment", timeout=30_000)
    time.sleep(3.0)
    smooth_scroll(page, 380, seconds=5)
    time.sleep(4.0)
    page.locator("input.input--mono").first.fill("")
    type_slowly(page, page.locator("input.input--mono").first, VERIFY_HASH[:20], delay_ms=25)
    page.locator("input.input--mono").first.fill(VERIFY_HASH)
    click(page, page.locator("main form button[type=submit]"), pause=0.2)
    page.wait_for_selector("text=Confirmed: a Qrow transaction", timeout=30_000)
    time.sleep(2.0)
    smooth_scroll(page, 600, seconds=4)
    time.sleep(3.0)
    return finish(page, ctx, "s05-alt", trim_start=1.5)


def s07_verify(b):  # 20 s scene
    ctx = new_context(b, name="s07")
    page = open_page(ctx, "/verify")
    time.sleep(1.2)
    box = page.locator("input.input--mono").first
    type_slowly(page, box, VERIFY_HASH[:16], delay_ms=40)
    box.fill(VERIFY_HASH)  # the rest pasted, as people do
    time.sleep(0.8)
    click(page, page.locator("main form button[type=submit]"), pause=0.2)
    page.wait_for_selector("text=Confirmed: a Qrow transaction", timeout=30_000)
    time.sleep(2.5)
    sig = page.locator("text=hybrid signature, verified by the chain").first
    bx = sig.bounding_box()
    move(page, bx["x"] + 40, bx["y"] + bx["height"] / 2, steps=35)
    time.sleep(2.5)
    smooth_scroll(page, page.locator(".verify__step").first.bounding_box()["y"] - 300, seconds=4)
    time.sleep(2.0)
    step = page.locator(".verify__step").first
    bx = step.bounding_box()
    move(page, bx["x"] + 200, bx["y"] + 60, steps=35)
    time.sleep(5.0)
    return finish(page, ctx, "s07-verify", trim_start=1.5)


def s08_more(b):  # 12 s scene: quick cuts
    ctx = new_context(b, address=TEST_ADDRESS, name="s08")
    page = open_page(ctx, "/portfolio")
    time.sleep(2.0)
    smooth_scroll(page, 260, seconds=1.4)
    time.sleep(0.6)
    smooth_scroll(page, 0, seconds=0.6)
    for label in ["NFT Shop", "Staking", "Launch"]:
        nav(page, label, pause=2.6)
        smooth_scroll(page, 200, seconds=1.0)
        smooth_scroll(page, 0, seconds=0.4)
    time.sleep(1.0)
    return finish(page, ctx, "s08-more", trim_start=1.5)


def card(b, which, shot_id, seconds):
    """Title / end card (video/cards.html), recorded like the other shots."""
    ctx = new_context(b, name=shot_id)
    page = ctx.new_page()
    page.goto((HERE / "cards.html").as_uri() + f"?card={which}")
    page.wait_for_load_state("networkidle")
    page.evaluate("document.getElementById('__demo_cursor')?.remove()")  # no cursor on cards
    time.sleep(seconds)
    return finish(page, ctx, shot_id, trim_start=0.0)


def s01_hook(b):  # 12 s scene
    return card(b, "title", "s01-hook", 15)


def s09_end(b):  # 12 s scene
    return card(b, "end", "s09-end", 15)


SHOTS = {
    "s01-hook": s01_hook,
    "s09-end": s09_end,"s02-what": s02_what, "s03b-faucet": s03_faucet, "s05a-form": s05_form, "s05-alt": s05_alt, "s07-verify": s07_verify, "s08-more": s08_more}

if __name__ == "__main__":
    wanted = sys.argv[1:] or list(SHOTS)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-notifications", "--hide-scrollbars", "--force-color-profile=srgb"])
        for name in wanted:
            out = SHOTS[name](browser)
            print(f"{name}: {out}")
        browser.close()
