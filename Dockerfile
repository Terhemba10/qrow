# Qrow: one image, two processes (pick one per service).
#   web + agent API + REST relay:  default CMD             (listens on $PORT, default 8080)
#   Telegram alerts watcher:       CMD ["npm","--prefix","watcher","run","start:prod"]
# Secrets come from the host's environment settings, never from the image.

# ---- build the web app
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- runtime
FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 TRUST_PROXY=1 QROW_WEB_DIST=/app/web/dist
WORKDIR /app
COPY agent/package.json agent/package-lock.json agent/
RUN npm ci --prefix agent --no-audit --no-fund
COPY watcher/package.json watcher/package-lock.json watcher/
RUN npm ci --prefix watcher --no-audit --no-fund
COPY agent/src agent/src
COPY agent/tsconfig.json agent/
COPY watcher/src watcher/src
COPY watcher/tsconfig.json watcher/
COPY --from=web /src/web/dist web/dist
RUN mkdir -p watcher/data && chown -R node:node /app/watcher/data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/agent/health || exit 1
CMD ["npm", "--prefix", "agent", "run", "start:prod"]
