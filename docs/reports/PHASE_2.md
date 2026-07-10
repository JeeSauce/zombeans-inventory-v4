# Phase 2 — Branches, Categories, Units & Catalog — End-of-phase report

Date: 2026-07-11 · Branch: `phase-2-catalog`

## Completed work

- **Org & Catalog data model** (migrations 0006–0009): branches, `user_branch_assignments`
  (deferred from Phase 1), typed category tree, units + unit conversions, the unified
  `inventory_items` table, products, product variants, modifiers + options, per-branch
  `branch_prices`, barcodes, and the `application_settings` key/value store.
- **Security**: RLS on every catalog table, gated by `catalog.item.read/write`, `price.read/write`,
  and `settings.manage`. The sensitive `weighted_avg_cost` column is granted to `authenticated`
  by explicit column list (omitting it), so cost is unreadable at the DB — not merely hidden.
- **Functions**: `next_item_sku()` / `next_variant_sku()` (SECURITY DEFINER), `tax_config()`, and
  `compute_line_tax()` — the DB single source of truth for VAT.
- **App layer**: Zod schemas, a TS twin of the tax function, server actions (branches, VAT
  settings, item create with auto SKU, product create, independent per-branch pricing), and UI for
  Branches, Settings (VAT), Inventory items, and Products (per-branch price editor, VAT-aware
  display). Navigation is permission-gated.

## Files changed

- Migrations: `supabase/migrations/0006_catalog_schema.sql`, `0007_catalog_rls.sql`,
  `0008_catalog_functions.sql`, `0009_catalog_seed.sql`.
- Lib: `lib/validation/catalog.ts`, `lib/catalog/tax.ts`.
- Actions: `app/(app)/admin/branches/actions.ts`, `app/(app)/admin/settings/actions.ts`,
  `app/(app)/catalog/items/actions.ts`, `app/(app)/catalog/products/actions.ts`.
- Pages: `app/(app)/admin/branches/page.tsx`, `app/(app)/admin/settings/page.tsx`,
  `app/(app)/catalog/items/page.tsx`, `app/(app)/catalog/products/page.tsx`.
- Components: `components/admin/branches-client.tsx`, `components/admin/vat-settings-client.tsx`,
  `components/catalog/items-client.tsx`, `components/catalog/products-client.tsx`;
  `components/app/nav.ts`, `components/app/sidebar.tsx`.
- Tests: `tests/unit/tax.test.ts`, `tests/integration/catalog.test.ts`, `tests/e2e/catalog.spec.ts`.
- Docs: `CHANGELOG.md`, `ASSUMPTIONS.md` (A-017..A-020), this report.

## Migrations created

0006 (schema + enums), 0007 (RLS + grants), 0008 (SKU + tax functions), 0009 (reference seed).

## Tests added / passed

- Unit: `tax.test.ts` — 8 (scenario 20 across enabled/disabled × none/inclusive/exclusive).
- Integration/RLS: `catalog.test.ts` — 13 (scenario 19 price independence + schema integrity,
  scenario 20 DB gating, price/settings visibility, sensitive-cost denial, definer SKU).
- E2E: `catalog.spec.ts` — 4 (catalog permission gating for inventory staff + branch manager).
- Full vitest suite green (unit + integration).

## Gate

Critical scenarios **19 (branch prices remain independent)** and **20 (VAT calculated only when
enabled)** pass — proven at the DB backstop and mirrored in the TypeScript display helper.

## Known limitations / deferred

- Super Admin **UI happy-path e2e** (create product → set independent prices → toggle VAT) is not
  automated because the Super Admin step-up code is console-delivered; the flow is covered by
  integration tests instead. Non-privileged permission gating is covered by e2e.
- **Cost-gated read paths** (views/functions exposing `weighted_avg_cost` to `cost.read`) arrive
  with costing in Phase 4; the column is currently server-only and defaults to 0.
- **Modifiers, variants, barcodes, unit-conversion, category CRUD UIs** are schema/RLS-complete but
  only partially surfaced in the UI (variants creatable via data model; full editors to follow as
  their consuming modules land). Editing/soft-delete of items/products beyond create is minimal.
- Only two branches are seeded (see ASSUMPTIONS A-017); more are added via the Branches admin.

## Security considerations

- No client path can read or write `weighted_avg_cost`; VAT config is reachable only through the
  definer `tax_config()` helper, never a raw `application_settings` select.
- All writes go through `requirePermission` **and** RLS (defense in depth); audits are written with
  the service role. Branch-price rows enforce exactly one target (product XOR variant) and one
  active price per target per branch at the schema level.

## Next phase

Phase 3 — Ingredients, Suppliers, Purchasing (lots + expiry, supplier prices [sensitive],
weighted-average costing, POs, receiving). Gate: critical scenarios 6, 7.
