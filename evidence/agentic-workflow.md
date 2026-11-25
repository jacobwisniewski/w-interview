# Agentic Workflow

## Tools

Built with T3 Code (Antigravity / Gemini), GitHub CLI, and local Node 24 / pnpm tooling.

## Delivery approach

Work was broken into small, focused pull requests using Conventional Commits against a protected `main` branch. Direct pushes to `main` are blocked, every PR must pass the GitHub Actions verification workflow, and merges use merge commits rather than squashing so the development progression stays visible.

The stack was ordered to mirror how a team would build it cleanly from scratch: toolchain and CI setup, public CDR sample data, strict linting rules, pure domain logic, Drizzle schema and migrations, snapshot loader, HTTP API, and finally the UI and documentation.

## Review interventions

- Picked a real non-AI banking domain (Australian CDR mortgage data) rather than a contrived LLM mockup, keeping the slice deterministic and credential-free.
- Replaced the initial npm/ESLint setup with pnpm, `oxlint`, and `oxfmt`, and added branch-protected CI early.
- Expanded sample data from a handful of banks to 41 real Australian banks via the CDR Register, including Westpac (catching along the way that Westpac's product list uses `x-v: 5` while product detail requires `x-v: 7`).
- Added custom `oxlint` rules banning comments, `let`/`var`, mutating array methods, and classes, and refactored the repository from a class into a factory function.
- Moved persistence to Drizzle ORM with versioned SQL migrations, colocated `__tests__` folders next to source files, switched tests to `GIVEN` / `WHEN` / `THEN` BDD specs with `it.each`, and dropped runtime live-sync HTTP calls to keep execution strictly offline.
- Re-stacked PRs into natural build order and folded all review feedback directly into the open PRs.

## Verification

Each PR ran typechecking, linting, formatting, tests, and build locally and in CI. All 41 real bank snapshots are exercised directly by the automated test suite.
