# Changelog

All notable changes to the Zombeans Inventory system. Kept per phase.
Format loosely follows Keep a Changelog. Dates are Asia/Manila.

## [Unreleased]

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
