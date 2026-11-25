# Verification — Checks, Results, and CI Split

## Single Verification Command
```bash
pnpm run verify   # executes scripts/verify.sh
```

## Checks Run & Results
| Check | Tool | Scope | Result |
|---|---|---|---|
| Type safety | `tsc --noEmit` (`strict`, `noUncheckedIndexedAccess`) | `src/**/*.ts` | Pass |
| Static analysis | `oxlint src __tests__` (99 rules incl. `local/no-comments`, `local/no-let`, `local/no-array-mutation`) | `src/`, `__tests__/` | Pass (0 warnings, 0 errors) |
| Formatting | `oxfmt --check src __tests__` | `src/`, `__tests__/` | Pass |
| Unit & integration tests | `vitest run` (8 BDD files, 23 tests) | Config, parsing, guardrails, diff, 41-bank CDR normalise, Drizzle migrations/rollback, degraded sync, `x-v` 406 negotiation, SSRF allowlist, HTTP API | Pass (23/23) |
| Production build | `tsc -p tsconfig.json` | Emits `dist/` | Pass |
| End-to-end smoke test | `scripts/verify.sh` against compiled `dist/index.js` | Boots server on ephemeral port + temp SQLite DB, verifies `/health`, Westpac query, quarantine, `v2` rate diff (`+15 bps`), and `simulate-degrade` | Pass |

## Local vs PR vs Deployment Pipeline Split
- **Local pre-push:** `pnpm run verify` (fast full loop, < 5 seconds, 100% offline).
- **PR gate (implemented in `.github/workflows/ci.yml`, enforced on `main`):** `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `format:check`, `test`, `build`.
- **Enterprise CI/CD additions (not run in 3-hour slice):** Dependency vulnerability scan (`pnpm audit` / Snyk), SAST (CodeQL/Semgrep), container image build & Trivy scan, staging deploy + synthetic CDR replay soak, and canary `/health` gate before full production promotion.

## Known Gaps
- No headless browser E2E test (Playwright) for `public/index.html`; UI relies on the tested JSON API contracts.
- Live CDR network tests are mocked in CI (`__tests__/live-client.test.ts`) to keep builds deterministic; live endpoints are verified manually via `pnpm run sync:live`.
- No load/concurrency benchmark for high-write SQLite contention (in production, PostgreSQL/Aurora handles concurrent writers).
