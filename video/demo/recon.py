"""List each page's headings, inputs and buttons (read-only view of the owner's address) -> out/recon.txt"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from playwright.sync_api import sync_playwright  # noqa: E402
from record_lib import HIDE_AI_JS, SITE, read_only_js  # noqa: E402

OWNER = "0x5b2d9c0f45aef4ab45574ad8bcc7c7b1ab03304a"
PAGES = ["/", "/faucet", "/swap", "/trade", "/predict", "/send", "/receive", "/shop", "/create", "/market", "/portfolio", "/history", "/staking", "/launch", "/news", "/verify", "/admin", "/help"]
JS = """() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const box = (e) => { const r = e.getBoundingClientRect(); return `@${Math.round(r.x)},${Math.round(r.y + scrollY)} ${Math.round(r.width)}x${Math.round(r.height)}`; };
  const out = [];
  document.querySelectorAll('main h1, main h2, main h3').forEach(e => vis(e) && out.push(`H ${e.tagName} "${e.innerText.trim().slice(0,60)}" ${box(e)}`));
  document.querySelectorAll('main input, main textarea, main select').forEach(e => vis(e) && out.push(`I ${e.tagName}[${e.type||''}] id=${e.id} name=${e.name} ph="${e.placeholder||''}" label="${(e.labels && e.labels[0] ? e.labels[0].innerText : '').trim().slice(0,40)}" ${box(e)}`));
  document.querySelectorAll('main button, main a.btn, main [role=tab]').forEach(e => vis(e) && out.push(`B "${e.innerText.trim().replace(/\\s+/g,' ').slice(0,50)}" dis=${e.disabled||false} ${box(e)}`));
  out.push(`PAGE height ${document.documentElement.scrollHeight}`);
  return out.join('\\n');
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1920, "height": 1080})
    ctx.add_init_script(HIDE_AI_JS)
    ctx.add_init_script(read_only_js(OWNER))
    page = ctx.new_page()
    lines = []
    for path in PAGES:
        page.goto(SITE + path)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2500)
        lines.append(f"===== {path}\n" + page.evaluate(JS))
    (Path(__file__).parent / "out" / "recon.txt").write_text("\n".join(lines), encoding="utf-8")
    b.close()
print("ok")
