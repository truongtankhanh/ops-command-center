# Build context: repository root (see docker-compose.yml).
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
# Whole workspace so the lockfile matches; .dockerignore keeps node_modules and dist out.
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter "@occ/api..."
# Self-contained production bundle: the app, its built workspace packages and prod dependencies only.
RUN pnpm --filter @occ/api deploy --prod --legacy /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1
CMD ["node", "dist/main.js"]
