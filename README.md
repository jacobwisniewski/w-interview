# AU Open Banking (CDR) Home Loan Monitor

Locally runnable service that ingests, validates, normalises, and compares public Australian Consumer Data Right (CDR) Product Reference Data for residential mortgages across 41 Australian banks (including Westpac, NAB, Macquarie, Up, Bendigo, Bank Australia, Unloan, ME Bank, and BOQ).

All data is public unauthenticated CDR product reference data plus one synthetic edge-case fixture (`example-bank.json`). No API keys, credentials, customer PII, or confidential data are required.

![AU Open Banking (CDR) Home Loan Monitor UI](docs/ui-preview.png)

## Prerequisites

- Node.js 22.5+ (tested on 24.16)
- pnpm 10

## Setup and run

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. On first boot, the server runs Drizzle SQL migrations from `drizzle/` against `./data/cdr-monitor.db` and loads the bundled `sample-data/snapshots/v1/` snapshot.

To ingest another snapshot via CLI:

```bash
pnpm run sync -- --version=v2
```

## Verification

```bash
pnpm run verify
```

Runs `tsc --noEmit`, `oxlint` (100 rules including custom `local/no-comments`, `local/no-let`, `local/no-array-mutation`, and `local/no-classes`), `oxfmt --check`, 37 Vitest BDD tests across 8 colocated test files, `tsc` build, and a live smoke test against `dist/index.js` using a temporary SQLite database.

## Example workflow

```bash
curl -s "http://localhost:3000/api/products?bank=westpac" | jq '.products[] | {name, headlineRatePct, comparisonRatePct, reviewStatus}'
curl -s "http://localhost:3000/api/quarantine" | jq '.records'
curl -s -X POST -H "content-type: application/json" -d '{"mode":"snapshot","version":"v2"}' http://localhost:3000/api/ingest
curl -s "http://localhost:3000/api/changes" | jq '.changes'
curl -s -X POST -H "content-type: application/json" -d '{"mode":"simulate-degrade","bankSlug":"up"}' http://localhost:3000/api/ingest
curl -s "http://localhost:3000/health" | jq '{status, degradedCount}'
```

## Known limitations

- Scoped to `RESIDENTIAL_MORTGAGES` only (no credit cards, savings, or authenticated CDR consumer data).
- Runs offline against bundled public CDR snapshots rather than making live outbound HTTP calls at runtime.
- Uses single-node SQLite (`better-sqlite3` + Drizzle) locally; a multi-instance cloud deployment would swap the repository implementation to Drizzle + PostgreSQL/Aurora.
- Picks one representative Owner-Occupied P&I rate per product for comparison; products missing a valid comparison rate are flagged `MANUAL_REVIEW_REQUIRED`.

## Evidence pack

- [evidence/intent.md](evidence/intent.md)
- [evidence/design.md](evidence/design.md)
- [evidence/agentic-workflow.md](evidence/agentic-workflow.md)
- [evidence/verify.md](evidence/verify.md)
- [evidence/operate.md](evidence/operate.md)
- [evidence/decisions.md](evidence/decisions.md)
