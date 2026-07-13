# Phase 4 — Recipes & Product Costing — End-of-phase report

Date: 2026-07-13 · Branch: `codex/phase-4-recipes-costing`

## Completed work

- Added three recipe scopes: production outputs, product/variant sale deductions, and
  inventory-affecting modifier deductions. Target-specific unique indexes prevent duplicate live
  recipes.
- Added draft recipe versions and normalized base-unit lines. Exactly one version can be active;
  activated versions and their composition are immutable.
- Added recursive protected costing. Active production recipes cost nested prepared inputs; leaf
  inputs use Phase 3 weighted-average cost. Consumable packaging is included, reusable containers
  are zero-cost, and expected waste/yield adjust the batch and unit result.
- Added graph integrity at the database layer: depth limit, direct/indirect cycle rejection,
  output/target validation, base-unit validation, and sale/modifier restrictions that prevent raw
  or finished sellable inputs.
- Added atomic activation: lock and validate the draft, calculate cost, retire the previous active
  version, activate the draft, and write an immutable snapshot in one transaction.
- Added recipe list/detail UI, draft/version/line actions, activation confirmation, protected cost
  breakdown, and a Super-Admin-only branch costing dashboard with profit, margin, food-cost %, and
  markup.
- Added permission-aware navigation and loading, empty, warning, and error states.

## Files and migrations

- Migrations: `0013_recipe_schema.sql`, `0014_recipe_rls.sql`,
  `0015_recipe_functions.sql`.
- Server/app: `app/(app)/recipes/` and `app/(app)/costing/`.
- Components: `components/recipes/recipes-client.tsx`, `recipe-detail-client.tsx`, and
  `costing-dashboard.tsx`; recipe/costing navigation in `components/app/nav.ts`.
- Libraries: `lib/recipes/costing.ts`, `lib/validation/recipes.ts`.
- Tests: `tests/unit/recipe-costing.test.ts`, `tests/integration/recipes.test.ts`,
  `tests/e2e/recipes.spec.ts`.
- Design/plan: `docs/superpowers/specs/2026-07-13-phase-4-recipes-costing-design.md` and
  `docs/superpowers/plans/2026-07-13-phase-4-recipes-costing.md`.

## Gate and test coverage

- Critical scenario 1: branch manager, Production Staff, and Inventory Staff cannot calculate or
  read protected cost data. Direct snapshot-table reads are denied even to authenticated users;
  authorized access goes through permission-checking functions.
- Critical scenario 8: the activation snapshot remains at its historical unit cost after a source
  weighted-average change; live cost reflects the new value. Snapshot updates and activated-line
  edits are rejected.
- Phase 4 scenario 9: a sale recipe recursively consumes a prepared sub-product and packaging,
  never raw ingredients. Invalid raw/finished inputs are rejected by triggers.
- Additional coverage: yield/waste math, reusable containers, rounding, selling metrics, nested
  recipes, cycle rejection, recipe visibility, target validation, and authenticated page routing.
- Full verification: Prettier check, ESLint, strict TypeScript, and the 20-route production build
  pass; Vitest reports 71/71 passing across 9 files; Playwright reports 26 passing across Chromium
  and mobile with 4 intentional mobile skips for desktop-sidebar-only assertions; the bundle scan
  confirms the service-role key is absent from all 71 client bundle files.

## Security posture

- `cost_snapshots` has no authenticated table grant or RLS policy. Cost reads use only
  `calculate_recipe_cost()` / `recipe_cost_snapshot()`, which check `cost.read` internally.
- `_calculate_recipe_cost_internal()` is not executable by public/authenticated roles. Every
  definer function fixes `search_path=public`.
- Recipe mutations use session-bound server actions with `requirePermission()` and RLS; no Phase 4
  page or action imports the service-role client. Audit payloads record composition changes but no
  monetary cost values.
- Activated recipe content and snapshots are append-only/immutable. Cost changes produce a new
  version/snapshot rather than rewriting history.

## Known limitations / deferred

- Version numbers are allocated by reading the current maximum and then inserting. The database
  unique constraint prevents duplicates, but simultaneous creators can make one request fail and
  require a retry; a database allocator can replace this if concurrent recipe editing grows.
- The UI shows the current active cost and dashboard metrics, but not a browsable history of all
  prior activation snapshots. The history remains preserved in the database.
- Recipe metadata has create/read UI in this phase; rename, deactivate, restore, and clone-version
  controls are deferred. Composition changes are made by creating a new draft version.
- Production posting, actual yield/waste, FEFO input consumption, and stock deduction are outside
  this phase. Phase 5 will consume active production versions and immutable cost snapshots; Phase
  6/POS posting will consume sale/modifier deduction recipes.
- The dashboard calculates one protected RPC per active recipe. This is correct for the current
  catalog size; a set-based protected dashboard RPC can replace it if the recipe catalog becomes
  large.

## Next phase

Phase 5 — Production: templates and orders, planned/actual inputs and outputs, batch/expiry
capture, yield and waste handling, approvals, FEFO consumption, atomic ledger posting, and cost
snapshot attachment.
