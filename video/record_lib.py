"""Shared helpers for recording Qrow's demo footage on the live site with Playwright.

- 1920x1080 pages, recorded by Playwright (headless: no browser UI), converted to 30 fps MP4 with ffmpeg.
- A highlighted cursor drawn into the page (headless recordings have no cursor), moved smoothly.
- Read-only view of an address (only when a shot needs data): a minimal provider that reports the
  address and chain and REFUSES every signing or sending method. It is not QoreX and can approve
  nothing; approvals in the demo are recorded by the owner in real QoreX.
"""
import shutil
import subprocess
import time
from pathlib import Path

SITE = "https://qrow-app.vercel.app"
W, H = 1920, 1080
HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
TMP = HERE / "raw" / "_tmp"

CURSOR_JS = r"""
(() => {
  const add = () => {
    if (document.getElementById('__demo_cursor')) return;
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.style.cssText = 'position:fixed;left:-100px;top:-100px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
      'background:rgba(62,240,210,.35);border:2px solid #3ef0d2;box-shadow:0 0 0 6px rgba(62,240,210,.15);' +
      'pointer-events:none;z-index:2147483647;transition:transform .12s ease-out;';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.transform = 'scale(.7)'; }, true);
    addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; }, true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
  // No first-visit welcome tip in the footage.
  try { localStorage.setItem('qrow.welcomeTip.v1', 'closed'); } catch {}
})();
"""


def read_only_js(address: str) -> str:
    """A read-only provider for `address` on QoreChain testnet (chain 9800). Every signing method is refused."""
    return r"""
(() => {
  const ADDR = '%s';
  const refuse = (m) => Promise.reject(Object.assign(new Error('read-only view: ' + m + ' refused'), { code: 4001 }));
  const provider = {
    isReadOnlyView: true,
    request: async ({ method }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ADDR];
      if (method === 'eth_chainId') return '0x2648';
      if (method === 'net_version') return '9800';
      if (method === 'wallet_getPermissions' || method === 'wallet_requestPermissions') return [{ parentCapability: 'eth_accounts' }];
      return refuse(method);
    },
    on() {}, removeListener() {},
  };
  Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
  try {
    localStorage.setItem('wagmi.recentConnectorId', '"injected"');
    localStorage.setItem('wagmi.injected.connected', 'true');
  } catch {}
})();
""" % address


def new_context(browser, *, address: str | None = None, name: str = "clip"):
    TMP.mkdir(parents=True, exist_ok=True)
    ctx = browser.new_context(
        viewport={"width": W, "height": H},
        device_scale_factor=1,
        record_video_dir=str(TMP / name),
        record_video_size={"width": W, "height": H},
        color_scheme="dark",
        reduced_motion="no-preference",
    )
    ctx.add_init_script(CURSOR_JS)
    if address:
        ctx.add_init_script(read_only_js(address))
    return ctx


def move(page, x, y, steps=25):
    page.mouse.move(x, y, steps=steps)


def click(page, locator, pause=0.8):
    """Glide to the element, click it, then pause so viewers can follow."""
    box = locator.bounding_box()
    move(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    time.sleep(0.25)
    locator.click()
    time.sleep(pause)


def smooth_scroll(page, to_y, seconds=4.0):
    """Scroll gently (eased) to `to_y` over `seconds`."""
    page.evaluate(
        """([to, ms]) => new Promise(done => {
          const from = scrollY, t0 = performance.now();
          const ease = t => t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
          const step = now => { const t = Math.min(1, (now - t0) / ms); scrollTo(0, from + (to - from) * ease(t)); t < 1 ? requestAnimationFrame(step) : done(); };
          requestAnimationFrame(step);
        })""",
        [to_y, int(seconds * 1000)],
    )


def type_slowly(page, locator, text, delay_ms=110):
    click(page, locator, pause=0.3)
    locator.press_sequentially(text, delay=delay_ms)


def finish(page, ctx, shot_id: str, trim_start: float = 0.0):
    """Close the page, then convert Playwright's WebM to a 30 fps H.264 MP4 at video/raw/<shot>.mp4."""
    video = page.video
    page.close()
    ctx.close()
    src = Path(video.path())
    RAW.mkdir(parents=True, exist_ok=True)
    out = RAW / f"{shot_id}.mp4"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{trim_start:.2f}", "-i", str(src),
         "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-an", str(out)],
        check=True,
    )
    shutil.rmtree(src.parent, ignore_errors=True)
    return out
