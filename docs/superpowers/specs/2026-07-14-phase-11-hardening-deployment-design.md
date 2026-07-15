# Phase 11 — Hardening & Deployment — Design

## Goal and boundaries

Phase 11 closes production-readiness gaps without adding product features. It converts the
security, authorization, recovery, accessibility, mobile, performance, and deployment assumptions
from Phases 1–10 into executable gates and operator-facing evidence.

This branch may add tests, a hardening-only migration, targeted query/UI fixes, framework and
deployment configuration, and documentation. It must not create or link a Vercel project, use real
production credentials, change Supabase project-level settings, deploy or promote production,
configure domains, or seed production data. Preview deployment also remains optional and may use
only non-production placeholder values.

## Baseline findings

- `main` is clean at merged Phase 10 commit `e055c67`; Phase 11 uses
  `codex/phase-11-hardening-deployment`.
- All public business tables currently have RLS enabled, but the existing integration suite tests
  only a small subset of the full table/role/verb matrix.
- Every discovered `SECURITY DEFINER` function has a pinned `search_path`, but several older helper
  and sequence functions still inherit `PUBLIC` execute. A hardening migration will remove all
  anonymous/public function execution and preserve only explicit authenticated/service grants.
- The lockfile already resolves patched Next.js/React releases while `package.json` still declares
  broad, older minimum ranges. Production dependencies will be pinned to the audited resolved
  versions so a clean install cannot drift backward or unexpectedly across minors.
- The costing dashboard performs one costing RPC per active recipe and branch-price saving performs
  per-branch reads/writes. These are the clearest application-level N+1 paths.
- Hot ledger/report/dashboard queries have useful indexes, but combined branch/time and
  item/time access paths require EXPLAIN-backed review.
- `.env.example`, `DEPLOYMENT.md`, and `BACKUP_AND_RECOVERY.md` exist as early-phase outlines; they
  need complete Phase 11 operator instructions and evidence. `vercel.json` is absent.
- The shared shell has labelled icon controls and responsive navigation, but lacks a skip link,
  explicit main landmark target, and a global reduced-motion fallback. Automated major-route
  accessibility coverage is absent.

## Security review

### Definer-function contract

The review treats the live Postgres catalog as authoritative. An integration contract will enumerate
every `public` function with `prosecdef = true` and assert:

- a pinned `search_path` is present;
- no function is executable by `PUBLIC` or `anon`;
- trigger/internal helpers are not callable by browser roles;
- externally callable mutators are explicitly granted only to the required role and validate
  `auth.uid()`, the relevant permission/branch, idempotency, and a human reason where a decision or
  correction is made;
- read helpers that expose cost, supplier price, financial, backup, or lifecycle data re-check the
  corresponding permission inside the function.

The written review will classify every definer function as identity/RLS helper, internal trigger or
sequence helper, protected read, or mutating command. The classification supplies evidence without
pretending that read-only helpers need mutation-only reason/idempotency parameters.

### Service-role and sensitive-data boundaries

`lib/supabase/admin.ts` must retain `import "server-only"`; client modules must not import it; the
production build must pass `scan:bundle`. Environment documentation distinguishes public
Supabase identifiers from the server-only service key and step-up/email secrets.

Cost and supplier pricing are tested at both layers:

- UI/server routes render financial surfaces only for `cost.read` or supplier-price holders;
- direct authenticated table/RPC access is denied for Branch Manager, Production, and Inventory;
- safe operational RPC envelopes are scanned for cost/value fields;
- Super Admin receives the correct protected values.

Ledger, command, lifecycle, offline, notification-history, and POS-posting tables remain
append-only or command-only. Direct browser writes must fail even for Super Admin; corrections
continue through compensating RPCs.

## RLS penetration matrix

The Phase 11 integration suite will define one explicit expected authorization contract covering
every public business table, four application roles (`super_admin`, `branch_manager`, `production`,
`inventory`), `anon`, and `SELECT`/`INSERT`/`UPDATE`/`DELETE`.

Because application roles share PostgreSQL's `authenticated` role, the test combines three forms of
evidence:

1. catalog assertions for table grants, RLS enablement, and command policies;
2. real session queries using JWT claims for each application role;
3. fixture-backed branch-scope and protected-table probes that distinguish an allowed visible row
   from an RLS-hidden row and prove direct DML cannot reach ledger/lifecycle/offline/POS data.

Anonymous sessions must receive no business data and no write path. Branch-scoped roles receive
only assigned-branch rows; changing a row's branch or supplying an unassigned branch must not
bypass the policy.

## Critical-scenario gate

`docs/TESTING_STRATEGY.md` will map all 24 numbered scenarios to concrete automated test names and
commands. Missing or ambiguous coverage will be added, with real Postgres retained for inventory,
RLS, atomicity, idempotency, ledger, lifecycle, and recovery behavior. Scenario 23 remains the
post-build bundle scan. The phase is not complete until the full unit/integration/e2e gates pass
after a clean reset and deterministic development seed.

## Performance hardening

- Replace the costing page's per-recipe RPC fan-out with one permission-gated batch calculation
  using the existing recursive costing implementation.
- Replace branch-price per-row reads/writes with one read plus bounded bulk delete/upsert work while
  preserving independent branch prices and audit evidence.
- Add only indexes demonstrated by `EXPLAIN (ANALYZE, BUFFERS)` against seeded, non-production data.
  Candidate access paths are posted ledger by effective branch/time, ledger lines by item/transaction,
  balances by branch, and report/dashboard date/status filters.
- Record route/client bundle sizes from the production build and compare them with Phase 10's
  recorded `/offline-pos` size; no new production UI dependency is justified for the audit.

The batch costing RPC and indexes belong in `0036_phase11_hardening.sql`; it contains no new
business entity or workflow.

## Accessibility and mobile hardening

The audit covers login/auth, dashboard, catalog, purchasing, recipes/costing, production, stock,
daily ops, calendar/popups/notifications, reports, recycle bin/backups/admin, and offline/POS.

Shared fixes include a keyboard-visible skip link, an addressable main landmark, visible focus,
minimum touch targets for icon/menu controls, responsive overflow behavior, semantic tables/dialogs,
and `prefers-reduced-motion` fallbacks. Major-route Playwright checks run in Desktop Chrome and a
Pixel 7 viewport, verify headings/landmarks, horizontal overflow, tap targets, and keyboard focus,
and run automated WCAG checks. Any automated exception must be documented and manually justified;
there is no blanket rule suppression.

## Recovery drill

Real-Postgres recovery coverage exercises one continuous control story:

1. soft-delete a dependency-free record;
2. restore it before `purge_at` and verify exact business values;
3. delete an eligible dependency-free record and purge it;
4. prove a held/dependent/ledger-backed record is skipped;
5. record sanitized backup metadata as `service_role`, retrieve status as `backup.manage`, reject
   browser recording, and replay the stable run key safely.

`BACKUP_AND_RECOVERY.md` will separate this application-level drill from destructive database
restore execution. The operator runbook uses a scratch project, verifies target identity twice,
preserves the pre-restore state, runs smoke checks, records RTO/RPO evidence, and never places a
production database URL or backup artifact in the repository.

## Deployment readiness

- `next.config.mjs` supplies production-safe headers while retaining framework-managed caching for
  hashed assets and dynamic authenticated routes.
- A minimal `vercel.json` declares Next.js plus deterministic `npm ci`/`npm run build`; no custom
  output directory overrides Vercel's Next.js adapter.
- `.env.example` lists every source-referenced runtime/test variable, safe placeholders, exposure,
  scope, and purpose. No actual value is copied from a local or hosted environment.
- `DEPLOYMENT.md` gives the Zombeans operator a checked sequence for creating/linking the future
  project, staging and production Supabase projects, migrations 0001–0036+, environment scopes,
  reference-data-only seeding, preview/smoke gates, controlled production promotion, rollback, and
  recovery.

Creating the Vercel project, connecting Git, entering secrets, changing project security/access,
domains, and production promotion remain unchecked operator TODOs.

## Completion evidence

The end-of-phase report records commits, migration/index evidence, exact scenario/RLS/a11y/mobile/
recovery results, production build and bundle sizes, `scan:bundle`, all CI commands, limitations,
and the operator-only deployment TODOs. Only after the complete diff is clean and all local gates
pass may the branch be pushed and a draft PR opened into `main`.
