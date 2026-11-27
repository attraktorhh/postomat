# syntax=docker/dockerfile:1
# Postomat bot – build from the repository root:
#   docker build -f apps/bot/Dockerfile -t postomat-bot .
# glibc base on purpose: native modules (Rust crypto, sharp, resvg) need it.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NX_DAEMON=false NX_NO_CLOUD=true
RUN npm install -g pnpm@12.21.0 && apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm nx run bot:build
# Collect the built workspace packages (exports point at dist/) plus runtime assets.
RUN mkdir -p /out && cd packages && find . -type d \( -name dist -o -name assets -o -name migrations \) -prune -not -path '*/node_modules/*' -exec cp -r --parents {} /out/ \;

FROM base AS deps
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps ./apps-src
COPY --from=build /app/packages ./packages-src
# Only the package manifests, then a production install.
RUN mkdir -p apps packages && \
    (cd apps-src && find . -name package.json -not -path '*/node_modules/*' -exec cp --parents {} ../apps \;) && \
    (cd packages-src && find . -name package.json -not -path '*/node_modules/*' -exec cp --parents {} ../packages \;) && \
    rm -rf apps-src packages-src && \
    pnpm install --prod --frozen-lockfile

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY --from=build /out ./packages
COPY --from=build /app/apps/bot/dist ./apps/bot/dist
# E2EE crypto store + sync token. Mount a persistent volume here and never lose it.
ENV MATRIX_DATA_DIR=/data/matrix BOT_HEALTH_PORT=3001
RUN mkdir -p /data/matrix && chown -R node:node /data
VOLUME /data
COPY postomat.config.json ./
ENV POSTOMAT_CONFIG=/app/postomat.config.json
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:3001/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["node", "apps/bot/dist/main.js"]
