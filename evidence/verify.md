# Verification

Run all checks locally with:

```bash
pnpm run verify
```

## Checks and results

- Typecheck (`tsc --noEmit` in strict mode): passed.
- Lint (`oxlint`, 100 rules including custom rules banning comments, `let`/`var`, array mutations, and classes): passed with 0 warnings and 0 errors.
- Format (`oxfmt --check`): passed.
- Tests (`vitest`, 8 colocated BDD files, 36 tests): passed (36/36), covering config validation, rate and fee parsing, disclosure guardrails, basis-point diffs, 41-bank CDR normalisation, quarantine, Drizzle migrations and transaction rollback, degraded-sync preservation, snapshot loading, and HTTP routes.
- Build (`tsc`): passed.
- Live smoke test: boots the compiled server on an ephemeral port with a temporary SQLite database and verifies `/health`, Westpac product queries, quarantine audit, rate changes endpoint, and degraded-mode handling. Passed.

## Local, PR, and pipeline split

- Local: `pnpm run verify` runs the full suite offline in a few seconds.
- PR gate (required on `main`): frozen lockfile install, typecheck, lint, format check, tests, and build.
- Production pipeline additions: dependency vulnerability scanning, SAST, container image build and scanning, staging deploy with snapshot replay, and progressive rollout gated on `/health`.

## Known gaps

- No Playwright browser E2E test for the UI; it relies on the tested JSON API contracts and was visually checked via screenshot.
- No concurrent-writer load test against SQLite (production would use PostgreSQL/Aurora for concurrent writes).
