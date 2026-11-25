# Operate

## Running locally

```bash
pnpm install
pnpm dev
pnpm run sync
pnpm run verify
```

## Configuration and secrets

Environment variables (`PORT`, `DB_PATH`, `LOG_LEVEL`) are validated at startup with Zod so invalid config fails immediately. No secrets are required locally; in cloud, database credentials or future authenticated CDR certificates would come from a managed secret store at runtime rather than container images.

## Logs and health

- Structured JSON logs go to stdout with timestamps, levels, request IDs, durations, and bank identifiers.
- `GET /health` reports overall status (`ok` or `degraded`), bank counts, freshness timestamps, and any degraded bank errors.

## Failure modes and rollback

- Malformed CDR records are quarantined individually so valid products in the same batch still commit.
- Mid-batch database errors roll back the entire snapshot transaction so half-updated rates are never served.
- Degraded syncs record the error and mark the bank degraded while keeping the last verified snapshot live for readers.
- Because migrations are additive and each sync creates a new run record, rolling back a bad release or snapshot only requires reverting the container image or re-ingesting the prior verified snapshot.

## Local-to-cloud promotion

1. Merge PR after CI passes on protected `main`.
2. Build a multi-stage Node 24 container image, run SAST and image vulnerability scanning, and push to a private registry.
3. Deploy to staging backed by managed PostgreSQL, run migrations, and verify with snapshot replay and smoke checks.
4. Promote to production via canary or blue/green rollout gated on `/health` and error-rate alarms.
