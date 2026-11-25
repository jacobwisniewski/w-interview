# Architecture Decision Records (ADRs)

## ADR-001: Drizzle ORM + `better-sqlite3` + Versioned SQL Migrations Behind `ProductRepository`
- **Decision:** Use **Drizzle ORM** (`src/db/schema.ts`), `better-sqlite3`, and `drizzle-kit` versioned SQL migrations (`drizzle/`) behind the `ProductRepository` interface (`src/db/repository.ts`).
- **Why:** Provides strongly-typed relational queries, repeatable versioned SQL migrations, and real ACID transactions (`db.transaction()`) locally without requiring Docker, while keeping tests fast via `:memory:` databases.
- **Trade-off:** Adds a native SQLite driver (`better-sqlite3`, configured in `pnpm.onlyBuiltDependencies`), and SQLite is single-node. Mitigated by isolating all Drizzle/SQLite code behind `ProductRepository` so cloud deployment swaps cleanly to Drizzle + managed PostgreSQL/Aurora.

## ADR-002: Bundled Public CDR Snapshots as Default + Allowlisted Optional Live Sync
- **Decision:** Bundle 41 real Australian banks' public CDR snapshots (`sample-data/snapshots/v1/`) for default boot and CI, with optional live sync constrained to `sample-data/manifest.json`.
- **Why:** Satisfies zero-credential, offline deterministic verification while exercising real Australian Open Banking schemas (including Westpac's `x-v: 7` detail endpoint) and eliminating SSRF risk from arbitrary URLs.
- **Trade-off:** Bundled snapshots become stale over time; mitigated by exposing `lastSyncedAt` in `/health` and supporting `pnpm run sync:live`.

## ADR-003: Compliance-Safe `MANUAL_REVIEW_REQUIRED` Abstain + Malformed Quarantine
- **Decision:** Never drop malformed products silently and never display unverified/incomplete headline rates as `READY`. Quarantine schema failures into `quarantined_products` and flag products missing `comparisonRate` or with out-of-bounds/suspicious spreads as `MANUAL_REVIEW_REQUIRED`.
- **Why:** In regulated Australian lending, silent partial ingestion or displaying a headline rate without a comparison rate is a compliance/trust failure. Explicit abstain + auditability keeps humans in control.

## ADR-004: Lean Toolchain (`pnpm`, `oxlint`, `oxfmt`, Vanilla HTML UI) & Intentional Non-Goals
- **Decision:** Use `pnpm` + `oxlint` + `oxfmt` + Hono + Zod + a single-file HTML/JS UI rather than a heavy multi-package monorepo or runtime LLM layer.
- **Why:** Fits the 3-hour timebox with sub-second lint/format/test feedback and minimal supply-chain surface (only 3 runtime dependencies: `hono`, `@hono/node-server`, `zod`).
- **Intentionally Not Built:** Authenticated CDR consumer consent (mTLS/OAuth), non-mortgage product categories, RBAC/auth, and runtime AI/LLM inference (per brief, product AI is optional and would add key/non-determinism overhead).
