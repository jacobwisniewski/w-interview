# Intent

## Problem

Australian banks publish public Consumer Data Right (CDR) Product Reference Data endpoints for retail banking products. Turning those raw feeds into a reliable mortgage comparison view has a few practical pitfalls:

- Banks enforce different CDR endpoint versions (`x-v`), returning HTTP 406 on mismatches (for example, Westpac uses `x-v: 5` on its product list and `x-v: 7` on product detail).
- Lending rate payloads are deeply nested and inconsistent. Showing a headline interest rate without a valid comparison rate is risky under Australian lending disclosure norms.
- Partial ingestion failures or bad upstream records should never corrupt existing valid rates.

This slice ingests, validates, normalises, and compares `RESIDENTIAL_MORTGAGES` products across 41 Australian banks, tracks basis-point rate changes between snapshots, and isolates bad or incomplete data cleanly.

## Users

- Product analysts comparing market home loan rates, offset/redraw features, fees, and rate changes across banks.
- Engineers operating an auditable ingestion service with quarantine and degraded-state visibility.

## Assumptions and constraints

- Public and synthetic data only: 41 public Australian CDR bank snapshots (including Westpac's public CDR endpoint) plus one synthetic fixture (`example-bank.json`). Zero customer data, PII, API keys, or confidential data.
- Runs completely offline from a clean checkout with `pnpm install && pnpm run verify`.
- Non-advisory boundary: outputs are indicative market comparisons, never credit advice or lending decisions.

## Out of scope

- Authenticated CDR consumer data sharing (OAuth/mTLS/consent).
- Product categories outside `RESIDENTIAL_MORTGAGES`.
- Runtime outbound HTTP syncing, user auth/RBAC, or runtime LLM inference.

## Success criteria

- Clean checkout passes `pnpm run verify` offline with zero credentials.
- Normalises real CDR mortgage data across 41 banks inside atomic Drizzle/SQLite transactions.
- Proves three guarded failure paths with automated tests and smoke checks: malformed payload quarantine, `MANUAL_REVIEW_REQUIRED` abstain on missing/out-of-bounds comparison rates, and degraded-sync handling that preserves the last verified snapshot.
- Computes basis-point rate diffs between snapshots and serves them via API and a local web UI.
