import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width":1440,"height":900})
    ctx.add_init_script("try{localStorage.setItem('qrow.onboarding.v2','done')}catch(e){}")
    pg = ctx.new_page(); pg.goto("https://qrow-app.vercel.app/", wait_until="networkidle"); pg.wait_for_timeout(2500)
    r = pg.evaluate("""() => ({
      nav: [...document.querySelectorAll('header a, header button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const b=e.getBoundingClientRect();return {t:e.textContent.trim().slice(0,20),href:e.getAttribute('href'),x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}}),
      tiles: [...document.querySelectorAll('.hub__grid a, .hub__grid button, .hub__grid li')].filter(e=>e.getBoundingClientRect().width>0).map(e=>{const b=e.getBoundingClientRect();return {tag:e.tagName,t:e.textContent.trim().replace(/\s+/g,' ').slice(0,30),href:e.getAttribute('href'),x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}}),
      more: [...document.querySelectorAll('.q-navmore a')].map(a=>a.getAttribute('href')),
      docH: document.documentElement.scrollHeight })""")
    print(json.dumps(r))
    b.close()
