# Changelog

All notable changes to the Zombeans Inventory system. Kept per phase.
Format loosely follows Keep a Changelog. Dates are Asia/Manila.

## [Unreleased]

### Phase 3 — Ingredients, Suppliers & Purchasing — 2026-07-11

Added

- Purchasing + minimal receiving-scoped ledger-core schema (migrations 0010–0012): `suppliers`,
  `supplier_items`, `supplier_prices` (SENSITIVE, append-only history), `purchase_orders` +
  `purchase_order_lines`, `purchase_receipts` + `purchase_receipt_lines`, `supplier_returns` +
  `supplier_return_lines`, `inventory_lots` (FEFO), `inventory_balances`, `stock_transactions`
  (append-only ledger). New enums (`po_status`, `payment_status`, `stock_txn_type`, `txn_status`,
  `lot_status`); human-reference sequences (`PO-…`, `RCV-…`, `RET-…`).
- RLS on every purchasing table gated by `supplier.read/write`, `purchase.create/approve/receive`,
  and the new `supplier_price.write` permission (super_admin only). Sensitive columns
  (`purchase_order_lines.unit_cost`, `purchase_orders.subtotal/total`, `inventory_lots.unit_cost`,
  `supplier_prices.price`) are granted to `authenticated` by explicit column-list omission — cost
  is unreadable at the DB layer for non-`cost.read` roles, not merely hidden in the UI (rule 4).
  `stock_transactions` and `inventory_lots` writes are revoked from `authenticated` entirely —
  only the `SECURITY DEFINER` posting functions may write the ledger (rule 1, rule 6).
- Functions: `next_po_reference()` / `next_receipt_reference()` / `next_return_reference()` /
  `next_stock_txn_reference()`, `unit_factor_to_base()`, and the two posting RPCs —
  `post_purchase_receipt()` (partial delivery, over-receipt guard, FEFO lot creation,
  global-per-item weighted-average recompute, PO status transition) and `post_supplier_return()`
  (removes stock at the lot's recorded cost; weighted-average unchanged). Both are idempotent on
  their `idempotency_key` (rule 5) and append-only (rule 6).
- `lib/purchasing/costing.ts` — TS twin of the weighted-average blend used by `post_purchase_receipt`
  (scenario 7), covered by unit tests. Zod schemas (`lib/validation/purchasing.ts`).
- Server actions + UI: Suppliers (list/detail, contact + terms), supplier items + price history
  (sensitive, service-role admin client, `supplier_price.write` gated), purchase orders
  (draft → submit → approve, auto-filled line cost from the supplier's latest price, payment
  status), receiving (partial delivery, lot/expiry capture, damage/shortage flags — cost never
  shown to the receiver), supplier returns (lot-scoped). Cost columns render only when the
  viewer holds `cost.read`.
- Sidebar footer updated to "Phase 3".

Tests

- 6 unit (`costing.test.ts` — weighted-average blend, scenario 7), 6 integration
  (`purchasing.test.ts` — scenario 6 partial delivery + over-receipt guard, scenario 7
  weighted-average blend + idempotent re-post, cost-column RLS denial for non-`cost.read` roles,
  `supplier_price.write` denial to a manager, supplier return removes stock at lot cost without
  moving the weighted-average), 4 Playwright e2e (`purchasing.spec.ts` — receiving vs. suppliers
  access for inventory staff, orders vs. receiving access for branch manager, desktop sidebar
  visibility per permission).

Gate: critical scenarios **6** (partial delivery posts only accepted quantities, over-receipt
blocked) and **7** (weighted-average blends correctly across receipts and is idempotent) pass.

### Phase 2 — Branches, Categories, Units & Catalog — 2026-07-11

Added

- Org & Catalog schema (migrations 0006–0009): branches, user_branch_assignments (deferred from
  Phase 1), categories (typed tree), units + unit_conversions, unified inventory_items, products,
  product_variants, modifiers + modifier_options, branch_prices, barcodes, application_settings.
  New enums (item_type, unit_dimension, product_kind, tax_mode, modifier_selection/affects,
  barcode_symbology); indexes, updated_at/version triggers; audit_logs.branch_id FK wired up.
- RLS on every catalog table gated by catalog.item.read/write, price.read/write, settings.manage.
  Sensitive `weighted_avg_cost` granted by explicit column list (omitted from `authenticated`) so
  cost is unreadable at the DB layer, not just hidden in the UI (rule 4).
- Functions: `next_item_sku()` / `next_variant_sku()` (SECURITY DEFINER SKU generators),
  `tax_config()`, and `compute_line_tax()` — the DB single source of truth for VAT (scenario 20).
- Reference seed: 2 branches (Commissary + San Carlos), 12 units + core conversions, starter
  category tree, VAT config disabled by default (12% pre-filled), placeholder thresholds.
- Zod schemas (`lib/validation/catalog.ts`) + `lib/catalog/tax.ts` (TS twin of compute_line_tax).
- Server actions: branches CRUD, VAT settings, inventory-item create (auto SKU), product create
  (item + overlay), and independent per-branch pricing — all requirePermission + audited via RLS.
- UI: Branches admin, Settings (VAT toggle with live preview), Inventory items (typed create),
  Products with per-branch price editor and VAT-aware price display; permission-gated nav.

Tests

- 8 unit (VAT compute — scenario 20), 13 catalog RLS/integration (scenario 19 branch-price
  independence + schema integrity, scenario 20 DB VAT gating, price/settings/cost gating), 4
  Playwright e2e (catalog permission gating for staff + manager). Full suite: 45 → 49 vitest.

Gate: critical scenarios 19 (branch prices independent) and 20 (VAT only when enabled) pass.

### Phase 1 — Authentication, Users, Roles & Security — 2026-07-10

Added

- Identity schema (migrations 0001–0005): profiles, roles, permissions, role_permissions,
  user_roles, email_code_challenges, audit_logs; 38-permission catalog + 4 system roles.
- RLS on all identity tables + `has_permission` / `is_super_admin` / `current_permissions` /
  `current_roles` SECURITY DEFINER helpers; explicit grants (authenticated + service_role).
- Protected Super Admin (triggers block disable/delete/demote + privileged-field escalation).
- Super Admin step-up email verification: CSPRNG 6-digit code, HMAC-hash at rest, ~5-min TTL,
  single-use, attempt- and rate-limited, fully audited; middleware gates a password-only Super
  Admin session to /verify until verified (signed httpOnly marker, edge-verified).
- Server permission enforcement, session middleware, force-logout of disabled accounts,
  password-reset request, append-only audit writer, provider-agnostic email (console transport).
- UI: login → step-up → dashboard; app shell (permission-gated sidebar + mobile nav, theme
  toggle, account menu); role-gated dashboard; user management (create/roles/enable-disable);
  audit-log viewer. Design system retokenized from the live site (Anton/Inter/JetBrains Mono,
  forest-green/cream/amber, dark + light).
- Dev seed (local-only, guarded); scan:bundle guard (scenario #23) wired into CI.

Tests

- 13 unit (step-up logic — scenarios 21, 22; localization), 11 RLS integration (permission
  helpers, profile scoping, sensitive-table lockdown, Super Admin protection), 8 Playwright e2e
  (auth happy + failure paths, step-up gate; desktop + mobile). Bundle scan confirms scenario 23.

### Phase 0 — Planning & Repository Foundation — 2026-07-10

Added

- Rewrote `CLAUDE.md` / `AGENTS.md` for the Next.js + Supabase stack (replacing prior static-site
  frontend rules).
- Repository scaffold: `package.json`, `tsconfig.json` (strict), `next.config.mjs`,
  Tailwind v4 (`postcss.config.mjs`, `app/globals.css` with Zombeans brand tokens),
  `app/layout.tsx`, `app/page.tsx` placeholder.
- Tooling: ESLint (flat config), Prettier, Vitest (+ setup, smoke test), Playwright, `components.json`
  (shadcn), PWA `manifest.webmanifest`, GitHub Actions CI.
- Environment validation (`lib/env.ts`, Zod) + `.env.example`; localization helpers (`lib/format.ts`),
  `lib/utils.ts` (cn).
- Supabase local config (`supabase/config.toml`) + migration folder scaffold.
- Documentation set (13 docs): SYSTEM_REQUIREMENTS, ARCHITECTURE, DATABASE_SCHEMA,
  ROLES_AND_PERMISSIONS, BUSINESS_RULES, UI_STRUCTURE, SUPABASE_SETUP, IMPLEMENTATION_PHASES,
  TESTING_STRATEGY, DEPLOYMENT, BACKUP_AND_RECOVERY, ASSUMPTIONS, CHANGELOG.
- Diagrams: ERD + workflow/state diagrams (ledger, production, transfer, purchase receiving,
  recount) in `docs/diagrams/`.

Notes

- No business modules yet (per Phase 0 scope). Next: Phase 1 — Auth, Users, Roles, Security.
