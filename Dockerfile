# Qrow Telegram alerts watcher (Render background worker). The web app and its API run on Vercel.
# Secrets (TELEGRAM_BOT_TOKEN) come from Render's environment settings, never from the image.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY watcher/package.json watcher/package-lock.json watcher/
RUN npm ci --prefix watcher --no-audit --no-fund
COPY watcher/src watcher/src
COPY watcher/tsconfig.json watcher/
# The persistent disk mounts at /app/watcher/data (subscriptions and back-fill position).
RUN mkdir -p watcher/data && chown -R node:node /app/watcher/data
USER node
CMD ["npm", "--prefix", "watcher", "run", "start:prod"]
