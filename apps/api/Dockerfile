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
RUN --mount=type=cache,id=occ-pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter "@occ/api..."
# Self-contained production bundle: the app, its built workspace packages and prod dependencies only.
RUN --mount=type=cache,id=occ-pnpm-store,target=/pnpm/store pnpm --filter @occ/api deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
# Prometheus scrape port (ADR-0015). Keep it on an internal network: never publish it.
EXPOSE 9464
# Liveness, never readiness (ADR-0013): Swarm or an autoheal restarts on this, and restarting every
# replica fixes no database outage. Boot gating still holds: the API listens only once the database
# is connected and migrated. The start period covers the 60 s migration-lock wait plus TypeORM's
# connection retries; a fast boot turns healthy on its first success.
HEALTHCHECK --interval=10s --timeout=3s --start-period=90s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health/live > /dev/null || exit 1
CMD ["node", "dist/main.js"]
