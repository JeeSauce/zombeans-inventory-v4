# Phase 5 — Production — End-of-Phase Report

Date: 2026-07-13  
Branch: `codex/phase-5-production`

## Completed work

- Added reusable production templates over active Phase 4 production recipes.
- Added immutable, human-referenced production orders with frozen active recipe version,
  activation cost snapshot, planned normalized input copy, planned output, and stable idempotency
  key.
- Added the draft → in-progress → awaiting-confirmation → completed/cancelled lifecycle with
  database transition guards, terminal immutability, and role-specific Server Actions.
- Added atomic actual recording for input consumption, waste, output quantity, output batch,
  production date, expiration, and notes.
- Added a single `SECURITY DEFINER` completion function that locks the order; allocates eligible
  lots FEFO; refuses expired/quarantined/insufficient inventory; writes consumption, waste, and
  output ledger movements; updates lots/balances; creates the output lot; and completes the order
  in one transaction.
- Added stable replay behavior returning the existing output transaction without a second stock
  movement.
- Production output refreshes the output item's weighted-average projection from the frozen
  snapshot/actual-yield lot cost, preserving the Phase 3 downstream valuation source.
- Added production list/create/detail UI, yield/usage/waste warnings, loading/empty/success/error
  states, Phase 5 navigation, and permission-gated controls without cost rendering.

## Files and migrations

- Migrations: `0016_production_schema.sql`, `0017_production_rls.sql`,
  `0018_production_functions.sql`, and `0019_production_recording.sql`.
- Server/app: `app/(app)/production/`.
- Components: `components/production/` and production navigation in `components/app/`.
- Libraries: `lib/production/planning.ts`, `lib/production/status.ts`, and
  `lib/validation/production.ts`.
- Tests: `tests/unit/production-planning.test.ts`, `tests/integration/production.test.ts`, and
  `tests/e2e/production.spec.ts`.
- Design/plan: `docs/superpowers/specs/2026-07-13-phase-5-production-design.md` and
  `docs/superpowers/plans/2026-07-13-phase-5-production.md`.

## Gate coverage

- **Critical scenario 2 — expired inventory:** eligible lots are locked and consumed by earliest
  expiration (nulls last). Expired/quarantined lots stay untouched. When eligible stock is short,
  completion raises `Insufficient unexpired available stock` and posts nothing.
- **Critical scenario 3 — atomicity:** a two-input fixture with a later shortage proves that prior
  lot/balance work, all transaction headers/lines, the output lot/balance, and order completion
  roll back together.
- **Critical scenario 4 — idempotency:** the second completion call returns the first output
  transaction ID; input/output quantities and ledger header/line counts remain identical.
- Additional coverage includes RLS visibility, in-function permission denial, FEFO ordering,
  waste posting, cost-free production UI, staff/manager/inventory routing, and desktop/mobile
  controls.

## Security posture

- Browser and ordinary authenticated table access cannot insert/update lots, balances, or ledger
  rows. Completion stock writes exist only inside `post_production_completion()`.
- Production definer functions fix `search_path=public` and check `auth.uid()` plus the required
  granular permission internally.
- Production Staff cannot confirm; Branch Manager can confirm but cannot create/record; Inventory
  Staff cannot read production data. RLS remains the database backstop.
- `cost_snapshot_id` and every cost value are omitted from authenticated production-order column
  grants and UI queries. Existing lot/ledger cost-column revokes remain effective.
- Completed/cancelled orders and submitted actuals are immutable. Corrections require future
  compensating entries rather than ledger edits.

## Verification

- Clean local database rebuild applies migrations 0001–0019 and the development seed creates all
  four expected role accounts.
- Vitest: 80/80 unit and real-database integration tests pass.
- Strict TypeScript, ESLint, Prettier check, production build, and client bundle secret scan pass.
- Playwright: 33 full-suite assertions pass on Chromium and Pixel 7 projects, with 5 intentional
  mobile skips for desktop-sidebar-only checks.
- Bundle scan confirms the local service-role key is absent from all 76 generated client bundle
  files.

## Known limitations / deferred

- Phase 5 posts only at Main. Multi-branch requests/transfers and negative-stock alerts arrive in
  Phase 6.
- Ordinary yield/usage/waste variance is warning-only and always requires manager confirmation.
  Configurable exceptional-variance thresholds and `production.approve_variance` escalation remain
  a future hardening item.
- Corrections/reversals have no Phase 5 UI; the ledger model requires future compensating entries.
- Template edit/deactivate and order search/filter controls are not yet exposed, although schema,
  RLS, and soft-delete fields support later expansion.
- Output QR/barcode printing is deferred; the human batch/lot number is captured and searchable.

## Next phase

Phase 6 — Multi-branch Stock: stock requests, preparation/approval, transfers, idempotent receiving,
discrepancies, branch-held prepared inventory, and visible negative-stock Critical alerts.
