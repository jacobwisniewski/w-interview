# Design — AU Open Banking (CDR) Home Loan Rate & Change Monitor

## Architecture Overview
```text
+-------------------+       +------------------------+       +--------------------+
| Public CDR APIs   |  OR   | Bundled CDR Snapshots  |       |  Web UI / Clients  |
| (optional live)   |       | (sample-data/ default) |       | (public/index.html)|
+---------+---------+       +-----------+------------+       +---------+----------+
          |                             |                              |
          +--------------+--------------+                              | HTTP/JSON
                         v                                             v
               +--------------------+                        +--------------------+
               |  CDR Client/Loader |                        |  Hono HTTP Server  |
               |  (x-v negotiation, |                        |  (/health, /api/*) |
               |   allowlist,       |                        +---------+----------+
               |   timeout/degrade) |                                  |
               +---------+----------+                                  v
                         v                                   +--------------------+
               +--------------------+                        |  SQLite Repository |
               |  Domain & Guardrails|<--------------------->|  (node:sqlite,     |
               |  (Zod validation,  |                        |   BEGIN IMMEDIATE  |
               |   normalisation,   |                        |   atomic txns)     |
               |   abstain, diffs)  |                        +--------------------+
               +--------------------+
```

## Data Flow & Component Boundaries
- **`src/config.ts`**: Fail-fast Zod validation of env vars (`PORT`, `DB_PATH`, `LOG_LEVEL`, `CDR_TIMEOUT_MS`, `ALLOW_LIVE_SYNC`).
- **`src/logger.ts`**: Structured JSON logger with `requestId` / child context propagation.
- **`src/cdr/schema.ts`**: Strict Zod schemas for CDR `BankingProductDetail` and snapshot envelopes.
- **`src/domain/normalise.ts`**: Pure functions (zero I/O) parsing CDR decimal rates to percentage points, AUD fees to integer cents, selecting representative Owner-Occupied P&I rates, flagging `MANUAL_REVIEW_REQUIRED` on missing/out-of-bounds comparison rates, quarantining invalid payloads, and computing basis-point diffs.
- **`src/db/repository.ts` & `src/db/sqlite-repository.ts`**: `ProductRepository` interface backed by Node's built-in `node:sqlite`. Every snapshot ingest runs inside `BEGIN IMMEDIATE ... COMMIT` (rolling back all writes on any error) and degraded syncs preserve `last_good_sync_run_id`.
- **`src/cdr/live-client.ts`**: Allowlist-only live CDR fetcher negotiating `x-v` downward on HTTP `406` with `AbortSignal.timeout`.
- **`src/server/app.ts`**: Hono REST API with Zod query/body validation, `X-Request-Id`, safe 500 error boundary, and static UI serving.

## Security & Privacy Considerations
- **Public data only:** Strictly public CDR Product Reference Data; no PII or secrets.
- **SSRF protection:** Live sync only accepts `bankSlug` values present in `sample-data/manifest.json` (never user-supplied URLs) and can be disabled with `ALLOW_LIVE_SYNC=false`.
- **SQL & boundary safety:** Parameterised SQL queries only; all external JSON and HTTP params validated via Zod; internal stack traces are logged server-side and never returned to HTTP clients.

## Likely Production / Cloud Shape
- **Compute:** Containerised Node.js service (ECS Fargate / AKS) behind an API Gateway + WAF with internal OIDC/mTLS auth.
- **Database:** Managed PostgreSQL (Amazon Aurora Multi-AZ with KMS encryption) implementing `ProductRepository`.
- **Ingestion:** Scheduled EventBridge/cron worker per bank with circuit breakers, DLQ alerting on quarantine spikes, and OpenTelemetry export.
- **CI/CD:** GitHub Actions PR gate (`verify` check on protected `main`, already configured in `.github/workflows/ci.yml`) → container build/scan (SAST + Trivy) → staging replay against synthetic/public CDR fixtures → progressive production rollout with `/health`-gated rollback.
