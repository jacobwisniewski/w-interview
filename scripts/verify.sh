#!/usr/bin/env bash
set -euo pipefail

echo "==> 1/6 Typecheck (tsc --noEmit)"
pnpm run typecheck

echo "==> 2/6 Lint (oxlint)"
pnpm run lint

echo "==> 3/6 Format check (oxfmt --check)"
pnpm run format:check

echo "==> 4/6 Unit & integration tests (vitest)"
pnpm run test

echo "==> 5/6 Build (tsc)"
pnpm run build

echo "==> 6/6 End-to-end live server smoke test (offline clean DB)"
TMP_DB="$(mktemp -t cdr-smoke-XXXXXX.db)"
PORT=3499 DB_PATH="$TMP_DB" LOG_LEVEL=warn node dist/index.js &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  rm -f "$TMP_DB" "${TMP_DB}-wal" "${TMP_DB}-shm"
}
trap cleanup EXIT

for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:3499/health >/dev/null; then
    break
  fi
  sleep 0.25
done

curl -sf http://127.0.0.1:3499/health | grep -q '"status":"ok"'
curl -sf "http://127.0.0.1:3499/api/products?bank=westpac" | grep -q '"bankSlug":"westpac"'
curl -sf http://127.0.0.1:3499/api/quarantine | grep -q '"productId":"ex-malformed-record"'
curl -sf -X POST -H "content-type: application/json" \
  -d '{"mode":"snapshot","version":"v2"}' \
  http://127.0.0.1:3499/api/ingest >/dev/null
curl -sf http://127.0.0.1:3499/api/changes | grep -q '"headlineDeltaBps":15'
curl -sf -X POST -H "content-type: application/json" \
  -d '{"mode":"simulate-degrade","bankSlug":"up"}' \
  http://127.0.0.1:3499/api/ingest >/dev/null
curl -sf http://127.0.0.1:3499/health | grep -q '"status":"degraded"'

echo "==> ALL CHECKS PASSED"
