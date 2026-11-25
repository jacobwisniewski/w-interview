# Architecture Decision Records (ADRs)

## ADR-001: Built-in `node:sqlite` Behind a `ProductRepository` Interface
- **Decision:** Use Node 22.5+/24's built-in `node:sqlite` (`DatabaseSync`) for local persistence behind `src/db/repository.ts`.
- **Why:** Guarantees clean-checkout reproducibility without requiring Docker or native C++ builds (`better-sqlite3`), while still providing real ACID transactions (`BEGIN IMMEDIATE ... COMMIT`), SQL filtering, and `:memory:` databases for fast isolated tests.
- **Trade-off:** Single-node writer lock; not suitable for multi-replica cloud deployments. Mitigated by isolating all SQL inside `SqliteProductRepository` so production swaps cleanly to managed PostgreSQL/Aurora.

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
