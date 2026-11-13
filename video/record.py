"""Record the automatic demo shots on the live site (https://qrow-app.vercel.app) with Playwright.

    .venv/Scripts/python record.py            all automatic shots
    .venv/Scripts/python record.py s07-verify  one shot

Writes video/raw/<shot>.mp4 (1920x1080, 30 fps) and <shot>.events.json (each click, paste, typed text and
pointed-at element, with its time and on-screen box) that the HyperFrames edit uses for zooms and labels.
Shots that need the owner's real QoreX approval are recorded by the owner (see RECORDING.md); nothing
here imitates QoreX. Where a shot needs data, a read-only view of the owner's test address is used; it
refuses every signing method.
"""
import sys
import time

from playwright.sync_api import sync_playwright

from record_lib import HERE, SITE, click, finish, mark, move, new_context, paste, smooth_scroll, start_clock, type_slowly

TEST_ADDRESS = "0xa99c92e2f1b4368eafbc335478ac998e011a41fc"
# A real, confirmed Qrow transaction (docs/TEST_NOTES.md, one-approval smoke test): createPayment, payment #3,
# run by the device as the user, ML-DSA-87 verified by the chain.
VERIFY_HASH = "0F8F8829A6C2461722ED0417684A3A63E75276E8934F3DA91B16FA8DCFF54D73"
DEMO_RECIPIENT = "0xD517458c6b083B964342C604D35Be6afC2dCcb37"


def open_page(ctx, path):
    page = ctx.new_page()
    start_clock()
    page.goto(SITE + path)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1200)
    move(page, 960, 560, steps=1)
    return page


def point(page, locator, label, hold=1.6, steps=32):
    """Glide the cursor onto an element and log it as the thing being pointed at."""
    bx = locator.bounding_box()
    move(page, bx["x"] + min(bx["width"] / 2, 260), bx["y"] + bx["height"] / 2, steps=steps)
    mark("point", bx, label)
    time.sleep(hold)


def nav(page, label, pause=3.2):
    click(page, page.locator("nav.nav a", has_text=label).first, pause=0.2, label=label)
    page.wait_for_load_state("networkidle")
    time.sleep(pause)


def s02_what(b):  # 16 s scene
    ctx = new_context(b, name="s02")
    page = open_page(ctx, "/")
    time.sleep(2.5)
    move(page, 700, 420, steps=40)
    y = page.locator("#try-title").bounding_box()["y"] - 140
    smooth_scroll(page, y, seconds=5)
    time.sleep(1.0)
    for label in ["Faucet", "Swap", "Send"]:
        point(page, page.locator(".trylist a", has_text=label).first, label, hold=1.3)
    smooth_scroll(page, y + 420, seconds=4)
    time.sleep(2.5)
    return finish(page, ctx, "s02-what", trim_start=1.0)


def s03_faucet(b):  # second half of the 15 s scene; the owner records Connect + QoreX approval first
    ctx = new_context(b, address=TEST_ADDRESS, name="s03")
    page = open_page(ctx, "/")
    nav(page, "Faucet", pause=1.6)
    point(page, page.locator(".faucet-addr").first, "Your faucet address", hold=2.0)
    point(page, page.locator("text=Copy address").first, "Copy it", hold=1.4)
    point(page, page.locator("text=Open QoreChain Faucet").first, "Free test tokens here", hold=2.2)
    move(page, 1200, 560, steps=30)
    time.sleep(1.5)
    return finish(page, ctx, "s03b-faucet", trim_start=1.5)


def s05_form(b):  # first part of the 26 s scene: fill the form. The owner's clip starts with "Review payment".
    ctx = new_context(b, address=TEST_ADDRESS, name="s05")
    page = open_page(ctx, "/send")
    time.sleep(1.0)
    paste(page, page.locator("input.input--mono").first, DEMO_RECIPIENT, label="Paste the recipient's address")
    time.sleep(2.0)
    type_slowly(page, page.locator("input[placeholder='0.00']").first, "1", delay_ms=260, label="Type the amount here")
    time.sleep(1.8)
    point(page, page.locator("button[type=submit]", has_text="Review payment"), "Review, then one approval in QoreX", hold=2.4, steps=40)
    return finish(page, ctx, "s05a-form", trim_start=1.5)


def s05_alt(b):  # 22 s alternate: a real Qrow payment, made and cancelled with one approval each
    ctx = new_context(b, name="s05alt")
    page = open_page(ctx, "/verify")
    time.sleep(1.0)
    type_slowly(page, page.locator("input.input--mono").first, "QRW-PAY-000003", delay_ms=120, label="Type a Qrow reference")
    time.sleep(0.6)
    click(page, page.locator("main form button[type=submit]"), pause=0.2, label="Verify")
    page.wait_for_selector("text=a real Qrow payment", timeout=30_000)
    time.sleep(1.5)
    point(page, page.locator("text=a real Qrow payment").first, "Read from the escrow contract", hold=2.0)
    smooth_scroll(page, 380, seconds=4)
    time.sleep(2.5)
    box = page.locator("input.input--mono").first
    box.fill("")
    paste(page, box, VERIFY_HASH, label="Paste its transaction hash")
    click(page, page.locator("main form button[type=submit]"), pause=0.2, label="Verify")
    page.wait_for_selector("text=Confirmed: a Qrow transaction", timeout=30_000)
    time.sleep(1.5)
    smooth_scroll(page, 600, seconds=4)
    time.sleep(3.0)
    return finish(page, ctx, "s05-alt", trim_start=1.5)


def s07_verify(b):  # 20 s scene
    ctx = new_context(b, name="s07")
    page = open_page(ctx, "/verify")
    time.sleep(1.2)
    paste(page, page.locator("input.input--mono").first, VERIFY_HASH, label="Paste any hash")
    time.sleep(1.2)
    click(page, page.locator("main form button[type=submit]"), pause=0.2, label="Verify on testnet")
    page.wait_for_selector("text=Confirmed: a Qrow transaction", timeout=30_000)
    time.sleep(1.2)
    point(page, page.locator("text=Confirmed: a Qrow transaction").first, "Confirmed on QoreChain testnet", hold=1.8)
    point(page, page.locator("text=hybrid signature, verified by the chain").first, "Quantum-safe signature, verified", hold=2.4)
    smooth_scroll(page, page.locator(".verify__step").first.bounding_box()["y"] - 300, seconds=3.5)
    time.sleep(1.0)
    point(page, page.locator(".verify__step").first, "What the contract did", hold=4.0)
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
    """Title / end card (video/cards.html), recorded like the other shots (kept as a fallback for the motion-showreel cards)."""
    ctx = new_context(b, name=shot_id)
    page = ctx.new_page()
    start_clock()
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
    "s09-end": s09_end,
    "s02-what": s02_what,
    "s03b-faucet": s03_faucet,
    "s05a-form": s05_form,
    "s05-alt": s05_alt,
    "s07-verify": s07_verify,
    "s08-more": s08_more,
}

if __name__ == "__main__":
    wanted = sys.argv[1:] or [k for k in SHOTS if k not in ("s01-hook", "s09-end")]
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--disable-notifications", "--hide-scrollbars", "--force-color-profile=srgb"])
        for name in wanted:
            out = SHOTS[name](browser)
            print(f"{name}: {out}")
        browser.close()
