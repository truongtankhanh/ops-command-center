# Build context: repository root (see docker-compose.yml).
FROM node:24-alpine AS build
# The pnpm store lives on a BuildKit cache mount (/pnpm/store), reused across builds.
ENV PNPM_HOME=/pnpm
RUN corepack enable
WORKDIR /repo
# Lockfile first: this layer, and the download, survive any source edit.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=occ-pnpm-store,target=/pnpm/store pnpm fetch
COPY turbo.json tsconfig.base.json ./
# Whole workspace so the lockfile matches; .dockerignore keeps node_modules and dist out.
COPY packages ./packages
COPY apps ./apps
COPY ops/telemetry-sim ./ops/telemetry-sim
RUN --mount=type=cache,id=occ-pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter "@occ/telemetry-sim..."
# Self-contained bundle: the script and its production dependencies only.
RUN --mount=type=cache,id=occ-pnpm-store,target=/pnpm/store pnpm --filter @occ/telemetry-sim deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
# No port and no HEALTHCHECK: it is an MQTT client, and a dead simulator shows as stale assets.
CMD ["node", "dist/main.js"]
