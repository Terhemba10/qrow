# Deploying Qrow (public testnet)

Hosting approved by the owner on 2026-11-13: **Vercel** for the app and its API, **Render** only for the always-on
Telegram watcher. Testnet only (`qorechain-diana`, EVM 9800), never mainnet. No private keys on any host.

## Live (13 Nov)

| Part | Where | Address |
| --- | --- | --- |
| App (static, Vite build) | Vercel project `qrow`, team `sanix2`, root directory `web` | https://qrow-app.vercel.app (`qrow.vercel.app` was taken) |
| Agent API (prices, news, referrals, AI explanation) | Vercel Function `web/api/agent.ts` | `/agent/*` on the same domain (rewritten to `/api/agent?p=…`) |
| QoreChain REST relay (reads; signed-tx broadcast and simulate) | Vercel Function `web/api/lcd.ts` | `/lcd-testnet/*`; signed transactions POST to `/api/lcd?p=cosmos/tx/v1beta1/txs` |
| Telegram watcher + indexer | Render background worker (`render.yaml`) | not deployed yet: needs the owner's Render account; runs on the owner's PC until then |
| Contracts | QoreChain testnet | see README |

**Deploying:** push to `main` (Vercel builds from GitHub). Manual: `npx vercel deploy --prod` from the repo root
(the project link lives in `.vercel/`, git-ignored).
`.vercelignore` uploads only `web/` and never any `.env` file; checked on the first deploy (116 files, `src` and
the build only). Auto-deploy on push needs the GitHub connection below.

**Owner steps still open:**
1. ~~GitHub connection~~ **done 13 Nov** by the owner: project `qrow` is linked to `Terhemba10/qrow` (`main`), root
   `web`, Vite, domain `qrow-app.vercel.app`. Every push to `main` deploys; every pull request gets a preview URL.
2. Project `qrow` → Settings → Environment Variables: add `CMC_API_KEY` (Production and Preview), then Redeploy.
   Until then Market News shows headlines and "Prices aren't available right now".
3. Recommended: turn on two-factor authentication for the Vercel account.

**Roll back (Instant Rollback):** Vercel → Project `qrow` → Deployments → pick the last good deployment → "…" →
"Promote to Production" (or `npx vercel rollback` from the repo root). It takes seconds and doesn't rebuild.

## 1. Vercel: the app + API (`web/`)

Import `github.com/Terhemba10/qrow` in Vercel with **Root Directory `web`**. `web/vercel.json` sets the rest:
framework Vite, `npm ci`, `npm run build` (typechecks the app and the API, then builds), output `dist`.

| Path | Served by |
| --- | --- |
| `/`, `/send`, ... | the built app (`dist`); every app route falls back to `index.html` |
| `/agent/*` | `web/api/agent.ts`: AI explanation, prices, news, referrals, health |
| `/lcd-testnet/*` | `web/api/lcd.ts`: QoreChain REST relay (GET allowlisted reads; POST only to broadcast or simulate a signed tx) |

Vercel didn't route multi-segment paths to `[...path].ts` functions, and rewritten POSTs arrive without their
original path; so each API is one function that gets the path in `?p=`, and broadcasts post to `/api/lcd` directly.

The app calls these on its own domain, so there's no CORS and the CSP stays `'self'`.

**Environment variables** (Project > Settings > Environment Variables). The owner pastes the secrets; never commit them.

| Variable | Needed | Notes |
| --- | --- | --- |
| `CMC_API_KEY` | yes, for Market News prices | secret |
| `ANTHROPIC_API_KEY` | optional | secret; without it every check still shows, just without the AI wording. Set a **monthly spend limit** in the Anthropic Console. |
| `QROW_DAILY_AI_CAP` | optional | default 2000 AI calls per UTC day per function instance |
| `VITE_LIVE_TABS` | optional | default `faucet,swap,portfolio,news` (honest beta); add a tab the day it works end to end, e.g. `faucet,swap,portfolio,news,send,receive` |
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
