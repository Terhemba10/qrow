"""Record demo_final.mp4's app scenes on the live site with Playwright (1920x1080, cursor overlay, human pace).

    ../.venv/Scripts/python record_demo.py [scene ids...]     -> ../raw/<scene>.mp4 + .events.json

The owner's public address in a read-only view (it refuses every signing request), so balances and NFTs are real
and nothing is signed: every action stops at its review step. The AI tab is hidden in the recording browser
(record_lib.HIDE_AI_JS), never clicked and never named. Demo data is realistic, not "test123".
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from playwright.sync_api import sync_playwright  # noqa: E402
from record_lib import SITE, click, finish, mark, move, new_context, paste, smooth_scroll, start_clock, type_slowly  # noqa: E402

HERE = Path(__file__).resolve().parent
OWNER = "0x5b2d9c0f45aef4ab45574ad8bcc7c7b1ab03304a"         # the owner's public QoreX address (read-only)
RECIPIENT = "0xD517458C6B0838964342C604D358e6Afc2dccb37"      # Qrow's public deployer address
VERIFY_HASH = "7D766C1F3730343332DCA82574CE050C0B923C0B602B9BADF80FF1B2BD43F413"  # the owner's own swap receipt (13 Nov, 20 QOR -> fUSD)
ART = HERE / "assets" / "doha-skyline.png"


def open_scene(b, path):
    ctx = new_context(b, address=OWNER, name="demo")
    page = ctx.new_page()
    start_clock()
    page.goto(SITE + path)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(1500)
    move(page, 1180, 560, steps=1)
    mark("start", None, "")
    time.sleep(0.6)
    return ctx, page


def point(page, locator, label="", hold=1.4):
    bx = locator.bounding_box()
    move(page, bx["x"] + min(bx["width"] / 2, 240), bx["y"] + min(bx["height"] / 2, 40), steps=30)
    mark("point", bx, label)
    time.sleep(hold)


def scroll_to(page, locator, offset=220, seconds=1.6):
    y = page.evaluate("(e) => e.getBoundingClientRect().top + scrollY", locator.element_handle())
    smooth_scroll(page, max(0, y - offset), seconds=seconds)
    time.sleep(0.3)


def lab(page, text):
    return page.locator("main label", has_text=text).first


def d03_hub(b):
    ctx, page = open_scene(b, "/")
    point(page, page.locator("main h1").first, "The Hub", 1.2)
    smooth_scroll(page, 330, seconds=1.8)
    time.sleep(1.2)
    smooth_scroll(page, 760, seconds=2.0)
    time.sleep(1.6)
    return finish(page, ctx, "d03-hub")


def d04_faucet(b):
    ctx, page = open_scene(b, "/faucet")
    point(page, page.locator("main h2", has_text="Your faucet address").first, "Your address", 1.6)
    point(page, page.get_by_role("button", name="Copy address").first, "Copy it", 1.0)
    point(page, page.get_by_text("Open QoreChain Faucet").first, "QoreChain's official faucet", 2.0)
    return finish(page, ctx, "d04-faucet")


def d05_swap(b):
    ctx, page = open_scene(b, "/swap")
    pay = page.locator("main input[placeholder='0.00']").first
    pay.wait_for(state="visible", timeout=20_000)
    type_slowly(page, pay, "25", delay_ms=260, label="Type the amount")
    time.sleep(1.8)
    point(page, page.locator("main label", has_text="You receive").first, "The chain's own quote", 1.4)
    point(page, page.locator("main h2", has_text="Details").first, "Price, fee and pool", 2.4)
    return finish(page, ctx, "d05-swap")


def d06_trade(b):
    ctx, page = open_scene(b, "/trade")
    click(page, page.get_by_role("button", name="ETH/USDT").first, pause=1.0, label="ETH/USDT")
    click(page, page.get_by_role("button", name="Long", exact=True).first, pause=0.6, label="Long")
    margin = page.get_by_label("Margin (fUSD, 1 to 10,000)").first
    margin.click(click_count=3)
    type_slowly(page, margin, "50", delay_ms=260, label="Margin: 50 fUSD")
    time.sleep(0.6)
    point(page, page.get_by_label("Leverage: 10x").first, "10x leverage", 1.4)
    click(page, page.get_by_role("button", name="Review long").first, pause=3.2, label="Review before signing")
    return finish(page, ctx, "d06-trade")


def d07_predict(b):
    ctx, page = open_scene(b, "/predict")
    point(page, page.locator("main button", has_text="BTC close above").first, "Back YES or NO", 1.4)
    click(page, page.locator("main button", has_text="BTC close above").first, pause=3.4, label="The odds")
    return finish(page, ctx, "d07-predict")


def d08_send(b):
    ctx, page = open_scene(b, "/send")
    paste(page, page.get_by_label("Recipient’s address").first, RECIPIENT, label="Paste the address")
    time.sleep(1.0)
    type_slowly(page, page.get_by_label("Amount").first, "15", delay_ms=260, label="15 fUSD")
    time.sleep(0.5)
    click(page, lab(page, "Recipient claims it"), pause=0.6, label="How it's released")
    time.sleep(0.8)
    click(page, page.get_by_role("button", name="Review payment").first, pause=0.5, label="Review")
    page.get_by_text("You send").first.wait_for(state="visible", timeout=30_000)  # the confirm screen's checks
    time.sleep(0.8)
    point(page, page.get_by_text("You send").first, "Exactly where the money goes", 2.6)
    return finish(page, ctx, "d08-send")


def d09_receive(b):
    ctx, page = open_scene(b, "/receive")
    type_slowly(page, page.get_by_label("Amount (optional)").first, "40", delay_ms=240, label="Request 40 fUSD")
    type_slowly(page, page.locator("main input").nth(4), "Invoice #1042", delay_ms=70, label="A note")
    time.sleep(0.6)
    point(page, page.get_by_role("button", name="Copy link").first, "Share the link or QR code", 2.4)
    return finish(page, ctx, "d09-receive")


def d10_shop(b):
    ctx, page = open_scene(b, "/shop")
    point(page, page.locator("main h2", has_text="Recently minted").first, "Generative art, on chain", 1.8)
    point(page, page.get_by_role("button", name="Mint for 1 fUSD").first, "Mint one", 2.2)
    return finish(page, ctx, "d10-shop")


def d11_create(b):
    ctx, page = open_scene(b, "/create")
    scroll_to(page, page.locator("main h2", has_text="Your own NFT").first, offset=160)
    f = page.locator("main input[type=file]").first
    point(page, f, "Upload your artwork", 0.6)
    f.set_input_files(str(ART))
    time.sleep(1.4)
    type_slowly(page, page.get_by_label("Name").first, "Doha Skyline", delay_ms=80, label="Name it")
    type_slowly(page, page.get_by_label("Description").first, "West Bay at dusk, in Qrow teal.", delay_ms=45, label="")
    c = page.get_by_label("Copies (supply)").first
    c.click(click_count=3)
    type_slowly(page, c, "25", delay_ms=240, label="25 copies")
    time.sleep(1.6)
    return finish(page, ctx, "d11-create")


def d12_market(b):
    ctx, page = open_scene(b, "/market")
    point(page, page.locator("main h2", has_text="Qrow Genesis listings").first, "Listings and the floor", 1.6)
    scroll_to(page, page.locator("main h2", has_text="Community NFTs").first, offset=200, seconds=1.8)
    point(page, page.locator("main h2", has_text="Community NFTs").first, "Community collections", 2.0)
    return finish(page, ctx, "d12-market")


def d13_portfolio(b):
    ctx, page = open_scene(b, "/portfolio")
    point(page, page.locator("main h2", has_text="Balances").first, "Your balances", 1.4)
    scroll_to(page, page.locator("main h2", has_text="Qrow Genesis NFTs").first, offset=220, seconds=1.8)
    point(page, page.locator("main h2", has_text="Qrow Genesis NFTs").first, "Your Genesis NFT", 2.2)
    return finish(page, ctx, "d13-portfolio")


def d14_history(b):
    ctx, page = open_scene(b, "/history")
    rows = page.locator("main table tbody tr")
    rows.first.wait_for(state="visible", timeout=30_000)  # read from the chain
    point(page, rows.first, "Your transactions, read from the chain", 1.6)
    point(page, page.locator("main table tbody tr td button").first, "Each with its hash", 1.2)
    point(page, page.locator("main table tbody tr a", has_text="Verify").first, "Check any of them", 1.4)
    return finish(page, ctx, "d14-history")


def d15_staking(b):
    ctx, page = open_scene(b, "/staking")
    scroll_to(page, page.locator("main h2", has_text="Stake").nth(1), offset=260)
    sel = page.locator("#stk-val")
    point(page, sel, "Pick a validator", 0.5)
    opts = sel.locator("option").all()
    if len(opts) > 1:
        sel.select_option(index=1)
    time.sleep(0.6)
    type_slowly(page, page.get_by_label("Amount (QOR)").first, "10", delay_ms=260, label="10 QOR")
    time.sleep(0.5)
    click(page, lab(page, "90 days"), pause=1.8, label="Lock for a bonus")
    return finish(page, ctx, "d15-staking")


def d16_launch(b):
    ctx, page = open_scene(b, "/launch")
    type_slowly(page, page.get_by_label("Name").first, "Pearl Coin", delay_ms=90, label="Name")
    type_slowly(page, page.get_by_label("Symbol").first, "PEARL", delay_ms=120, label="Symbol")
    s = page.get_by_label("Total supply (whole coins)").first
    s.click(click_count=3)
    type_slowly(page, s, "1000000", delay_ms=90, label="Fixed supply")
    time.sleep(1.4)
    return finish(page, ctx, "d16-launch")


def d17_news(b):
    ctx, page = open_scene(b, "/news")
    point(page, page.locator("main h2", has_text="Prices").first, "Live prices", 1.4)
    scroll_to(page, page.locator("main h2", has_text="Headlines").first, offset=200, seconds=1.8)
    time.sleep(1.4)
    return finish(page, ctx, "d17-news")


def d18_verify(b):
    ctx, page = open_scene(b, "/verify")
    paste(page, page.get_by_label("Transaction hash or Qrow reference").first, VERIFY_HASH, label="Paste a hash")
    time.sleep(0.6)
    click(page, page.get_by_role("button", name="Verify").first, pause=0.4, label="Verify")
    page.wait_for_timeout(3500)
    sig = page.get_by_text("hybrid signature, verified by the chain").first
    sig.wait_for(state="visible", timeout=30_000)
    point(page, page.get_by_text("Confirmed").first, "Confirmed on testnet", 1.4)
    scroll_to(page, sig, offset=380, seconds=1.6)
    point(page, sig, "ML-DSA-87, verified by the chain", 2.4)
    return finish(page, ctx, "d18-verify")


def d19_admin(b):
    ctx, page = open_scene(b, "/admin")
    page.wait_for_timeout(2500)
    point(page, page.locator("main h1").first, "Live Qrow numbers", 1.4)
    smooth_scroll(page, 380, seconds=1.8)
    time.sleep(1.6)
    return finish(page, ctx, "d19-admin")


SCENES = {f.__name__.replace("_", "-"): f for f in [d03_hub, d04_faucet, d05_swap, d06_trade, d07_predict, d08_send, d09_receive, d10_shop, d11_create,
                                                    d12_market, d13_portfolio, d14_history, d15_staking, d16_launch, d17_news, d18_verify, d19_admin]}


def make_art():
    """Original artwork for the Create NFT scene: a stylised Doha West Bay skyline (drawn here, SVG)."""
    if ART.exists():
        return
    towers = "".join(f'<rect x="{x}" y="{y}" width="{w}" height="{1000 - y}" rx="6" fill="url(#t)"/>' for x, y, w in
                     [(90, 560, 70), (180, 430, 60), (255, 300, 54), (330, 470, 80), (430, 250, 64), (512, 380, 70), (600, 200, 58), (676, 520, 90), (786, 360, 66), (870, 480, 60)])
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14162c"/><stop offset=".6" stop-color="#3a2a6e"/><stop offset="1" stop-color="#9b4dff"/></linearGradient>
<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3ef0d2"/><stop offset="1" stop-color="#0d0f22"/></linearGradient></defs>
<rect width="1000" height="1000" fill="url(#sky)"/><circle cx="760" cy="230" r="70" fill="#eef0ff" opacity=".85"/>{towers}
<rect y="880" width="1000" height="120" fill="#0d0f22" opacity=".85"/></svg>'''
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={"width": 1000, "height": 1000})
        pg.set_content(f"<body style='margin:0'>{svg}</body>")
        pg.screenshot(path=str(ART))
        b.close()


def main():
    make_art()
    want = sys.argv[1:] or list(SCENES)
    with sync_playwright() as p:
        b = p.chromium.launch()
        for sid in want:
            try:
                print(SCENES[sid](b))
            except Exception as e:  # keep going; report the scene that needs a fix
                print(f"{sid}: FAILED {type(e).__name__}: {str(e)[:200]}")
        b.close()


if __name__ == "__main__":
    main()
