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
RUN pnpm turbo run build --filter "@occ/console..."

FROM nginx:1.29-alpine
COPY apps/console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/console/dist /usr/share/nginx/html
EXPOSE 80
