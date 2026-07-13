# Phase 4 — Recipes & Product Costing — Design Specification

Date: 2026-07-13
Branch: `codex/phase-4-recipes-costing`

## Goal

Add versioned, multi-level recipes and a Super-Admin-only costing workflow on top of the Phase 3
weighted-average inventory cost. The module must support production recipes, branch-sale recipes,
variant recipes, modifier deductions, consumable packaging, recursive cost calculation, and
immutable historical snapshots without exposing any cost-bearing data to unauthorized users.

## Scope

- Recipe definitions for produced inventory items, products, variants, and stock-affecting
  modifier options.
- Draft recipe versions with normalized base-unit lines and exactly one active version per recipe.
- Recursive costing through active production recipes; leaf inputs use
  `inventory_items.weighted_avg_cost`.
- Expected-waste and expected-yield adjustments, packaging/container rules, and cost breakdowns.
- Atomic version activation with cycle validation and an immutable activation-time cost snapshot.
- Recipe composition UI for `recipe.read`; mutations for `recipe.write`; all costs and margins for
  `cost.read` only.
- Super-Admin costing dashboard with current recipe cost, selling price, food-cost percentage,
  gross profit, gross margin, and markup.
- Critical scenarios 1 and 8, plus the Phase 4 portion of scenario 9.

Out of scope: production orders, actual-output costing, FEFO consumption, stock deduction, and POS
sale posting. Those arrive in Phases 5 and 6 and consume the recipe/snapshot interfaces defined
here.

## Domain model

### Recipe scope

`recipe_kind` distinguishes three graphs:

- `production`: converts raw/prepared inputs into an inventory output. It has no catalog target and
  is the only recipe kind recursively selected when an input item is itself produced.
- `sale`: defines the branch-held prepared components and packaging deducted for a product or
  variant. Exactly one of `product_id` or `variant_id` is present.
- `modifier`: defines the additional stock deduction for one stock-affecting modifier option.
  `modifier_option_id` is required.

Every recipe retains `output_item_id`. For sale/variant/modifier recipes this is the owning
product's inventory item. Partial unique indexes allow one production recipe per output item, one
sale recipe per product or variant, and one modifier recipe per modifier option.

### Tables

#### `recipes`

- `id`, `name`, `kind`, `output_item_id`
- optional target: `product_id`, `variant_id`, `modifier_option_id`
- `active`, audit columns, optimistic `version`, soft-delete columns

#### `recipe_versions`

- `recipe_id`, monotonically increasing `version_number`
- `effective_date`
- `output_qty` in the output item's normalized base unit; `output_unit_id` records that base unit
- `expected_yield_pct` (default 100) and `expected_waste_pct` (default 0)
- `is_active`, `activated_at`, `activated_by`, `prep_notes`
- audit columns and optimistic `version`

Exactly one active row per recipe is enforced by a partial unique index. Activated versions and
their lines are immutable. Changes require a new draft version.

#### `recipe_lines`

- `recipe_version_id`, `input_item_id`, `qty` in the input item's normalized base unit
- `is_packaging`
- audit columns and optimistic `version`

One input item appears at most once in a version. Quantity must be positive. `is_packaging` must
match an input whose type is packaging/container; reusable containers cost zero unless
`inventory_items.is_consumable` is true.

#### `cost_snapshots`

- `recipe_version_id`, `snapshot_reason`
- `total_cost`, `unit_cost`, `ingredient_cost`, `packaging_cost`, `waste_cost`
- `breakdown jsonb`, `computed_at`, `created_by`

Snapshots are append-only. Authenticated users receive no table grant; cost holders read them only
through a permission-checking function. Phase 5 may attach the same snapshot shape to finalized
production records without changing historical rows.

## Cost calculation

All quantities are already normalized to base units.

For each recipe line:

1. If the input item is a non-consumable container, its cost is zero.
2. If the input has an active `production` recipe, recursively calculate that version's unit cost.
3. Otherwise use the input item's current `weighted_avg_cost`.
4. Extended line cost is `qty × input unit cost`.

Then:

- `ingredient_cost` = non-packaging extended costs.
- `packaging_cost` = packaging/consumable-container extended costs.
- `waste_cost` = `ingredient_cost × expected_waste_pct / 100`.
- `effective_output_qty` = `output_qty × expected_yield_pct / 100`.
- `total_cost` = `ingredient_cost + packaging_cost + waste_cost`.
- `unit_cost` = `total_cost / effective_output_qty`.

Money is rounded to four decimal places at the recipe result boundary. Breakdown rows retain the
source unit cost and extended cost for auditability.

## Graph integrity

- Recursive costing has a hard depth limit of 32 and a visited-recipe path.
- Activation rejects direct and indirect cycles before changing active state.
- Only active production recipes participate in nested input resolution.
- A sale or modifier recipe may consume `sub_product`, `portioned_product`, `packaging`, or a
  consumable `container`; it may not directly consume `raw_ingredient`. This enforces the Phase 4
  side of critical scenario 9.
- Recipe output and line units must be the referenced items' base units.

## Database functions

### `calculate_recipe_cost(p_recipe_version_id uuid)`

`SECURITY DEFINER`, read-only, and callable only when `has_permission(auth.uid(),'cost.read')`.
Returns a single structured result with totals and JSON breakdown. Unauthorized calls raise a
permission error instead of returning redacted values.

### `activate_recipe_version(p_recipe_version_id uuid)`

`SECURITY DEFINER`; requires both `recipe.write` and `cost.read`. It locks the recipe, verifies the
draft and graph, deactivates the prior version, activates the selected version, calculates its cost,
and inserts an immutable `cost_snapshots` row in one transaction.

### `recipe_cost_snapshot(p_recipe_version_id uuid)`

Returns the latest snapshot only to `cost.read` holders. Recipe readers without cost access can
still read recipe names, versions, quantities, and line items through ordinary RLS.

## Authorization

| Data/action                 | Required permission          | DB enforcement                        |
| --------------------------- | ---------------------------- | ------------------------------------- |
| Read recipes/versions/lines | `recipe.read`                | RLS + non-sensitive column grants     |
| Create/edit drafts          | `recipe.write`               | server action + RLS                   |
| Activate a version          | `recipe.write` + `cost.read` | server action + in-function checks    |
| Calculate/read costs        | `cost.read`                  | permission-checking definer functions |
| Cost snapshot raw table     | service role only            | no authenticated grants/policies      |

No Server Component or action reads `weighted_avg_cost`, snapshot values, or branch price margins
through the session client's ordinary table API.

## UI

### `/recipes`

Recipe list grouped by scope, with output item, target, active version, effective date, and recipe
status. `recipe.write` holders can create recipes. Cost figures are absent unless `cost.read` is
also present.

### `/recipes/[id]`

Version history and active badge; draft-version creation; normalized recipe-line editor; activation
confirmation; preparation notes; warning/empty/error states. Cost breakdown is rendered only for
`cost.read`.

### `/costing`

Super-Admin-only dashboard. Shows current active recipe cost and, where a branch selling price
exists, gross profit, gross margin, food-cost percentage, and markup. Recommendations are display
only and never change selling prices.

## Testing gates

- Unit tests for yield/waste arithmetic, packaging/container treatment, margin metrics, and four-
  decimal rounding.
- Integration tests for recipe RLS, unauthorized cost denial (critical scenario 1), recursive
  multi-level cost, cycle rejection, one-active-version enforcement, sale-recipe raw-input denial,
  immutable activation snapshot after ingredient price changes (critical scenario 8), and snapshot
  append-only enforcement.
- E2E permission routing: Production Staff can read recipes without costs; Inventory Staff is
  redirected; only Super Admin can reach `/costing` or mutate recipes.
- Full format, lint, typecheck, Vitest, build, bundle-secret scan, and Playwright verification.

## Recorded assumptions

The decisions introduced here are recorded as A-026 onward in `docs/ASSUMPTIONS.md` during the
documentation task. The principal assumptions are recipe kinds/targets, the planned-cost formula,
active production recipe recursion, activation-time snapshots, and raw-input restrictions on sale
recipes.
