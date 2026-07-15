# Phase 11 — Hardening & Deployment — Implementation Plan

Design: `docs/superpowers/specs/2026-07-14-phase-11-hardening-deployment-design.md`

## Goal and gate

Make the completed product production-ready through executable security, authorization,
critical-scenario, performance, accessibility, mobile, recovery, and deployment controls. The gate
is all 24 scenarios green, a signed evidence-backed security review, the full RLS matrix passing,
and every requested CI command green. No production resource or secret is created or changed.

## Global constraints

- Do not introduce a second inventory mutation path or edit ledger history.
- Keep the service-role key server-only and all real credentials outside Git and tool output.
- Keep cost/supplier price protected in both UI/server code and Postgres.
- Use `0036_phase11_hardening.sql` only for permissions, indexes, constraints, or query hardening.
- Prefer shared fixes and tests over route-specific redesigns or new product behavior.
- Preserve user changes and stage only Phase 11 files in each small commit.
- Leave Vercel project creation/linking, environment entry, Git connection, domains, access scopes,
  and production promotion to the repo owner.

## Task 1 — Baseline, design, and plan

- Confirm clean `main` at `e055c67`, create `codex/phase-11-hardening-deployment`, inspect the
  database catalog, tests, major routes, configuration, and operator docs.
- Consult current official Next.js, Vercel, and Supabase guidance for version-sensitive security,
  deployment, RLS, function privilege, and performance choices.
- Write the Phase 11 design and implementation plan, then commit them separately from code.

## Task 2 — Security and database hardening migration

- Add `0036_phase11_hardening.sql` to revoke `PUBLIC`/`anon` execution from all public functions and
  default privileges while retaining deliberate authenticated/service grants.
- Add the permission-gated batch costing RPC and only EXPLAIN-backed hot-path indexes.
- Add catalog-contract tests for every definer function's pinned search path and execution grants.
- Prove protected direct DML, append-only triggers, cost RPCs, and safe operational results.
- Commit the migration and focused integration evidence.

## Task 3 — Full RLS penetration suite

- Add a table-driven authorization contract for every public business table, all four app roles,
  anonymous, and all four SQL verbs.
- Assert RLS is enabled, catalog grants/policies match the contract, and real sessions match
  expected visibility.
- Add fixture-backed branch isolation including an attempted cross-branch read/write bypass.
- Prove authenticated direct DML cannot reach ledger, lifecycle, offline, POS, or append-only
  command/history tables.
- Commit the RLS suite independently.

## Task 4 — Complete 24-scenario automation

- Inventory every numbered scenario against exact unit/integration/e2e test names.
- Add missing historical-cost, recipe-deduction, lifecycle, step-up, or browser assertions where
  current coverage is indirect.
- Update `TESTING_STRATEGY.md` with a 24-row evidence matrix and clean-run command order.
- Commit scenario tests and their evidence mapping.

## Task 5 — Query and bundle performance

- Change the costing page to one batch RPC and branch-price updates to bounded bulk operations.
- Capture before/after query counts in focused tests.
- Run `EXPLAIN (ANALYZE, BUFFERS)` on ledger, balance, report, and dashboard hot paths after reset;
  keep only useful indexes and record plans.
- Build and record per-route/client bundle sizes and any regression from Phase 10.
- Commit query code/tests separately from the migration if practical.

## Task 6 — Accessibility and mobile

- Add shared skip-link/main-landmark, focus, touch-target, reduced-motion, and responsive-overflow
  fixes.
- Audit major page/component labels, dialogs, table semantics, status announcements, and keyboard
  order in light and dark modes.
- Add automated major-route accessibility plus desktop/Pixel 7 layout checks without blanket
  suppressions.
- Run the React best-practices review if multiple TSX components are changed.
- Commit shared UI fixes and browser audit coverage.

## Task 7 — Recovery drill and runbook

- Extend real-Postgres tests to execute soft-delete → restore, eligible purge, protected purge, and
  sanitized/idempotent backup metadata recording/status access as one Phase 11 drill.
- Expand `BACKUP_AND_RECOVERY.md` into a production operator runbook with preparation, scratch
  restore, verification, rollback/abort, RTO/RPO evidence, and incident recording.
- Keep destructive production restore commands human-approved and outside the application.
- Commit recovery tests and docs.

## Task 8 — Deployment configuration and environment contract

- Pin the audited Next.js/React production versions already resolved by the lockfile.
- Add security headers and framework-appropriate caching in `next.config.mjs`.
- Add minimal `vercel.json` with deterministic install/build settings and no custom Next output.
- Complete `.env.example` from source usage with safe placeholders and public/server/test notes.
- Rewrite `DEPLOYMENT.md` as a checked, step-by-step staging/production, migration, smoke, rollback,
  and operator handoff checklist for the future Zombeans project.
- Record non-obvious choices in `ASSUMPTIONS.md` and commit deployment readiness.

## Task 9 — Full verification and phase documentation

- Run `npm run format`, `format:check`, `lint`, `typecheck`, `test`, `build`, and `scan:bundle`.
- Run a clean `db:reset`, serial `test:integration`, deterministic `seed:dev`, and full
  desktop/mobile `test:e2e`.
- Fix failures and rerun affected gates, then rerun the complete gate set.
- Write `SECURITY_REVIEW.md` and `reports/PHASE_11.md`; mark Phase 11 complete; update assumptions,
  changelog, testing, deployment, and recovery docs with exact evidence and known limitations.
- Commit the final documentation/report independently.

## Task 10 — Review and draft PR

- Review `git diff main...HEAD`, commit scope, secret scans, and operator-boundary compliance.
- Push `codex/phase-11-hardening-deployment` to `origin`.
- Open a draft PR into `main` summarizing the hardening changes, migration, evidence, risks, and
  unchecked production-operator TODOs. Do not deploy or promote production.
