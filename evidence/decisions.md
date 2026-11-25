# Decisions

## ADR-001: Drizzle ORM and SQLite behind a repository boundary

Use Drizzle ORM, `better-sqlite3`, and `drizzle-kit` SQL migrations behind a plain repository interface implemented as a factory function.

This provides typed relational queries, versioned migrations, and real ACID transactions locally without requiring Docker, while in-memory databases keep tests fast. The trade-off is a native SQLite driver and single-node write concurrency; isolating persistence behind the repository boundary makes swapping to Drizzle on managed PostgreSQL straightforward in cloud.

## ADR-002: Offline public CDR snapshots instead of runtime outbound HTTP

Bundle 41 real Australian banks' public CDR snapshots plus rate-change deltas for offline ingestion, and omit runtime outbound HTTP calls.

This keeps local runs and CI deterministic with zero credentials, zero SSRF surface, and no flakiness when external bank endpoints throttle or change versions, while still exercising real CDR payloads. In production, a separate scheduled worker would fetch upstream feeds into the same repository boundary.

## ADR-003: Explicit manual-review abstain and quarantine

Never drop malformed products silently and never mark incomplete mortgage disclosures as ready. Schema failures are quarantined, and products missing a comparison rate or with out-of-bounds/diverging rates are flagged for manual review with explicit reasons.

In Australian lending, showing a headline rate without a valid comparison rate is a compliance and trust risk. Keeping humans in the loop via an explicit abstain state is safer than guessing.

## ADR-004: Strict functional lint rules and a lightweight UI

Enforce no comments, no `let`/`var`, no mutating array methods, and no classes via custom `oxlint` rules alongside `oxfmt`, and serve a single-file HTML/JS UI rather than a separate frontend build pipeline.

This keeps lint, format, and test feedback under a second, nudges the codebase toward readable immutable functions, and avoids spending the timebox on frontend bundler setup. Authenticated CDR consent, non-mortgage products, RBAC, and runtime LLM inference were intentionally left out of scope.
