# Phase 4 — Recipes & Product Costing — Implementation Plan

Design: `docs/superpowers/specs/2026-07-13-phase-4-recipes-costing-design.md`

## Goal and gate

Deliver versioned multi-level recipes, variant/modifier deductions, protected recursive costing,
immutable snapshots, and a Super-Admin costing dashboard. Critical scenarios 1 and 8 must pass;
the Phase 4 data-model portion of scenario 9 is enforced at the database layer.

## Global constraints

- Preserve all Phase 1–3 behavior and the append-only ledger.
- All recipe quantities and outputs are normalized base-unit quantities.
- Cost-bearing columns remain unavailable through ordinary authenticated table reads.
- `SECURITY DEFINER` functions must set `search_path=public`, check permissions internally, and
  expose the smallest possible result.
- Activated recipe versions, their lines, and cost snapshots are immutable.
- Server Actions call `requirePermission`; RLS remains the backstop.
- Record unspecified decisions in `docs/ASSUMPTIONS.md`.

## Task 1 — Baseline and test map

- Verify clean branch, local Supabase migrations 0001–0012, current Vitest suite, and production
  build.
- Map critical scenarios 1, 8, and 9 to concrete Phase 4 tests.

## Task 2 — Recipe schema (`0013_recipe_schema.sql`)

- Add `recipe_kind` and `cost_snapshot_reason` enums.
- Create `recipes`, `recipe_versions`, `recipe_lines`, and `cost_snapshots`.
- Add constraints, target-specific partial unique indexes, one-active-version index, timestamps,
  version triggers, and sensitive-column comments.
- Add an append-only trigger for `cost_snapshots` and immutability guards for activated versions.
- Apply the migration and smoke-check the schema.

## Task 3 — Recipe RLS and grants (`0014_recipe_rls.sql`)

- Grant only non-sensitive recipe composition columns to authenticated users.
- Add `recipe.read` select and `recipe.write` draft-mutation policies.
- Keep `cost_snapshots` service-role-only.
- Grant service role full access.
- Add RLS integration tests for recipe readers/writers and direct cost denial.

## Task 4 — Costing library and unit tests

- Create `lib/recipes/costing.ts` with pure planned-cost and margin helpers.
- Cover yield, waste, packaging, reusable containers, rounding, food-cost percentage, margin,
  markup, and zero-price/output guards.

## Task 5 — Cost/activation functions (`0015_recipe_functions.sql`)

- Add graph validation and sale-input type checks.
- Add recursive internal cost calculation with cycle/depth protection.
- Add `calculate_recipe_cost`, `activate_recipe_version`, and snapshot reader functions with
  in-function permission checks.
- Restrict execute grants explicitly.

## Task 6 — Critical integration tests

- Scenario 1: manager/production/inventory cannot read or calculate protected costs; Super Admin
  can.
- Multi-level cost: raw weighted-average → sub-product → sale recipe.
- Cycle rejection and one-active-version behavior.
- Non-consumable-container exclusion and packaging inclusion.
- Scenario 8: activation snapshot remains unchanged after input weighted-average changes and a
  fresh calculation reflects the new cost.
- Scenario 9 model gate: sale recipes cannot directly consume raw ingredients.

## Task 7 — Validation and server actions

- Add `lib/validation/recipes.ts` schemas.
- Add recipe create, draft-version create, line add/remove, and activate actions.
- Use session client for non-sensitive draft composition; call protected RPCs for activation/cost.
- Audit create/version/line/activation events without cost values in audit payloads.

## Task 8 — Recipe list and detail UI

- Add `/recipes` and `/recipes/[id]` Server Components with `recipe.read` gating.
- Add client components for recipe creation, version creation, normalized lines, activation, and
  complete loading/empty/success/warning/error states.
- Render no cost labels or values for users lacking `cost.read`.

## Task 9 — Costing dashboard

- Add `/costing`, gated by `cost.read` at page, server, and DB layers.
- Show active-recipe cost breakdown and selling-price metrics by branch.
- Add responsive tables/cards and no-data/error states; never auto-write selling prices.

## Task 10 — Navigation and E2E

- Add Recipes navigation for `recipe.read` and Costing for `cost.read`.
- E2E: Production Staff can read recipes but sees no cost; Inventory Staff is redirected; Super
  Admin can reach costing and recipe mutation controls.

## Task 11 — Documentation and full verification

- Update `docs/ASSUMPTIONS.md`, `docs/CHANGELOG.md`, database/ERD notes as needed, and create
  `docs/reports/PHASE_4.md`.
- Run format, format check, lint, typecheck, Vitest, build, bundle scan, integration tests, and
  Playwright.
- Perform a final security/cost-correctness review and resolve all blocking findings before PR.
