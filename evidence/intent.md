# Intent — AU Open Banking (CDR) Home Loan Rate & Change Monitor

## Problem Statement
Australian banks publish legally mandated, unauthenticated **Consumer Data Right (CDR) Product Reference Data (PRD)** endpoints exposing retail banking products, interest rates, fees, and features. Consuming these feeds reliably across banks requires solving real enterprise data-engineering challenges:
- **Version heterogeneity:** Banks enforce different `x-v` endpoint versions (for example, Bank Australia serves `x-v: 3`, Up serves `x-v: 6`, and Westpac serves list `x-v: 5` / detail `x-v: 7`, returning HTTP `406 UnsupportedVersion` on mismatches).
- **Schema and disclosure risk:** Mortgage payloads contain deeply nested, inconsistent rate structures. Displaying a headline interest rate without a valid comparison rate risks misleading comparisons under Australian lending disclosure norms.
- **Feed resilience:** Upstream bank APIs can time out or reject requests; a consumer service must never serve half-updated rates or lose its last verified view.

## Intended Users
- **Product Analysts / Lending Operations:** Comparing home loan headline/comparison rates, offset/redraw features, and fees across 41 Australian banks, and tracking basis-point rate changes between snapshots.
- **Platform Engineers:** Operating an auditable ingestion service with explicit quarantine, degraded-mode visibility, and deterministic CI verification.

## Assumptions & Constraints
- **Public & synthetic data only:** Uses public unauthenticated CDR PRD snapshots from 41 Australian banks (including Westpac's public CDR endpoint) plus one clearly-labelled synthetic edge-case fixture (`example-bank.json`). Zero customer data, PII, paid API keys, or confidential Westpac data.
- **Deterministic local run:** Default boot and `pnpm run verify` run 100% offline from bundled snapshots. Optional live sync is bounded by an allowlist and strict timeout.
- **3-hour timebox:** Scoped to `RESIDENTIAL_MORTGAGES`, built-in `node:sqlite`, Hono HTTP API, and a single-page HTML/JS comparison workbench.

## Out of Scope
- Authenticated CDR consumer data sharing (OAuth/mTLS/consent).
- Other CDR categories (credit cards, term deposits, business loans).
- Multi-region deployment, user authentication/RBAC, or runtime LLM inference.

## Success Criteria
1. Clean checkout passes `pnpm install && pnpm run verify` offline with zero credentials.
2. Normalises real CDR mortgage data across 41 banks inside atomic SQLite transactions.
3. Proves three guarded failure paths with automated tests and live smoke checks:
   - **Malformed payload quarantine** (`quarantined_products`)
   - **Compliance-safe abstain** (`MANUAL_REVIEW_REQUIRED`)
   - **Upstream degrade mode** (preserves last verified snapshot and marks `/health` as `degraded`)
4. Computes basis-point rate diffs across snapshots and exposes them via API and UI.
