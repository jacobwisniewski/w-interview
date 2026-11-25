# Operate — Runbook, Observability, Failure Modes, and Cloud Promotion

## Running Locally
```bash
pnpm install
pnpm dev              # http://localhost:3000 (auto-seeds v1 snapshot into ./data/cdr-monitor.db)
pnpm run sync:live -- --bank=up   # optional live sync for one allowlisted bank
pnpm run verify       # full CI + live server smoke check
```

## Configuration & Secrets
- Validated fail-fast at startup by `src/config.ts` (invalid port/timeout exits immediately with a clear error).
- See `.env.example` for supported variables: `PORT`, `DB_PATH`, `LOG_LEVEL`, `CDR_TIMEOUT_MS`, `ALLOW_LIVE_SYNC`.
- **Secrets approach:** Zero secrets required locally. In a cloud environment, DB credentials or future authenticated CDR mTLS certificates would be injected via AWS Secrets Manager / Azure Key Vault and rotated without baking into images.

## Logs & Health Status
- **Structured JSON logs** (`src/logger.ts`) emitted to stdout with `timestamp`, `level`, `msg`, `requestId`, `method`, `path`, `status`, `durationMs`, and `bankSlug`.
- **`GET /health`** returns `status: "ok" | "degraded"`, `bankCount`, `degradedCount`, and per-bank `lastSyncedAt`, `cdrVersion`, `validProductCount`, `quarantinedCount`, and `lastError`.

## Known Failure Modes & Degrade / Rollback Thinking
1. **Upstream CDR `406 UnsupportedVersion` or `5xx` / timeout:** `syncLiveBanks` negotiates `x-v` (`7 -> 3`) on `406` and aborts after `CDR_TIMEOUT_MS`. If still failing, `recordDegradedSync` marks `bank_status.degraded = 1` while **preserving `last_good_sync_run_id`**, so API/UI consumers keep reading the last verified snapshot cleanly.
2. **Malformed CDR payload from a bank:** Isolated per-product into `quarantined_products` with Zod error details; valid sibling products still commit.
3. **Mid-batch DB failure:** Wrapped in SQLite `BEGIN IMMEDIATE ... COMMIT` with automatic `ROLLBACK`, preventing half-updated rates.
4. **Bad release / rollback:** Because schema migrations are additive and each sync creates an immutable `sync_run_id`, rolling back a container image or reverting a bad snapshot only requires repointing `last_good_sync_run_id` (or re-ingesting the prior verified snapshot).

## Local-to-Cloud Promotion
1. Merge PR after `verify` passes on GitHub Actions.
2. Build immutable multi-stage Node 24 container image, run SAST + image scan, push to private registry.
3. Deploy to Staging with `DB_PATH` replaced by managed Aurora PostgreSQL, run smoke + synthetic CDR replay.
4. Promote to Production via blue/green or canary deployment gated on `/health` and 5xx/latency alarms.
