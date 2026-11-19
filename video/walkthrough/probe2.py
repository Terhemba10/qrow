import json
from playwright.sync_api import sync_playwright
TABS = ["/faucet","/swap","/trade","/send","/receive","/shop","/create","/market","/portfolio","/history","/staking","/news","/launch","/predict","/admin","/verify","/help"]
JS = r"""() => {
 const lab = e => (e.labels?.[0]?.textContent || e.getAttribute('aria-label') || e.placeholder || e.name || '').trim().replace(/\s+/g,' ').slice(0,40);
 const vis = e => { const b=e.getBoundingClientRect(); return b.width>0 && b.height>0; };
 return {
  h: document.documentElement.scrollHeight,
  inputs: [...document.querySelectorAll('main input, main textarea, main select')].filter(vis).map((e,i)=>({i, type:e.type, label:lab(e), y:Math.round(e.getBoundingClientRect().y+scrollY)})),
  buttons: [...document.querySelectorAll('main button, main a.btn')].filter(vis).slice(0,12).map(e=>({t:e.textContent.trim().replace(/\s+/g,' ').slice(0,30), y:Math.round(e.getBoundingClientRect().y+scrollY)}))
 }; }"""
out = {}
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width":1440,"height":900})
    ctx.add_init_script("try{localStorage.setItem('qrow.onboarding.v2','done')}catch(e){}")
    pg = ctx.new_page()
    for t in TABS:
        pg.goto("https://qrow-app.vercel.app"+t, wait_until="networkidle"); pg.wait_for_timeout(1500)
        out[t] = pg.evaluate(JS)
    b.close()
for t,v in out.items():
    print(t, "h=",v["h"]); print("  in:", [(x["i"],x["type"],x["label"],x["y"]) for x in v["inputs"]]); print("  btn:", [(x["t"],x["y"]) for x in v["buttons"]])
