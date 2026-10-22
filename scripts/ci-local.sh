#!/usr/bin/env bash
#
# A local stand-in for .github/workflows/ci.yml, so a PR does not wait for GitHub's runners.
#
#   verify  (job 1)  install, format:check, lint, typecheck, models (typecheck, check, test), test, test:e2e, build
#   images  (job 2)  docker compose build, boot with two API replicas, the same probes as CI
#
# It keeps CI's order and its checks; when ci.yml changes, change this file in the same PR.
# Differences, on purpose: it throttles (turbo and test workers; this machine has little headroom),
# it runs e2e against a throwaway Postgres container, and the Compose stack runs under its own
# project name with its own ports, so `down -v` can never touch the volumes of `pnpm docker:up`.
#
# Usage:  scripts/ci-local.sh [options]      (or: pnpm ci:local [options])
#   --fast          format, lint, typecheck, model checks and unit tests only (no install, e2e, build, images)
#   --only verify   run job 1 only            --only images   run job 2 only
#   --skip-e2e      skip test:e2e (the slow one; needs Docker)
#   --skip-images   skip job 2
#   --no-install    skip `pnpm install --frozen-lockfile`
#   --jobs N        turbo concurrency and test workers (default 2)
#   --keep-going    run every step even after a failure
#   --keep          leave the Postgres container and the Compose stack running
#   --fresh         ignore Turborepo's cache (`--force`): lint, typecheck, test and build really run, as on
#                   a GitHub runner, which starts with no cache. Use it for the last run before a merge.
#   --clean         afterwards also delete what the run leaves behind: the Compose images
#                   (`down -v --rmi local`) and Turborepo's local cache (.turbo/cache)
#   -h, --help
#
# Caches: Turborepo's (.turbo/, git-ignored) makes a repeat run fast and, being keyed on file contents,
# is safe; Docker's build cache and the pnpm store cache mount are shared with `pnpm docker:stack` and
# are never pruned here (run `docker builder prune` yourself if the disk fills up). The Postgres
# container, the Compose containers/volumes and the temporary log folder are always removed.
#
# Environment: CI_LOCAL_PG_PORT (e2e Postgres, default 55432), CI_LOCAL_COMPOSE_PG_PORT (15433),
# CI_LOCAL_COMPOSE_KC_PORT (18082). The console's port 18080 is fixed by docker/docker-compose.yml, so stop
# `pnpm docker:stack` before the images job.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

RUN_VERIFY=1 RUN_IMAGES=1 RUN_E2E=1 RUN_BUILD=1 DO_INSTALL=1 FAST=0
JOBS=2 KEEP_GOING=0 KEEP=0 FORCE="" CLEAN=0

usage() { sed -n '2,/^set -uo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1; RUN_E2E=0; RUN_BUILD=0; RUN_IMAGES=0; DO_INSTALL=0 ;;
    --only)
      shift
      case "${1:-}" in
        verify) RUN_IMAGES=0 ;;
        images) RUN_VERIFY=0 ;;
        *) echo "--only takes 'verify' or 'images'" >&2; exit 2 ;;
      esac ;;
    --skip-e2e) RUN_E2E=0 ;;
    --skip-images) RUN_IMAGES=0 ;;
    --no-install) DO_INSTALL=0 ;;
    --jobs) shift; JOBS="${1:-2}" ;;
    --keep-going) KEEP_GOING=1 ;;
    --keep) KEEP=1 ;;
    --fresh) FORCE="--force" ;;
    --clean) CLEAN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# --- bookkeeping -------------------------------------------------------------------------------

STEP_NAMES=() STEP_RESULTS=() STEP_SECS=()
STARTED_AT=$(date +%s)
PG_NAME=occ-ci-local-pg
PG_PORT="${CI_LOCAL_PG_PORT:-55432}"
PG_STARTED=0
STACK_STARTED=0
FAILED=0
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/occ-ci-local.XXXXXX")"

# Same project name for every `dc` call below: its own containers, network and volumes.
export COMPOSE_PROJECT_NAME=occ-ci-local
export POSTGRES_PORT="${CI_LOCAL_COMPOSE_PG_PORT:-15433}"
export KEYCLOAK_PORT="${CI_LOCAL_COMPOSE_KC_PORT:-18082}"
# The Compose file lives in docker/; `dc` is `docker compose` pointed at it (as in ci.yml and the pnpm scripts).
dc() { docker compose -f docker/docker-compose.yml "$@"; }

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAIL:\033[0m %s\n' "$*" >&2; return 1; }
port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

summary() {
  local i total=$(( $(date +%s) - STARTED_AT )) failed=0
  say "Summary (sha $(git rev-parse --short HEAD), working tree $([ -n "$(git status --porcelain)" ] && echo dirty || echo clean))"
  for i in "${!STEP_NAMES[@]}"; do
    printf '  %-6s %-34s %4ss\n' "${STEP_RESULTS[$i]}" "${STEP_NAMES[$i]}" "${STEP_SECS[$i]}"
    [ "${STEP_RESULTS[$i]}" = FAIL ] && failed=1
  done
  FAILED=$failed
  printf '  total %ss\n' "$total"
  if [ "$failed" -eq 1 ]; then echo "CI (local): FAILED"; else echo "CI (local): all steps passed"; fi
  return "$failed"
}

cleanup() {
  if [ "$KEEP" -eq 1 ]; then
    [ "$PG_STARTED" -eq 1 ] && echo "Kept container $PG_NAME on port $PG_PORT."
    [ "$STACK_STARTED" -eq 1 ] && echo "Kept Compose project $COMPOSE_PROJECT_NAME (docker compose -f docker/docker-compose.yml -p $COMPOSE_PROJECT_NAME down -v to remove)."
    return
  fi
  [ "$PG_STARTED" -eq 1 ] && docker rm -f "$PG_NAME" >/dev/null 2>&1
  # `-v` is safe here: the project name above is not the one `pnpm docker:up` uses.
  if [ "$CLEAN" -eq 1 ] && [ "$RUN_IMAGES" -eq 1 ]; then
    dc down -v --rmi local >/dev/null 2>&1   # also the images this project built
  elif [ "$STACK_STARTED" -eq 1 ]; then
    dc down -v >/dev/null 2>&1
  fi
  [ "$CLEAN" -eq 1 ] && rm -rf .turbo/cache
  # The logs are only worth keeping after a failure (the path was printed with the stack logs).
  [ "$FAILED" -eq 0 ] && rm -rf "$LOG_DIR"
  return 0
}
trap cleanup EXIT

# run_step <name> <command...>: times it, records it, stops at the first failure unless --keep-going.
run_step() {
  local name="$1"; shift
  say "$name"
  local t0; t0=$(date +%s)
  if "$@"; then STEP_RESULTS+=(ok); else STEP_RESULTS+=(FAIL); fi
  STEP_NAMES+=("$name"); STEP_SECS+=("$(( $(date +%s) - t0 ))")
  if [ "${STEP_RESULTS[$(( ${#STEP_RESULTS[@]} - 1 ))]}" = FAIL ] && [ "$KEEP_GOING" -eq 0 ]; then
    summary; exit 1
  fi
}

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing tool: $1 ($2)" >&2; exit 2; }; }

# --- job 1: verify -------------------------------------------------------------------------------

start_postgres() {
  need docker "e2e needs a throwaway Postgres; use --skip-e2e to go without"
  if port_in_use "$PG_PORT"; then fail "port $PG_PORT is taken; set CI_LOCAL_PG_PORT"; return 1; fi
  docker rm -f "$PG_NAME" >/dev/null 2>&1
  docker run -d --name "$PG_NAME" -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=ops_test -p "127.0.0.1:$PG_PORT:5432" postgres:17-alpine >/dev/null || return 1
  PG_STARTED=1
  local i
  for i in $(seq 1 60); do
    docker exec "$PG_NAME" pg_isready -U postgres -d ops_test >/dev/null 2>&1 && return 0
    sleep 1
  done
  fail "Postgres did not become ready in 60 s"
}

e2e() {
  start_postgres || return 1
  # Real environment variables beat apps/api/.env.test, so this never reads or edits it (the suite
  # drops and rebuilds the schema: the name must end in _test). CI sets the same variables.
  DB_HOST=127.0.0.1 DB_PORT="$PG_PORT" DB_NAME=ops_test DB_USER=postgres DB_PASSWORD=postgres \
    pnpm exec turbo run test:e2e --concurrency=1
}

verify_job() {
  need pnpm "corepack enable"
  local want have
  want="$(tr -d 'v \n' < .nvmrc | cut -d. -f1)"; have="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$want" = "$have" ] || echo "warning: .nvmrc says Node $want, this shell has Node $have"

  [ "$DO_INSTALL" -eq 1 ] && run_step "pnpm install --frozen-lockfile" pnpm install --frozen-lockfile
  run_step "format:check"  pnpm format:check
  run_step "lint"          pnpm exec turbo run lint --concurrency="$JOBS" $FORCE
  run_step "typecheck"     pnpm exec turbo run typecheck --concurrency="$JOBS" $FORCE
  run_step "models:typecheck" pnpm models:typecheck
  run_step "models:check"  pnpm models:check
  run_step "models:test"   pnpm models:test
  run_step "test (unit)"   pnpm exec turbo run test --concurrency="$JOBS" $FORCE -- --maxWorkers="$JOBS"
  [ "$RUN_E2E" -eq 1 ]   && run_step "test:e2e (throwaway Postgres)" e2e
  [ "$RUN_BUILD" -eq 1 ] && run_step "build" pnpm exec turbo run build --concurrency="$JOBS" $FORCE
}

# --- job 2: images (the same probes as ci.yml, in the same order) ---------------------------------

images_preflight() {
  need docker "the images job builds and boots the Compose stack"
  need curl "used by the probes"; need jq "used by the rate-limit probe"
  local p
  for p in 18080 "$POSTGRES_PORT" "$KEYCLOAK_PORT"; do
    if port_in_use "$p"; then fail "port $p is in use (stop 'pnpm docker:stack'/'docker:up', or set the CI_LOCAL_COMPOSE_* ports)"; return 1; fi
  done
}

images_build() { dc build; }

images_up() {
  STACK_STARTED=1
  dc up -d --wait --wait-timeout 180 --scale api=2
}

images_replicas() {
  local healthy
  healthy=$(dc ps api --format '{{.Health}}' | grep -c '^healthy$')
  [ "$healthy" -eq 2 ] || { fail "expected 2 healthy api replicas, got $healthy"; return 1; }
  curl -fsS --retry 5 --retry-connrefused http://localhost:18080/api/health/ready
}

images_metrics() {
  local code id binding replica body
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:18080/api/metrics || true)
  [ "$code" = 404 ] || { fail "/api/metrics through nginx returned $code, want 404"; return 1; }
  for id in $(dc ps -q api); do
    binding=$(docker port "$id" 9464 2>/dev/null || true)
    [ -z "$binding" ] || { fail "api container $id publishes 9464 on the host: $binding"; return 1; }
  done
  for replica in 1 2; do
    body=$(dc exec -T --index "$replica" api wget -qO- http://127.0.0.1:9464/metrics) ||
      { fail "api replica $replica does not serve /metrics on 9464"; return 1; }
    grep -q '^process_start_time_seconds{.*env="demo"' <<< "$body" ||
      { fail "api replica $replica metrics lack process_start_time_seconds with env=\"demo\""; return 1; }
  done
}

images_rate_limit() {
  local i body="$LOG_DIR/rl-body" code="$LOG_DIR/rl-code"
  for i in $(seq 1 50); do
    curl -s -o "$body" -w '%{http_code}\n' http://localhost:18080/socket.io/ > "$code"
    grep -qx 429 "$code" && break
  done
  grep -qx 429 "$code" || { fail "nginx never answered 429 on /socket.io/"; return 1; }
  jq -e '.statusCode == 429 and .error == "TOO_MANY_REQUESTS"
         and has("message") and has("path") and has("timestamp")' "$body"
}

# /models/ (ADR-0020 § Serving): the same checks as ci.yml's step of that name.
images_models() {
  local base=http://localhost:18080 body="$LOG_DIR/models-body" headers="$LOG_DIR/models-headers"
  local model class code type cache path
  get() { curl -s -o "$body" -D "$headers" -w '%{http_code}' "$base$1" || true; }
  header() { grep -i "^$1:" "$headers" | tr -d '\r' | cut -d: -f2- | sed 's/^ *//' || true; }
  # The Compose mount is ./ops/models, so the checkout holds the names nginx can serve.
  set -- ops/models/*.glb
  [ -e "$1" ] || { fail "ops/models holds no .glb to request"; return 1; }
  model=$(basename "$1")
  class=${model%%.*}

  code=$(get "/models/$model")
  [ "$code" = 200 ] || { fail "/models/$model returned $code, want 200"; return 1; }
  type=$(header content-type)
  [ "$type" = model/gltf-binary ] || { fail "/models/$model has Content-Type '$type', want model/gltf-binary"; return 1; }
  cache=$(header cache-control)
  case "$cache" in *immutable*) ;; *) fail "/models/$model has Cache-Control '$cache', want immutable"; return 1 ;; esac
  cmp -s "$body" "ops/models/$model" || { fail "/models/$model is not the file in ops/models"; return 1; }

  # A well-formed name of the class with another hash, an unknown name and the directory: 404, not the SPA.
  for path in "/models/$class.000000000000.glb" /models/nope.000000000000.glb /models/; do
    code=$(get "$path")
    [ "$code" = 404 ] || { fail "$path returned $code, want 404"; return 1; }
    if grep -q 'id="root"' "$body"; then fail "$path answered with the SPA page"; return 1; fi
  done

  # The console's own routes are unaffected.
  code=$(get /campus/overview)
  [ "$code" = 200 ] || { fail "/campus/overview returned $code, want 200"; return 1; }
  grep -q 'id="root"' "$body" || { fail "/campus/overview did not answer with the SPA page"; return 1; }
}

images_liveness() {
  # Last: it stops the database. Each replica must stay live and report not ready (ADR-0013).
  dc stop postgres || return 1
  local replica
  probe() { dc exec -T --index "$1" api wget -qO /dev/null "http://127.0.0.1:3000/api/health/$2"; }
  for replica in 1 2; do
    probe "$replica" live || { fail "api replica $replica is not live with the database stopped"; return 1; }
    if probe "$replica" ready; then fail "api replica $replica reports ready with the database stopped"; return 1; fi
  done
}

images_job() {
  run_step "images: preflight"        images_preflight
  run_step "images: compose build"    images_build
  run_step "images: boot, 2 replicas" images_up
  run_step "images: replicas healthy" images_replicas
  run_step "images: metrics stay off the edge" images_metrics
  run_step "images: nginx rate limit" images_rate_limit
  run_step "images: /models/ served immutably, nothing else" images_models
  run_step "images: liveness survives a DB outage" images_liveness
}

# --- go --------------------------------------------------------------------------------------------

[ "$RUN_VERIFY" -eq 1 ] && verify_job
if [ "$RUN_IMAGES" -eq 1 ]; then
  images_job
  # CI prints the stack's logs on failure; here they go to a file, the tail is shown.
  if printf '%s\n' "${STEP_RESULTS[@]}" | grep -qx FAIL && [ "$STACK_STARTED" -eq 1 ]; then
    dc logs --no-color > "$LOG_DIR/stack.log" 2>&1
    echo "Stack logs: $LOG_DIR/stack.log"; tail -n 40 "$LOG_DIR/stack.log"
  fi
fi
summary
