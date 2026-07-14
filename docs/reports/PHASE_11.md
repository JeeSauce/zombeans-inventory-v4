# Phase 11 Report — Hardening & Deployment

Date: 2026-07-14 (Asia/Manila)
Branch: `codex/phase-11-hardening-deployment`
Base: `main` at `e055c67`

## Status

**Complete.**

The repository now contains the requested security, RLS, performance, accessibility/mobile,
recovery, deployment, environment, CI, and documentation hardening. All repository-controlled
release gates passed after a clean local database rebuild.

This phase did not create or link a Vercel project, change hosted Supabase settings, use real
secrets, or promote a preview/production deployment. Those remain checked operator actions in
`DEPLOYMENT.md`.

## Completed work

### Security and RLS

- Added hardening migration `0036_phase11_hardening.sql`.
- Removed ambient `PUBLIC`/anonymous function execution and pinned safe future defaults.
- Bound permission, Super Admin, and branch probes to the JWT actor.
- Replaced incomplete stock, ledger, and production policies with branch-aware policies.
- Made unassigned Production/Inventory users fail closed while preserving Super Admin and the
  documented MVP Branch Manager scope.
- Protected browser reference generators and removed authenticated access to internal generators.
- Added a complete public-business-table × role × SELECT/INSERT/UPDATE/DELETE contract, real DML
  denial, anonymous denial, and two-branch bypass tests.
- Audited and classified all 103 `SECURITY DEFINER` functions in `SECURITY_REVIEW.md`.

### Performance

- Replaced one costing RPC per active recipe with one protected batch RPC, capped at 500 entries
  with individual malformed-result isolation.
- Replaced per-branch price reads/writes with one validated atomic RPC.
- Added six EXPLAIN-backed balance, ledger, production, recount, dashboard, and report indexes.
- The production build reports 102 kB shared first-load JavaScript; the largest route is 189 kB
  and middleware is 104 kB.

### Accessibility and mobile

- Added skip navigation, a focusable main target, visible focus, reduced-motion behavior,
  accessible light/dark color tokens, and 44 px coarse-pointer controls.
- Added WCAG A/AA axe audits for operational/admin surfaces in both themes, keyboard focus,
  Pixel 7 horizontal overflow and touch targets, and reduced-motion behavior.

### Recovery

- Added `npm run test:recovery` for stable restore/purge/backup-metadata invariants.
- Expanded `BACKUP_AND_RECOVERY.md` with an isolated quarterly encrypted-export scratch-restore
  procedure, ledger/audit manifest checks, RTO/RPO evidence, and explicit non-production targeting.

### Deployment readiness

- Pinned Node 24, Next 15.5.20, React 19.2.7, Supabase SSR 0.5.2, Supabase JS 2.110.2, and the
  matching Next ESLint config.
- Added minimal `vercel.json`; native Next.js output remains framework-owned.
- Added CSP, HSTS, frame/type/referrer/permissions headers and explicit PWA shell cache behavior.
- Added production-safe server-only Resend delivery; production console delivery fails closed.
- Rebuilt `.env.example` with safe placeholders, descriptions, and runtime/test scope warnings.
- Rewrote `DEPLOYMENT.md` with the Zombeans team ID, no-project status, environment matrix,
  migrations `0001`–`0036`+, seed/bootstrap/branch assignment, smoke, monitoring, and rollback.
- Expanded CI with local Supabase integration/RLS and Chromium/Pixel 7 E2E jobs.

## Primary files and migration

- `supabase/migrations/0036_phase11_hardening.sql`
- `tests/integration/hardening.test.ts`
- `tests/integration/rls-penetration.test.ts`
- `tests/e2e/accessibility.spec.ts`
- `tests/unit/deployment-config.test.ts`
- `tests/unit/email.test.ts`
- `docs/reports/SECURITY_REVIEW.md`
- `docs/reports/PHASE_11.md`
- `vercel.json`

Migration `0036` is hardening-only: function grants/identity checks, RLS tightening, two bounded
batch RPCs, and indexes. It adds no business entity or workflow.

## Verification evidence

| Gate                                      | Result | Evidence                                                                                            |
| ----------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| `npm run format`                          | Pass   | Final formatter run completed.                                                                      |
| `npm run format:check`                    | Pass   | All matched files use Prettier style.                                                               |
| `npm run lint`                            | Pass   | ESLint completed without findings.                                                                  |
| `npm run typecheck`                       | Pass   | Strict `tsc --noEmit` completed.                                                                    |
| `npm run test`                            | Pass   | 13 files, 77 unit tests.                                                                            |
| `npm run build`                           | Pass   | Next 15.5.20 production build; 33 static-generation entries.                                        |
| `npm run scan:bundle`                     | Pass   | Service-role marker absent from 115 client bundle files.                                            |
| Clean `db:reset` + `test:integration`     | Pass   | Migrations through `0036`; 12 files, 99 real-Postgres tests.                                        |
| `npm run test:recovery`                   | Pass   | 5 targeted checks passed; 2 unrelated cases intentionally skipped by the focused command.           |
| `npm run seed:dev`                        | Pass   | Local accounts and explicit operational branch assignments created.                                 |
| `npm run test:e2e`                        | Pass   | Production build/start; Chromium and Pixel 7; 84 passed and 8 intentional project skips (92 total). |
| `npm audit --omit=dev --audit-level=high` | Pass   | Zero high/critical production findings; two moderate nested PostCSS findings recorded below.        |

## Critical scenarios

All 24 critical scenarios have explicit automated coverage mapped in `TESTING_STRATEGY.md`, and
all passed in the final real-Postgres/unit/browser sequence. This includes atomic inventory and
ledger behavior, branch and cost isolation, recount/closure controls, lifecycle/recovery behavior,
offline conflict handling, POS preview/confirm invariants, and authentication protection.

## Security considerations and known limitations

- `npm audit --omit=dev` reports two moderate findings for PostCSS below 8.5.10 nested inside
  Next 15.5.20. There are no high/critical production findings. The dependency is used by Next at
  build time; the Next maintainers state the advisory does not affect Next.js users and do not
  plan a 15.x backport. Forcing npm's suggested Next downgrade or overriding a framework-private
  dependency was rejected as higher risk; upgrade when a supported Next release carries the fix.
- CSP still permits inline script/style required by the current Next/component stack. A nonce-based
  CSP is a separately designed hardening project.
- SMTP remains intentionally unsupported; production must select Resend and verify its domain.
- Production/Inventory branch assignment is fail-closed and requires an operator-reviewed
  database/admin procedure after account creation.
- Hosted Auth, RLS bypass roles, access controls, domains, environment scopes, and backup/PITR
  settings were not changed or inspected because they are operator-owned.
- The automated recovery drill passed, but a real encrypted export scratch restore remains an
  operator-owned deployment prerequisite.

References: [GitHub advisory GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)
and [Next.js issue #93234](https://github.com/vercel/next.js/issues/93234).

## Commits

- `bb09f23` — `docs: plan Phase 11 hardening`
- `8fcf6e2` — `fix(security): harden database execution paths`
- `2af21a2` — `test(security): enforce complete RLS matrix`
- `f89d77d` — `perf: batch costing and branch price writes`
- `b92630e` — `chore: clear hardening lint blockers`
- `ad402fa` — `test(a11y): harden keyboard and mobile access`
- `9d709f2` — `fix(security): fail closed on unassigned branches`
- `82c150d` — `fix(email): add production Resend transport`
- `263bf1f` — `fix(a11y): close dark contrast and browser gaps`
- `30446af` — `chore(deploy): pin runtime and harden CI`

## Exact next phase

An authorized operator provisions isolated staging and production Supabase/Vercel resources,
performs the first real encrypted scratch restore, applies migrations, bootstraps users and branch
assignments, rehearses the release on staging, and promotes only after the checklist in
`DEPLOYMENT.md` is satisfied. This is deployment operation, not another repository feature phase.
