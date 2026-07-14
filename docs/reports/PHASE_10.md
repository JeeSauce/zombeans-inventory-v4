# Phase 10 — Offline & POS Preparation — End-of-Phase Report

Date: 2026-07-14

Branch: `codex/phase-10-offline-pos`

## Completed work

- Added offline-capable recount and production device drafts backed by IndexedDB, stable retry
  keys, server-issued snapshot receipts, visible queue states, and reasoned conflict review.
- Added read-only camera/manual barcode lookup with safe operational item details and no cost or
  quantity mutation control.
- Added Loyverse item/variant/modifier mapping and bounded UTF-8 CSV preview/confirmation. Preview
  persists staging data only; confirmation creates one atomic, idempotent ledger transaction per
  valid external line. Live POS sync is deliberately absent.
- Added responsive `/offline-pos` UI, navigation, loading/error/empty states, confirmation dialogs,
  static-only service-worker caching, and a truthful offline fallback.
- Updated authoritative phase, schema, roles, business-rule, UI, testing, diagram, assumption, and
  changelog documentation.

## Files and migrations

- Schema/security/functions: `0033_phase10_schema.sql`, `0034_phase10_rls.sql`, and
  `0035_phase10_functions.sql`.
- Server/domain: `app/(app)/offline-pos/actions.ts`, `lib/validation/phase10.ts`,
  `lib/offline/draft-store.ts`, and `lib/pos/csv.ts`.
- UI/PWA: `app/(app)/offline-pos/`, `components/offline-pos/`, navigation updates, `public/sw.js`,
  and `public/offline.html`.
- Tests: `tests/unit/phase10.test.ts`, `tests/integration/phase10.test.ts`, and
  `tests/e2e/phase10.spec.ts`.
- Design/plan: `docs/superpowers/specs/2026-07-14-phase-10-offline-pos-design.md` and
  `docs/superpowers/plans/2026-07-14-phase-10-offline-pos.md`.

## Gate coverage

- **Scenario 17 — duplicate offline sync:** the first recount creates exactly one submission,
  recount result, ledger transaction/line, and balance update. The same key returns the original
  result and every measured count remains identical.
- **Scenario 18 — conflicting recounts:** two snapshots cover the same branch/date/item. After the
  first posts, the second becomes `review_required` with no second ledger or balance effect, then a
  permitted reviewer records an explicit reasoned rejection.
- **Scenario 24 — preview before confirmation:** preview produces exact zero change to transactions,
  lines, balance, and lots. Confirmation adds one transaction/line and the expected quantity
  change; replay leaves all counts unchanged.
- Additional real-Postgres checks prove snapshot ownership/scope, direct submission DML denial,
  `pos.import` denial for Inventory Staff, hidden POS staging, and cost-free barcode lookup.

## Security posture

- Client timestamps do not establish freshness. `issue_offline_snapshot()` creates immutable
  actor/branch/scope receipts and a frozen ledger watermark; submit functions reject forged,
  cross-actor, mismatched, or already-consumed scope.
- All inventory-affecting work remains inside atomic `SECURITY DEFINER` PostgreSQL functions. The
  browser and service worker never write balances, lots, transactions, or transaction lines.
- Recount sync reuses Phase 7 controls. Production sync records actuals only and cannot bypass
  confirmation/variance approval. POS confirmation locks staging rows, applies FEFO/negative-alert
  rules, appends the ledger, and records one posting identity per external line.
- RLS is enabled on every Phase 10 table; authenticated direct DML is absent. Operational grants
  omit cost/value fields, service-role code remains server-only, and safe errors/raw-UUID-free UI
  preserve the existing information boundaries.
- No Loyverse credential, API client, webhook, polling loop, or background sync exists.

## Verification

- A clean local database rebuild applies migrations 0001–0035 and the development seed recreates
  all four role accounts.
- Prettier, ESLint, strict TypeScript, and the production build pass. `/offline-pos` builds as a
  17.1 kB route, and the configured service-role value is absent from all 115 client-bundle files.
- Vitest passes 70/70 unit tests and 73/73 real-database integration tests (143 total).
- Focused Phase 10 Playwright passes 4 desktop/mobile scenarios with 2 intentional
  project-specific skips.
- The complete serial Playwright matrix passes 73 tests across Chromium and Pixel 7, with 7
  intentional project-specific skips (80 cases total).

## Known limitations / deferred

- A device must be online once to obtain a server-scoped snapshot before editing a draft offline.
  Browser storage remains device/profile-local; multi-device draft roaming is not implemented.
- Camera scanning depends on browser permission and hardware; manual barcode entry is always
  available. No continuous scan/bulk scan mode is included.
- CSV is capped at 1 MiB/500 data rows and uses the documented seven-column contract. Large jobs,
  provider-specific exports, saved templates, and automatic mapping suggestions are deferred.
- Live Loyverse synchronization—including credentials, OAuth/API access, webhooks, polling,
  reversals across provider state, and hosted retry scheduling—requires a separate security and
  operations design and is not implied by the Phase 10 schema.
- Service-worker caching is deliberately static-only. Background Sync API mutation replay and
  offline login/session bootstrap are not implemented.

## Next phase

Phase 11 — Hardening & Deployment: security/RLS penetration review, performance, accessibility,
mobile and recovery testing, staging deployment, production checklist, and Vercel deployment.
