# Deploying Qrow (public testnet)

Qrow runs as one small Node process from the `Dockerfile` at the repo root. It serves the web app, the
agent API at `/agent` and a read-only relay to QoreChain's REST API at `/lcd-testnet` (that API sends no
CORS headers, so browsers can't call it directly). Any host that runs a Docker image and gives HTTPS works.

## Qrow's hosting (approved 2026-11-13)

**Frontend: Cloudflare Pages** (free). Workers & Pages > Create > Pages > Connect to Git > this repo.
- Project name: `qrow` (gives `https://qrow.pages.dev`; the API allows this name and its previews).
- Root directory: `web`. Build command: `npm run build:pages`. Output directory: `dist`.
- Environment variables (Production and Preview): `VITE_API_BASE` = the Render URL (e.g. `https://qrow-api.onrender.com`),
  `NODE_VERSION` = `22`, optionally `VITE_WALLETCONNECT_PROJECT_ID`.
- `npm run build:pages` writes `_headers` (CSP that only allows Qrow's API and QoreChain) and `_redirects` (app routes).

**API + relay + watcher: Render** (Starter, $7/month, plus a 1 GB disk). New > Blueprint > this repo; Render reads `render.yaml`.
- Secrets it asks for: `CMC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY` (optional), `QROW_ALLOWED_ORIGINS` (optional, a custom domain).
- `agent/src/run.ts` starts the server and the watcher; the watcher restarts itself if it crashes. `/agent/health` shows
  `"watcher":"running"`.
- First deploy: confirm the watcher can write to the disk at `/app/watcher/data` (health stays "running").

**Uptime:** UptimeRobot HTTP monitor on `https://<render-url>/agent/health`, every 5 minutes, email alerts.

**Roll back:** Render > service > Events > a previous deploy > Rollback. Cloudflare Pages > Deployments > a previous one > Rollback.

## 1. Service: web app + agent API

- Build from the repo root with the `Dockerfile`. It listens on `$PORT` (default 8080) and has a health check at `/agent/health`.
- The image already sets `HOST=0.0.0.0` and `TRUST_PROXY=1` (exactly one reverse proxy in front, as on most hosts).
- Set these as **secret environment variables in the host's dashboard**, never in the repo:

| Variable | Needed for | Notes |
| --- | --- | --- |
| `CMC_API_KEY` | Market News prices | Free CoinMarketCap plan; cached 10 min server-side |
| `ANTHROPIC_API_KEY` | Plain-language summary on Review | Optional; without it every check still works |
| `QROW_DAILY_AI_CAP` | Spending ceiling | Default 2000 AI calls per UTC day across all users |

- Build-time (optional): `VITE_WALLETCONNECT_PROJECT_ID`, a free project ID from Reown (WalletConnect), so phone
  wallets can connect by QR code. Without it, phones work only inside a wallet's built-in browser.

## 2. Service: Telegram alerts watcher (optional)

Same image, command `npm --prefix watcher run start:prod`, secret `TELEGRAM_BOT_TOKEN`. It needs a persistent
disk mounted at `/app/watcher/data` (subscriptions and back-fill position). Run only one copy.

## 3. After the first deploy

- Open `https://<your-domain>/agent/health`: `{"ok":true,...}`.
- Open the app on a phone and a PC; Market News should show prices, Launch should list LANT.
- Update the project page on build.qorechain.io with the link.

## What the server protects

- Rate limits per IP: 6 AI summaries a minute, 120 other agent calls, 600 relay reads.
- The relay is GET-only and allowlisted (`/cosmos/{bank,staking,distribution,auth,tx,base}/`, `/qorechain/`,
  `/cosmwasm/wasm/v1/contract/`), 15 s timeout, 4 MB cap. It cannot broadcast transactions.
- Security headers: a strict Content-Security-Policy (scripts only from Qrow itself), no framing, no referrer.
- No cookies, no accounts, nothing about users stored. Keys never reach the browser.
