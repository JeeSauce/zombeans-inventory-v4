# Phase 6 — Multi-branch Stock — End-of-Phase Report

Date: 2026-07-13  
Branch: `codex/phase-6-multi-branch-stock`

## Completed work

- Added direct stock-in and stock-out, including batch/lot and expiration capture, four-decimal
  base-unit quantities, stable replay keys, and signed append-only ledger entries.
- Implemented the Business Rules' allow-with-alert negative policy: eligible lots stop at zero,
  uncovered stock-out remains a lot-less negative ledger line, the exact balance remains negative,
  and an active Critical alert records the cause in the same transaction.
- Added stock requests with human references, requesting branch, line quantities, manager review,
  approved quantities, and request-to-transfer fulfilment.
- Added transfer preparation, manager approval/dispatch, in-transit state, destination receiving,
  and received state with database status guards under row locks.
- Source dispatch consumes available/unexpired lots FEFO. Per-lot allocations freeze cost and
  expiry; destination lots and ledger lines preserve them exactly.
- Receiving requires complete shipped-quantity accounting and creates reasoned open discrepancy
  rows for rejected, damaged, or missing quantity. Managers can record resolution without editing
  posted ledger history.
- Added stock overview, negative-balance/Critical-alert display, direct movement forms, request
  review, transfer lifecycle/detail, receiving, discrepancy resolution, responsive navigation,
  and loading/empty/success/warning/error states without UUID or cost rendering.

## Files and migrations

- Migrations: `0020_phase6_stock_schema.sql`, `0021_phase6_stock_rls.sql`, and
  `0022_phase6_stock_functions.sql`.
- Server/app: `app/(app)/stock/`.
- Components: `components/stock/` and Stock navigation in `components/app/`.
- Libraries: `lib/stock/quantities.ts` and `lib/validation/stock.ts`.
- Tests: `tests/unit/stock-quantities.test.ts`, `tests/integration/stock.test.ts`, the retained
  scenario 9 test in `tests/integration/recipes.test.ts`, and `tests/e2e/stock.spec.ts`.
- Design/plan: `docs/superpowers/specs/2026-07-13-phase-6-multi-branch-stock-design.md` and
  `docs/superpowers/plans/2026-07-13-phase-6-multi-branch-stock.md`.

## Gate coverage

- **Critical scenario 5 — duplicate receiving:** the integration fixture calls receiving twice
  with the same stable key. Both calls return the same destination transaction; destination
  balance, destination lot count, ledger-line count, and discrepancy count are identical after the
  replay.
- **Critical scenario 9 — prepared sale inputs:** the Phase 4 database trigger integration test
  still rejects raw and finished sellable inputs on sale recipes. Phase 6 stock-out accepts an item
  and explicit operational cause only; it never accepts or posts a sale recipe. POS deduction stays
  Phase 10.
- **Critical scenario 10 — negative visible + Critical:** a valid five-unit stock-out against two
  eligible units writes a full `-5` ledger movement, leaves `qty_on_hand = -3`, creates one active
  Critical alert at `-3`, reads it through an Inventory Staff session, and renders the negative
  quantity/Critical badge in Playwright.
- Additional coverage includes direct batch stock-in idempotency, request approval, transfer status
  and permission denial, FEFO across multiple lots, expired-lot exclusion, source/destination
  correlation, lot-cost preservation, discrepancy capture, authenticated write denial, and cost
  column denial.

## Security posture

- Every Phase 6 inventory mutation is a `SECURITY DEFINER` function with
  `set search_path=public`, a real `auth.uid()` permission check, stable idempotency, row/advisory
  locking, and one all-or-nothing database transaction.
- The browser never inserts/updates lots, balances, ledger, allocations, or alerts. Server Actions
  use the session client and repeat `requirePermission`; RLS and missing authenticated write grants
  remain the database backstop.
- Branch access honors `user_branch_assignments` when present; absent assignments retain the
  existing MVP global-manager/global-operator behavior.
- `transfer_lot_allocations.unit_cost_snapshot`, lot costs, item averages, and ledger cost snapshots
  are omitted from authenticated grants and every Phase 6 UI query/render.
- Raw ingredients are rejected outside a branch configured to hold them. Transfers require real
  eligible lots and cannot create phantom/negative destination stock.
- Posted ledger rows are never edited; discrepancy resolution adds operational context only.

## Verification

- A clean local rebuild applies migrations 0001–0022; the development seed prints all four expected
  role accounts.
- Vitest: 42/42 unit and 47/47 real-database integration tests pass (89 total).
- Production build succeeds with all 25 application routes, including four `/stock` routes.
- Focused Phase 6 Playwright: 4/4 Chromium and 4/4 Pixel 7 assertions pass.
- Prettier write/check, ESLint, strict TypeScript, unit tests, production build, bundle scan,
  integration tests, and the full Playwright suite all pass.
- Bundle scan confirms the local service-role key is absent from all 82 generated client files.
- Full Playwright: 41 assertions pass across Chromium and Pixel 7, with 5 intentional mobile skips
  for legacy desktop-sidebar-only checks.

## Known limitations / deferred

- Email delivery for negative-inventory alerts is deferred to Phase 8 notification infrastructure;
  Phase 6 provides the durable Critical row and immediate prominent in-app surface required by the
  gate.
- Recount-based reconciliation, compensating variance adjustments, and day close are Phase 7.
- Direct stock-in uses the protected current item average because ordinary stock operators do not
  enter cost. Cost corrections require a future approved compensating workflow.
- Transfer discrepancy resolution records investigation text but does not post a correction; any
  stock correction must be a later compensating/recount transaction.
- Popup-event linkage/returns and event inventory summaries remain Phase 8. POS sale deduction and
  offline replay remain Phase 10.
- Phase 6 forms post one direct line at a time; request-linked transfers can carry every approved
  line. The database RPCs and validation support multi-line operations for later batch UX.

## Next phase

Phase 7 — Recounts & Daily Operations: start/end-of-day recounts, cycle counts, variance
classification and compensating adjustments, day closing, and Super Admin reasoned reopening.
