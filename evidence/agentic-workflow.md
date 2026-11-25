# Agentic Workflow — How AI Coding Agents Were Directed & Verified

## Tools Used
- **T3 Code** running **Antigravity (Gemini)** as the primary implementation agent, paired with GitHub CLI (`gh`) and local Node 24 / `pnpm` verification.

## Work Decomposition (Stacked PRs & Conventional Commits)
Rather than generating a monolithic commit, work was decomposed into 5 focused, reviewable PRs using Conventional Commits and GitHub branch protection on `main` (requiring the `verify` CI check via PR, blocking direct pushes, preserving merge-commit history without squashing):

1. **PR #1 (`chore/pnpm-oxlint-oxfmt-ci`)**: `pnpm`, `oxlint`, `oxfmt`, GitHub Actions `verify` workflow, branch protection, and fail-fast `src/config.ts` + tests.
2. **PR #2 (`feat/cdr-sample-data`)**: Captured 41 real Australian banks' public CDR `RESIDENTIAL_MORTGAGES` snapshots (including Westpac) via the CDR Register + synthetic `v2` rate-change and edge-case fixtures.
3. **PR #3 (`feat/cdr-domain-and-sqlite`)**: Structured logger, CDR Zod schemas, normalisation + `MANUAL_REVIEW_REQUIRED` guardrails, transactional `node:sqlite` repository, rate diffing, and 12 unit/integration tests.
4. **PR #4 (`feat/cdr-client-and-api`)**: Allowlisted live CDR client with `x-v` negotiation + degrade mode, Hono HTTP API, CLI sync, and 5 integration/mocked-fetch tests.
5. **PR #5 (`feat/ui-verify-and-docs`)**: Single-page comparison UI, `./scripts/verify.sh` (including live server smoke test), `README.md`, and this evidence pack.

## Representative Steering & Human Interventions
- **Scope & non-AI choice:** Rejected generic "AI governance" mockups and steered toward a genuinely non-AI, deterministic problem using real public Australian Open Banking (CDR) data so nothing felt contrived.
- **Toolchain replacement:** Explicitly directed switching from `npm` + `eslint` to `pnpm` + `oxlint` + `oxfmt` for faster, modern JS/TS linting and formatting.
- **CI & PR review discipline:** Requested incremental PRs with Conventional Commits, a GitHub Actions PR verification gate, and `main` branch protection blocking direct pushes.
- **Data realism:** Requested separating sample data into its own PR, expanding from 3 banks to all reachable CDR banks (40+ brands), and explicitly including Westpac's public CDR endpoint.
- **Real-world CDR bug caught during capture:** Initial live capture missed Westpac's product details because Westpac's list endpoint uses `x-v: 5` while its detail endpoint requires `x-v: 7` (returning HTTP `406` on `3–6`). Probing the `406` response revealed `Versions available: 7`, which directly informed the `x-v` negotiation range (`7 -> 3`) in `src/cdr/live-client.ts`.
- **Deferred documentation:** Deliberately deferred `evidence/` until the final PR so every claim reflects verified code and actual decisions rather than speculative boilerplate.

## Review & Verification Approach
- Every PR was gated by both local checks (`typecheck`, `oxlint`, `oxfmt --check`, `vitest`, `tsc` build) and GitHub Actions `verify`.
- All 41 real bank JSON snapshots were exercised end-to-end by `__tests__/normalise.test.ts` and `__tests__/api.test.ts` to prove the Zod schemas handle real-world CDR quirks (nullable fields, missing descriptions, varied fee/rate structures) without false quarantines.
