# Deploying Qrow (public testnet)

Hosting approved by the owner on 2026-11-13: **Vercel** for the app and its API, **Render** only for the always-on
Telegram watcher. Testnet only (`qorechain-diana`, EVM 9800), never mainnet. No private keys on any host.

## 1. Vercel: the app + API (`web/`)

Import `github.com/Terhemba10/qrow` in Vercel with **Root Directory `web`**. `web/vercel.json` sets the rest:
framework Vite, `npm ci`, `npm run build` (typechecks the app and the API, then builds), output `dist`.

| Path | Served by |
| --- | --- |
| `/`, `/send`, ... | the built app (`dist`); every app route falls back to `index.html` |
| `/agent/*` | `web/api/agent/[...path].ts`: AI explanation, prices, news, referrals, health |
| `/lcd-testnet/*` | `web/api/lcd/[...path].ts`: read-only QoreChain REST relay (GET, allowlisted paths) |

The app calls these on its own domain, so there's no CORS and the CSP stays `'self'`.

**Environment variables** (Project > Settings > Environment Variables). The owner pastes the secrets; never commit them.

| Variable | Needed | Notes |
| --- | --- | --- |
| `CMC_API_KEY` | yes, for Market News prices | secret |
| `ANTHROPIC_API_KEY` | optional | secret; without it every check still shows, just without the AI wording. Set a **monthly spend limit** in the Anthropic Console. |
| `QROW_DAILY_AI_CAP` | optional | default 2000 AI calls per UTC day per function instance |
| `VITE_LIVE_TABS` | optional | default `send,receive,portfolio,news`; add a tab the day it passes its tests |
| `VITE_WALLETCONNECT_PROJECT_ID` | optional | public; lets phone wallets connect by QR |

Caching: prices `s-maxage=600`, news 900, referral counts 300, so a crowd costs one upstream call per window.
Rate limits run per function instance (6 AI calls, 120 other calls, 600 relay reads per IP per minute).

**Roll back:** Vercel > Deployments > a previous deployment > "Promote to Production" (instant).
Every push to `main` deploys to production; every pull request gets a preview URL.

## 2. Render: the Telegram watcher (optional, $7/month)

Render > New > Blueprint > this repo; it reads `render.yaml` (a Starter background worker built from the root
`Dockerfile`, with a 1 GB disk at `/app/watcher/data`). Secret: `TELEGRAM_BOT_TOKEN`. Run only one copy (Telegram
allows one poller per bot, so stop the local watcher first). Logs: Render > qrow-watcher > Logs.

**Roll back:** Render > qrow-watcher > Events > a previous deploy > Rollback.

## 3. Checks after each deploy

- `https://<domain>/agent/health` returns `{"ok":true,...}`.
- The Start page shows the readiness card; Market News shows prices; Send and Receive load.
- Uptime: an UptimeRobot HTTP monitor on `/agent/health` every 5 minutes, email alerts.

## Local development

`web`: `npm run dev` (Vite on 127.0.0.1:5173). `agent`: `npm run start` (127.0.0.1:8787) serves the same `/agent`
and `/lcd-testnet` code from `web/server` for the dev proxy. `watcher`: `npm run start`.
