# Changelog

All notable changes to the Zombeans Inventory system. Kept per phase.
Format loosely follows Keep a Changelog. Dates are Asia/Manila.

## [Unreleased]

### Phase 10 — Offline & POS Preparation — 2026-07-14

Added

- Server-scoped offline recount and production snapshot receipts, IndexedDB device drafts, stable
  retry keys, visible queue states, and explicit conflict review without trusting client clocks.
- Read-only camera/manual barcode lookup and a permission-composed `/offline-pos` workspace with
  responsive loading, empty, warning, failure, conflict, synchronized, preview, and confirmation
  states.
- Loyverse item/variant/modifier mappings plus bounded UTF-8 CSV parsing, immutable staging rows,
  per-row validation, explicit reasoned confirmation, FEFO sale posting, refund posting, and
  external-line idempotency. No live POS credentials, API calls, polling, or webhooks were added.
- Phase 10 schema/security/functions (migrations 0033–0035), including append-only command/posting
  evidence, RLS, cost-free grants, and atomic reuse of existing recount/production controls.
- Static-only PWA caching and an offline fallback; mutation requests are never intercepted by the
  service worker.

Tests

- Unit coverage validates RFC-style quoted CSV parsing, exact headers and limits, plus stable
  IndexedDB draft state transitions and retry keys.
- Real-Postgres coverage proves scenarios 17, 18, and 24, server-owned snapshot scope, direct-DML
  denial, barcode safety, POS permissions/RLS, exact ledger counts, and replay invariants.
- Playwright covers operational-role visibility, manager mapping/preview/explicit confirmation,
  the preview no-post invariant, and compact mobile reachability.

Gate: Phase 10 critical scenarios 17, 18, and 24 pass.

### Phase 9 — Reports, Exports, Recycle Bin, Backups — 2026-07-14

Added

- Four branch-scoped operational reports and two `cost.read`-protected financial reports with
  validated date, branch, category, and item-type filters, safe empty states, summaries, and print
  layouts.
- Server-generated CSV, Excel-compatible SpreadsheetML, and PDF exports from the same authorized
  database result. CSV formula cells are neutralized; financial exports enforce the database cost
  gate and protected fields are allowlisted.
- Phase 9 schema/security/functions (migrations 0030–0032): explicit retention holds, append-only
  lifecycle commands, idempotent purge runs, safe backup-run metadata, lifecycle DML guards, and
  audited soft-delete/restore/hold/purge commands for supported business roots.
- Super-Admin recycle-bin controls showing human labels, dependency/hold status, deletion/purge
  dates, and reasoned restore/purge actions; raw UUIDs are never displayed.
- A truthful Super-Admin backup status/policy/restore-drill surface. Only secured service-role
  infrastructure can record sanitized run metadata; no backup credential, path, URL, or restore
  execution is exposed to the application.

Tests

- Real-Postgres coverage proves operational branch scope and cost-free payloads, direct financial
  denial, scenarios 14–16, dependency and explicit-hold protection, lifecycle DML guards,
  idempotent commands, RLS, and service-role-only backup recording.
- Unit coverage validates filters and all three export formats, including CSV formula-injection
  protection. Playwright covers report visibility/downloads, invalid-filter fallback, financial
  gating, recycle-bin access, and honest backup status on Chromium and Pixel 7.

Gate: Phase 9 critical scenarios 14, 15, and 16 pass.

### Phase 8 — Calendar, Popup Events, Notifications, Dashboard — 2026-07-14

Added

- Phase 8 schema/security/functions (migrations 0026–0028): targeted deduplicated notifications,
  append-only notification/delivery history, current receipts, an idempotent Critical-email
  outbox, audited calendar commands, permanent-popup engagement sessions, frozen count summaries,
  and links to already-posted stock effects.
- Eight operational producers with one enforced severity mapping: negative inventory, expired
  lots, failed production, overdue/unusual recounts, low/out-of-stock, and pending stock requests.
  Critical conditions queue immediate in-app and email delivery through a server-only transport.
- Separate operational and financial dashboard RPCs. All roles receive branch-scoped KPIs,
  alerts, movements, recount variances, and upcoming events; only `cost.read` can call the
  valuation function or render the inventory-value card.
- Responsive `/dashboard`, `/calendar`, `/popups`, `/popups/[id]`, and `/notifications` pages with
  filters, role-aware controls, Month/Week/Agenda views, Asia/Manila input, loading/empty/success/
  warning/error states, and a current active-unread notification bell.
- Popup lifecycle and reconciliation that never mutates inventory. Transfers and consumed/waste/
  loss/gain entries are posted through the existing atomic ledger workflows, then linked to and
  validated by the event summary.

Tests

- Real-Postgres notification gates prove all eight severity mappings, one active row per stable
  dedup key, re-raise and resolve history, targeted RLS, replay-safe read/ack, Critical-only email,
  and claim/finalize delivery idempotency.
- Dashboard authorization tests prove Branch Manager, Production Staff, and Inventory Staff
  cannot call the financial RPC directly, while Super Admin receives exact valuation and the
  operational payload contains no cost/value fields.
- Unit tests cover severity, business-time conversion, dashboard ranges, and popup arithmetic;
  Playwright covers dashboard financial visibility, calendar permissions/create, popup create,
  and persistent Critical acknowledgement on Chromium and Pixel 7.

Gate: Phase 8 notification dedup/severity and dashboard role-gating suites pass.

### Phase 7 — Recounts & Daily Operations — 2026-07-13

Added

- Phase 7 schema/security/functions (migrations 0023–0025): human-referenced recount sessions,
  frozen expected/physical/variance lines, reason-backed variance adjustments, per-branch day
  closures, append-only close/reopen events, sensitive snapshot column grants, and branch-scoped
  RLS.
- Atomic, permission-checking, replay-safe open/submit/adjust/close/reopen RPCs. Recount
  adjustments post compensating `recount_adjustment` ledger entries and update lots/balances in one
  transaction without changing previously posted rows.
- Expected quantity is frozen from opening plus categorized same-day receipts, production output,
  transfers out, usage, stock-outs, and waste. Variance value is frozen from an existing posted
  cost snapshot and is never recomputed or returned to browser code.
- Unusual percent/value/zero-expected/missing-cost/negative/post-reopen/repeat-actor signals, with
  Super Admin-only unusual confirmation. Ordinary Inventory Staff and Branch Managers can resolve
  ordinary variances with a mandatory reason.
- Required start-of-day, optional end-of-day, and cycle-count interfaces; live quantity variance;
  close-readiness blockers; reasoned Super Admin reopen; later-change attribution; loading, empty,
  success, warning, and error states; and permission-aware desktop/mobile navigation.

Tests

- Critical scenario 11 proves the full expected-quantity formula, four-decimal variance,
  reason-backed compensating ledger net, frozen valuation, replay safety, and immutability of every
  previously posted row; unusual cases reject ordinary staff and accept Super Admin.
- Critical scenario 12 proves a closed branch date rejects ordinary stock posting through the RPC
  and direct Phase 7 writes through grants/RLS, leaving balance and ledger counts unchanged.
- Critical scenario 13 proves blank/non-Super reopen denial, one idempotent append-only close event
  plus audit row, and explicit attribution of later ledger/recount activity to the reopen event.
- Unit tests cover formula categories, four-decimal boundaries, variance value, and escalation
  thresholds. Playwright covers Inventory Staff, Branch Manager, Super Admin, and Production Staff
  on Chromium and Pixel 7 without cost or UUID exposure.

Gate: critical scenarios **11**, **12**, and **13** pass.

### Phase 6 — Multi-branch Stock — 2026-07-13

Added

- Phase 6 schema/security/functions (migrations 0020–0022): human-referenced stock requests,
  reviewed request lines, transfer lifecycle rows, per-source-lot cost allocations, receiving
  discrepancies, Critical negative-inventory alerts, branch-scoped RLS, and definer-only writes.
- Atomic, permission-checking, idempotent direct stock-in/out. Stock-out consumes eligible lots
  FEFO and preserves any true negative projection with a Critical alert instead of clamping it.
- Request creation/review and transfer preparation, manager approval/dispatch, and receiving.
  Transfer dispatch consumes available/unexpired source lots FEFO; receiving preserves each lot's
  historical cost/expiry and accepts one stable replay key.
- Receiving accounting requires every shipped unit to be received, rejected, damaged, or missing;
  non-received quantities create open reasoned discrepancies with a manager resolution path.
- Stock overview, Critical alert and negative-balance display, direct stock forms, request review,
  transfer prepare/detail/approve/receive/discrepancy UI, loading/empty/warning/error states,
  permission-aware desktop/mobile navigation, shared Zod validation, and audit events.

Tests

- Critical scenario 5: a repeated receive returns the original destination transaction and leaves
  destination lots/balance, ledger-line count, and discrepancy count unchanged.
- Critical scenario 9: the existing real-Postgres sale-recipe trigger test continues to reject raw
  inputs; Phase 6 adds no POS/sale recipe posting path.
- Critical scenario 10: a stock-out beyond eligible lots leaves the exact negative balance and full
  signed ledger quantity, creates one active Critical alert, and remains readable in the UI.
- Additional real-Postgres coverage proves FEFO/expired exclusion, cross-branch cost preservation,
  request review, lifecycle/permission guards, direct batch stock-in replay, RLS write denial, and
  sensitive allocation-cost denial. Playwright covers Inventory/Manager/Production roles on
  Chromium and Pixel 7.

Gate: critical scenarios **5**, **9**, and **10** pass.

### Phase 5 — Production — 2026-07-13

Added

- Production schema and security (migrations 0016–0019): recipe-backed templates, immutable
  planned orders, frozen planned/actual input rows, lifecycle guards, Main-only posting, and RLS
  for `production.create`, `production.record`, and `production.confirm`.
- Protected order planning attaches the active production recipe version and its immutable
  activation cost snapshot. Atomic actual recording submits complete input/output, waste,
  batch, production-date, and expiration data in one database transaction.
- `post_production_completion()` locks the order, consumes only available/unexpired lots FEFO,
  records signed consumption/waste/output ledger lines, updates lots and balances, creates the
  output lot, and completes the order in one idempotent transaction.
- Production list, template creation, stable-token order creation, actual recording, yield/waste
  warnings, manager confirmation, loading/empty/error states, permission-aware navigation, and
  audited Server Actions. Cost fields are never loaded or rendered for production operators.

Tests

- Critical scenario 2: earlier eligible lots are consumed first; expired/quarantined lots are
  skipped, and expired-only availability raises without posting.
- Critical scenario 3: a later insufficient input rolls back every lot/balance/header/line/output
  and leaves the order awaiting confirmation.
- Critical scenario 4: replay returns the original output transaction and does not deduct or add
  inventory twice.
- Browser permissions cover Production Staff create/record without confirm, Branch Manager
  confirmation, Inventory Staff denial, and cost absence on desktop/mobile.

Gate: critical scenarios **2**, **3**, and **4** pass.

### Phase 4 — Recipes & Product Costing — 2026-07-13

Added

- Versioned recipe schema (migrations 0013–0015): production, product/variant sale, and modifier
  recipes; normalized lines; one active version per recipe; immutable activated versions and
  append-only cost snapshots.
- Protected recursive cost engine using active production recipes and weighted-average leaf
  costs, with yield, waste, consumable packaging, reusable-container exclusion, cycle/depth
  protection, and atomic activation snapshots.
- Defense-in-depth cost controls: recipe composition uses `recipe.read/write` RLS, while costs are
  available only through `cost.read`-checking `SECURITY DEFINER` RPCs. Authenticated users have no
  direct `cost_snapshots` table privilege.
- Recipe list/detail UI with draft versioning, normalized input editor, activation workflow, and
  permission-gated cost breakdown. Super-Admin-only costing dashboard adds branch selling price,
  gross profit, margin, food-cost percentage, and markup.
- Recipes and Costing navigation, loading/empty/error states, Zod validation, audited server
  actions, pure TypeScript costing helpers, and Phase 4 unit/integration/e2e coverage.

Tests

- Critical scenario 1: non-cost roles are denied protected cost functions and snapshot table
  access; cost UI/navigation remains absent.
- Critical scenario 8: activation cost snapshots remain unchanged after weighted-average input
  costs move, while live recalculation reflects the new cost.
- Phase 4 scenario 9 gate: sale/modifier recipes reject raw or finished sellable inputs; recursive
  raw → sub-product → sale costing and cycle rejection are covered at the database layer.

Gate: critical scenarios **1** and **8** pass; the recipe-model portion of scenario **9** passes.

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
