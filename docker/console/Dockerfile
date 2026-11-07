# Build context: repository root (see docker/docker-compose.yml).
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
# `ops/telemetry-sim` is a workspace member, so the frozen lockfile needs its manifest; its source is
# not part of this image.
COPY ops/telemetry-sim/package.json ./ops/telemetry-sim/package.json
RUN --mount=type=cache,id=occ-pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter "@occ/console..."

FROM nginx:1.29-alpine
COPY docker/console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/console/dist /usr/share/nginx/html
# Compress the build's large text files once, here, at level 9 (V3-11.9, ADR-0020 § Serving): nginx sends the `.gz`
# beside a file (`gzip_static`) to a browser that accepts gzip, so a request costs no CPU and what is sent is the size
# `scripts/chunk-budget.ts` budgets. `-k` keeps the originals for clients without gzip. Only `assets/` (content-hashed)
# and `decoders/`; nginx compresses any other text file over 1 KB on the fly. A missing directory fails the build, on
# purpose: both are part of every console build.
RUN find /usr/share/nginx/html/assets /usr/share/nginx/html/decoders -type f \
      \( -name '*.js' -o -name '*.css' -o -name '*.wasm' -o -name '*.json' -o -name '*.svg' \) \
      -exec gzip -9 -k {} +
EXPOSE 80
