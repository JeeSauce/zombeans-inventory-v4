# Phase 3 — Ingredients, Suppliers & Purchasing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the purchasing + costing domain (suppliers, supplier prices, purchase orders, partial receiving, supplier returns) on top of the Phase 2 catalog, including a minimal receiving-scoped ledger core that posts stock and maintains weighted-average cost.

**Architecture:** Append-only ledger (`stock_transactions`/`_lines`, `inventory_lots`, `inventory_balances`) written only by `SECURITY DEFINER` functions. Cost flows supplier_prices → PO-line unit_cost (auto, hidden) → receiving → weighted-average, and every cost-bearing column is revoked from `authenticated` at the DB. Server actions call `requirePermission` with RLS as the backstop; multi-table posts go through the definer functions.

**Tech Stack:** Next.js 15 App Router, TS strict, Supabase Postgres + RLS, Zod, RHF, TanStack, Tailwind v4 + shadcn/ui, Vitest (unit + integration via `pg`), Playwright.

## Global Constraints

- Money & quantity columns: `numeric(14,4)`. Quantities stored in **base units**.
- UUID pks via `gen_random_uuid()`; **never** show UUIDs in the UI (names/SKU/reference only).
- Every business table: `created_at/updated_at` (+ `tg_set_updated_at` trigger), `created_by/updated_by`, `version`; soft-delete cols where applicable; `idempotency_key text unique` on mutation/ledger tables.
- Sensitive cost columns are granted to `authenticated` by **explicit column list omitting them** (a table-wide `GRANT` cannot be carved back with `REVOKE`). Cost is reachable only through a `cost.read`-gated view/RPC.
- Inventory quantities are **never** mutated from the browser — only via `SECURITY DEFINER` functions writing the append-only ledger.
- Ledger is append-only; corrections are reversing/compensating entries, never edits.
- Currency `₱1,234.56`, Asia/Manila, timestamps UTC.
- Migrations are numbered sequentially after `0009`. Apply with `npx supabase migration up`; reset with `npx supabase db reset && npm run seed:dev`.
- Before every commit/push run the full CI order: `npm run format` → `format:check` → `lint` → `typecheck` → `test` → `build` → `scan:bundle`. CI runs `format:check` first (see memory `zombeans-ci-format-check`).
- Integration/RLS tests need local Supabase running; reuse `tests/integration/helpers/db.ts`.
- Branch: `phase-3-purchasing` (already created off `main`, spec committed).

**Reference patterns to mirror (read before implementing):**

- Migration style: `supabase/migrations/0006_catalog_schema.sql`, `0007_catalog_rls.sql`, `0008_catalog_functions.sql`.
- Column-list cost grant: `0007` (`inventory_items` grants).
- Server action: `app/(app)/catalog/products/actions.ts`. Permission helper: `lib/permissions/index.ts`. Audit: `lib/audit/index.ts`.
- Page + client UI: `app/(app)/catalog/products/page.tsx` + `components/catalog/products-client.tsx` (dialogs own `useActionState`, close on `state.info`; native `<select>` via `selectClass`).
- Integration test harness: `tests/integration/catalog.test.ts` (uses `connect/createUser/assignRole/asUser/cleanupUsers`).
- e2e: `tests/e2e/catalog.spec.ts` (viewport-agnostic; server-redirect assertions).
- Nav: `components/app/nav.ts`.

---

### Task 1: Purchasing + ledger schema (migration 0010)

**Files:**

- Create: `supabase/migrations/0010_purchasing_schema.sql`

**Interfaces:**

- Produces tables: `suppliers`, `supplier_items`, `supplier_prices`, `purchase_orders`, `purchase_order_lines`, `purchase_receipts`, `purchase_receipt_lines`, `supplier_returns`, `supplier_return_lines`, `inventory_lots`, `inventory_balances`, `stock_transactions`, `stock_transaction_lines`; enums `po_status`, `payment_status`, `stock_txn_type`, `txn_status`, `lot_status`; sequences `po_ref_seq`, `receipt_ref_seq`, `return_ref_seq`, `stock_txn_ref_seq`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0010_purchasing_schema.sql`. Follow the header/comment style of `0006`. Full DDL:

```sql
-- 0010_purchasing_schema.sql
-- Phase 3 — Suppliers & Purchasing + minimal receiving-scoped ledger core.
-- RLS/grants in 0011; posting functions in 0012.

-- ── Enums ────────────────────────────────────────────────────────────────────
create type public.po_status as enum
  ('draft','submitted','approved','partially_received','fully_received','closed','cancelled');
create type public.payment_status as enum
  ('unpaid','partially_paid','paid','overdue','cancelled','refunded');
create type public.stock_txn_type as enum
  ('stock_in','batch_stock_in','stock_out','batch_stock_out','transfer',
   'production_consumption','production_output','waste','manual_adjustment',
   'purchase_receiving','recount_adjustment','supplier_return','pos_sale','pos_refund');
create type public.txn_status as enum
  ('draft','pending_approval','approved','rejected','posted','reversed');
create type public.lot_status as enum ('available','expired','quarantined');

-- ── Human-reference sequences ────────────────────────────────────────────────
create sequence if not exists public.po_ref_seq        as bigint start 1;
create sequence if not exists public.receipt_ref_seq   as bigint start 1;
create sequence if not exists public.return_ref_seq    as bigint start 1;
create sequence if not exists public.stock_txn_ref_seq as bigint start 1;

-- ── suppliers ────────────────────────────────────────────────────────────────
create table public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  contact_name   text,
  contact_email  text,
  contact_phone  text,
  lead_time_days integer not null default 0,
  payment_terms  text,
  active         boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  version    integer not null default 1,
  deleted_at timestamptz, deleted_by uuid references public.profiles(id), purge_at timestamptz,
  constraint suppliers_lead_time_nonneg check (lead_time_days >= 0)
);
create index suppliers_active on public.suppliers(active) where deleted_at is null;

-- ── supplier_items ───────────────────────────────────────────────────────────
create table public.supplier_items (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references public.suppliers(id) on delete cascade,
  item_id      uuid not null references public.inventory_items(id) on delete restrict,
  supplier_sku text,
  pack_size    numeric(14,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  version    integer not null default 1,
  unique (supplier_id, item_id)
);
create index supplier_items_item on public.supplier_items(item_id);

-- ── supplier_prices (SENSITIVE, append-only history) ─────────────────────────
create table public.supplier_prices (
  id               uuid primary key default gen_random_uuid(),
  supplier_item_id uuid not null references public.supplier_items(id) on delete cascade,
  price            numeric(14,4) not null,               -- SENSITIVE
  currency         text not null default 'PHP',
  effective_date   date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  constraint supplier_prices_price_nonneg check (price >= 0)
);
create index supplier_prices_lookup
  on public.supplier_prices(supplier_item_id, effective_date desc);
comment on column public.supplier_prices.price is 'SENSITIVE: cost.read gated at UI + DB.';

-- ── purchase_orders ──────────────────────────────────────────────────────────
create table public.purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  reference      text not null unique,
  supplier_id    uuid not null references public.suppliers(id) on delete restrict,
  status         public.po_status not null default 'draft',
  payment_status public.payment_status not null default 'unpaid',
  expected_date  date,
  subtotal       numeric(14,4) not null default 0,       -- SENSITIVE
  total          numeric(14,4) not null default 0,       -- SENSITIVE
  notes          text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  version    integer not null default 1,
  deleted_at timestamptz, deleted_by uuid references public.profiles(id), purge_at timestamptz
);
create index purchase_orders_supplier on public.purchase_orders(supplier_id);
create index purchase_orders_status on public.purchase_orders(status) where deleted_at is null;

-- ── purchase_order_lines ─────────────────────────────────────────────────────
create table public.purchase_order_lines (
  id                    uuid primary key default gen_random_uuid(),
  po_id                 uuid not null references public.purchase_orders(id) on delete cascade,
  item_id               uuid not null references public.inventory_items(id) on delete restrict,
  unit_id               uuid not null references public.units(id) on delete restrict,
  ordered_qty           numeric(14,4) not null,
  unit_cost             numeric(14,4) not null default 0, -- SENSITIVE (auto-filled)
  received_accepted_qty numeric(14,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  version    integer not null default 1,
  constraint po_lines_ordered_pos check (ordered_qty > 0),
  constraint po_lines_accepted_nonneg check (received_accepted_qty >= 0)
);
create index po_lines_po on public.purchase_order_lines(po_id);

-- ── purchase_receipts ────────────────────────────────────────────────────────
create table public.purchase_receipts (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique,
  po_id           uuid not null references public.purchase_orders(id) on delete restrict,
  status          text not null default 'draft',         -- draft | posted
  has_shortage    boolean not null default false,
  has_damage      boolean not null default false,
  has_price_diff  boolean not null default false,
  needs_review    boolean not null default false,
  received_by     uuid references public.profiles(id),
  received_at     timestamptz not null default now(),
  idempotency_key text not null unique,
  correlation_id  uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  version    integer not null default 1
);
create index purchase_receipts_po on public.purchase_receipts(po_id);

-- ── purchase_receipt_lines ───────────────────────────────────────────────────
create table public.purchase_receipt_lines (
  id              uuid primary key default gen_random_uuid(),
  receipt_id      uuid not null references public.purchase_receipts(id) on delete cascade,
  po_line_id      uuid not null references public.purchase_order_lines(id) on delete restrict,
  delivered_qty   numeric(14,4) not null default 0,
  accepted_qty    numeric(14,4) not null default 0,
  rejected_qty    numeric(14,4) not null default 0,
  damaged_qty     numeric(14,4) not null default 0,
  missing_qty     numeric(14,4) not null default 0,
  expiration_date date,
  lot_number      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  constraint receipt_lines_qtys_nonneg check (
    delivered_qty >= 0 and accepted_qty >= 0 and rejected_qty >= 0
    and damaged_qty >= 0 and missing_qty >= 0)
);
create index receipt_lines_receipt on public.purchase_receipt_lines(receipt_id);

-- ── supplier_returns ─────────────────────────────────────────────────────────
create table public.supplier_returns (
  id                 uuid primary key default gen_random_uuid(),
  reference          text not null unique,
  supplier_id        uuid not null references public.suppliers(id) on delete restrict,
  status             text not null default 'draft',      -- draft | posted
  reason             text,
  payable_adjustment numeric(14,4) not null default 0,   -- SENSITIVE
  idempotency_key    text not null unique,
  correlation_id     uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  version    integer not null default 1
);

create table public.supplier_return_lines (
  id         uuid primary key default gen_random_uuid(),
  return_id  uuid not null references public.supplier_returns(id) on delete cascade,
  item_id    uuid not null references public.inventory_items(id) on delete restrict,
  lot_id     uuid not null references public.inventory_lots(id) on delete restrict,
  qty        numeric(14,4) not null,                     -- base unit
  reason     text,
  created_at timestamptz not null default now(),
  constraint return_lines_qty_pos check (qty > 0)
);
create index return_lines_return on public.supplier_return_lines(return_id);

-- ── inventory_lots ───────────────────────────────────────────────────────────
create table public.inventory_lots (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.inventory_items(id) on delete restrict,
  branch_id       uuid not null references public.branches(id) on delete restrict,
  lot_number      text,
  received_date   date not null default (now() at time zone 'utc')::date,
  expiration_date date,
  qty_remaining   numeric(14,4) not null default 0,
  unit_cost       numeric(14,4) not null default 0,      -- SENSITIVE snapshot
  status          public.lot_status not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer not null default 1,
  constraint lots_qty_nonneg check (qty_remaining >= 0)
);
create index lots_fefo on public.inventory_lots(item_id, branch_id, expiration_date)
  where status = 'available';
comment on column public.inventory_lots.unit_cost is 'SENSITIVE: cost.read gated at UI + DB.';

-- ── inventory_balances ───────────────────────────────────────────────────────
create table public.inventory_balances (
  item_id     uuid not null references public.inventory_items(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  qty_on_hand numeric(14,4) not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (item_id, branch_id)
);

-- ── stock_transactions (append-only) ─────────────────────────────────────────
create table public.stock_transactions (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,
  type                public.stock_txn_type not null,
  status              public.txn_status not null default 'posted',
  source_branch_id    uuid references public.branches(id),
  dest_branch_id      uuid references public.branches(id),
  reason              text,
  notes               text,
  purchase_receipt_id uuid references public.purchase_receipts(id),
  supplier_return_id  uuid references public.supplier_returns(id),
  created_by          uuid references public.profiles(id),
  approved_by         uuid references public.profiles(id),
  confirmed_at        timestamptz,
  idempotency_key     text not null unique,
  correlation_id      uuid,
  created_at timestamptz not null default now()
);
create index stock_txn_type_idx on public.stock_transactions(type);

create table public.stock_transaction_lines (
  id                 uuid primary key default gen_random_uuid(),
  txn_id             uuid not null references public.stock_transactions(id) on delete cascade,
  item_id            uuid not null references public.inventory_items(id) on delete restrict,
  qty                numeric(14,4) not null,             -- base unit, signed by direction
  unit_id            uuid not null references public.units(id) on delete restrict,
  lot_id             uuid references public.inventory_lots(id),
  unit_cost_snapshot numeric(14,4) not null default 0,   -- SENSITIVE
  created_at timestamptz not null default now()
);
create index stock_txn_lines_txn on public.stock_transaction_lines(txn_id);

-- ── updated_at triggers ──────────────────────────────────────────────────────
create trigger set_updated_at before update on public.suppliers
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.supplier_items
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.purchase_orders
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.purchase_order_lines
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.purchase_receipts
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.purchase_receipt_lines
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.supplier_returns
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.inventory_lots
  for each row execute function public.tg_set_updated_at();
```

- [ ] **Step 2: Apply and verify it succeeds**

Run: `npx supabase migration up`
Expected: `Applying migration 0010_purchasing_schema.sql...` then `Migrations applied` with no error.

- [ ] **Step 3: Smoke-check the schema**

Run (bash, from repo root — reuses the `pg` dep):

```bash
cat > ._ck.mjs <<'EOF'
import pg from "pg";
const c=new pg.Client({connectionString:"postgresql://postgres:postgres@127.0.0.1:54322/postgres"});
await c.connect();
const r=await c.query(`select count(*)::int n from information_schema.tables
  where table_schema='public' and table_name in
  ('suppliers','supplier_items','supplier_prices','purchase_orders','purchase_order_lines',
   'purchase_receipts','purchase_receipt_lines','supplier_returns','supplier_return_lines',
   'inventory_lots','inventory_balances','stock_transactions','stock_transaction_lines')`);
console.log("tables:", r.rows[0].n, "(expect 13)");
await c.end();
EOF
node ._ck.mjs; rm -f ._ck.mjs
```

Expected: `tables: 13 (expect 13)`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0010_purchasing_schema.sql
git commit -m "Phase 3a: purchasing + ledger-core schema"
```

---

### Task 2: RLS, grants, cost gates, cost view (migration 0011)

**Files:**

- Create: `supabase/migrations/0011_purchasing_rls.sql`

**Interfaces:**

- Consumes: all Task 1 tables; permission slugs from `0004`; `has_permission(uuid,text)` from `0003`.
- Produces: permission `supplier_price.write`; RLS policies; column-list grants that omit every sensitive cost column; view `public.item_costs` (cost.read-gated).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0011_purchasing_rls.sql`:

```sql
-- 0011_purchasing_rls.sql
-- RLS + grants for purchasing & ledger core. Sensitive cost columns are granted by explicit
-- column list (omitting them) so `authenticated` cannot read them; a cost.read-gated view exposes
-- cost to Super Admin. New permission supplier_price.write (super_admin only).

-- ── New permission ───────────────────────────────────────────────────────────
insert into public.permissions (slug, description, is_sensitive) values
  ('supplier_price.write', 'Create and edit supplier pricing', true)
on conflict (slug) do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.slug='supplier_price.write'
where r.key='super_admin' on conflict do nothing;

-- ── Non-sensitive tables: table-wide grants ──────────────────────────────────
grant select, insert, update, delete on
  public.suppliers, public.supplier_items,
  public.purchase_receipts, public.purchase_receipt_lines,
  public.supplier_returns, public.supplier_return_lines,
  public.inventory_lots, public.inventory_balances,
  public.stock_transactions, public.stock_transaction_lines
  to authenticated;

-- ── Sensitive-cost tables: grant by column list, omitting the cost column ─────
-- supplier_prices: omit price
grant select (id, supplier_item_id, currency, effective_date, created_at, created_by)
  on public.supplier_prices to authenticated;
grant insert (supplier_item_id, currency, effective_date, created_by)
  on public.supplier_prices to authenticated;
-- purchase_orders: omit subtotal, total
grant select (id, reference, supplier_id, status, payment_status, expected_date, notes,
  created_at, updated_at, created_by, updated_by, approved_by, approved_at, version,
  deleted_at, deleted_by, purge_at) on public.purchase_orders to authenticated;
grant insert (reference, supplier_id, status, payment_status, expected_date, notes,
  created_by, updated_by) on public.purchase_orders to authenticated;
grant update (supplier_id, status, payment_status, expected_date, notes, updated_by,
  approved_by, approved_at, version, deleted_at, deleted_by, purge_at)
  on public.purchase_orders to authenticated;
grant delete on public.purchase_orders to authenticated;
-- purchase_order_lines: omit unit_cost
grant select (id, po_id, item_id, unit_id, ordered_qty, received_accepted_qty,
  created_at, updated_at, created_by, updated_by, version) on public.purchase_order_lines to authenticated;
grant insert (po_id, item_id, unit_id, ordered_qty, created_by, updated_by)
  on public.purchase_order_lines to authenticated;
grant update (unit_id, ordered_qty, updated_by, version) on public.purchase_order_lines to authenticated;
grant delete on public.purchase_order_lines to authenticated;

-- inventory_lots.unit_cost, stock_transaction_lines.unit_cost_snapshot,
-- supplier_returns.payable_adjustment are covered by the table-wide grants above BUT are sensitive;
-- revoke those columns explicitly is impossible after a table grant, so re-grant by column list:
revoke select, insert, update on public.inventory_lots from authenticated;
grant select (id, item_id, branch_id, lot_number, received_date, expiration_date, qty_remaining,
  status, created_at, updated_at, version) on public.inventory_lots to authenticated;
-- (no insert/update for authenticated — lots are written by definer functions only)
grant delete on public.inventory_lots to authenticated;

revoke select, insert, update on public.stock_transaction_lines from authenticated;
grant select (id, txn_id, item_id, qty, unit_id, lot_id, created_at)
  on public.stock_transaction_lines to authenticated;

revoke select, insert, update on public.supplier_returns from authenticated;
grant select (id, reference, supplier_id, status, reason, idempotency_key, correlation_id,
  created_at, updated_at, created_by, updated_by, version) on public.supplier_returns to authenticated;
grant insert (reference, supplier_id, status, reason, idempotency_key, correlation_id,
  created_by, updated_by) on public.supplier_returns to authenticated;
grant update (status, reason, updated_by, version) on public.supplier_returns to authenticated;

-- service_role: full grants (owns privileged/definer paths)
grant select, insert, update, delete on
  public.suppliers, public.supplier_items, public.supplier_prices,
  public.purchase_orders, public.purchase_order_lines,
  public.purchase_receipts, public.purchase_receipt_lines,
  public.supplier_returns, public.supplier_return_lines,
  public.inventory_lots, public.inventory_balances,
  public.stock_transactions, public.stock_transaction_lines
  to service_role;

-- ── Enable RLS ───────────────────────────────────────────────────────────────
alter table public.suppliers               enable row level security;
alter table public.supplier_items          enable row level security;
alter table public.supplier_prices         enable row level security;
alter table public.purchase_orders         enable row level security;
alter table public.purchase_order_lines    enable row level security;
alter table public.purchase_receipts       enable row level security;
alter table public.purchase_receipt_lines  enable row level security;
alter table public.supplier_returns        enable row level security;
alter table public.supplier_return_lines   enable row level security;
alter table public.inventory_lots          enable row level security;
alter table public.inventory_balances      enable row level security;
alter table public.stock_transactions      enable row level security;
alter table public.stock_transaction_lines enable row level security;

-- ── Policies ─────────────────────────────────────────────────────────────────
-- suppliers / supplier_items: supplier.read / supplier.write
create policy suppliers_select on public.suppliers for select to authenticated
  using (deleted_at is null and public.has_permission(auth.uid(),'supplier.read'));
create policy suppliers_write on public.suppliers for all to authenticated
  using (public.has_permission(auth.uid(),'supplier.write'))
  with check (public.has_permission(auth.uid(),'supplier.write'));
create policy supplier_items_select on public.supplier_items for select to authenticated
  using (public.has_permission(auth.uid(),'supplier.read'));
create policy supplier_items_write on public.supplier_items for all to authenticated
  using (public.has_permission(auth.uid(),'supplier.write'))
  with check (public.has_permission(auth.uid(),'supplier.write'));

-- supplier_prices: read supplier_price.read; write supplier_price.write
create policy supplier_prices_select on public.supplier_prices for select to authenticated
  using (public.has_permission(auth.uid(),'supplier_price.read'));
create policy supplier_prices_write on public.supplier_prices for all to authenticated
  using (public.has_permission(auth.uid(),'supplier_price.write'))
  with check (public.has_permission(auth.uid(),'supplier_price.write'));

-- purchase_orders / lines: read purchase.create OR purchase.receive OR purchase.approve; write purchase.create
create policy po_select on public.purchase_orders for select to authenticated
  using (deleted_at is null and (
    public.has_permission(auth.uid(),'purchase.create') or
    public.has_permission(auth.uid(),'purchase.receive') or
    public.has_permission(auth.uid(),'purchase.approve')));
create policy po_write on public.purchase_orders for all to authenticated
  using (public.has_permission(auth.uid(),'purchase.create'))
  with check (public.has_permission(auth.uid(),'purchase.create'));
create policy po_lines_select on public.purchase_order_lines for select to authenticated
  using (public.has_permission(auth.uid(),'purchase.create') or
         public.has_permission(auth.uid(),'purchase.receive') or
         public.has_permission(auth.uid(),'purchase.approve'));
create policy po_lines_write on public.purchase_order_lines for all to authenticated
  using (public.has_permission(auth.uid(),'purchase.create'))
  with check (public.has_permission(auth.uid(),'purchase.create'));

-- receipts / lines: read+write purchase.receive
create policy receipts_select on public.purchase_receipts for select to authenticated
  using (public.has_permission(auth.uid(),'purchase.receive') or
         public.has_permission(auth.uid(),'purchase.approve'));
create policy receipts_write on public.purchase_receipts for all to authenticated
  using (public.has_permission(auth.uid(),'purchase.receive'))
  with check (public.has_permission(auth.uid(),'purchase.receive'));
create policy receipt_lines_select on public.purchase_receipt_lines for select to authenticated
  using (public.has_permission(auth.uid(),'purchase.receive') or
         public.has_permission(auth.uid(),'purchase.approve'));
create policy receipt_lines_write on public.purchase_receipt_lines for all to authenticated
  using (public.has_permission(auth.uid(),'purchase.receive'))
  with check (public.has_permission(auth.uid(),'purchase.receive'));

-- supplier_returns / lines: supplier.write
create policy returns_select on public.supplier_returns for select to authenticated
  using (public.has_permission(auth.uid(),'supplier.read'));
create policy returns_write on public.supplier_returns for all to authenticated
  using (public.has_permission(auth.uid(),'supplier.write'))
  with check (public.has_permission(auth.uid(),'supplier.write'));
create policy return_lines_select on public.supplier_return_lines for select to authenticated
  using (public.has_permission(auth.uid(),'supplier.read'));
create policy return_lines_write on public.supplier_return_lines for all to authenticated
  using (public.has_permission(auth.uid(),'supplier.write'))
  with check (public.has_permission(auth.uid(),'supplier.write'));

-- lots / balances / ledger: readable with catalog.item.read; NEVER writable via API (definer only)
create policy lots_select on public.inventory_lots for select to authenticated
  using (public.has_permission(auth.uid(),'catalog.item.read'));
create policy balances_select on public.inventory_balances for select to authenticated
  using (public.has_permission(auth.uid(),'catalog.item.read'));
create policy stock_txn_select on public.stock_transactions for select to authenticated
  using (public.has_permission(auth.uid(),'catalog.item.read'));
create policy stock_txn_lines_select on public.stock_transaction_lines for select to authenticated
  using (public.has_permission(auth.uid(),'catalog.item.read'));
-- (no insert/update/delete policies on balances/txn/txn_lines: definer functions only.)

-- ── cost.read-gated cost view ────────────────────────────────────────────────
-- SECURITY DEFINER function returns item cost only to cost.read holders.
create or replace function public.item_cost(p_item uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select case when public.has_permission(auth.uid(),'cost.read')
              then (select weighted_avg_cost from public.inventory_items where id=p_item)
              else null end;
$$;
grant execute on function public.item_cost(uuid) to authenticated, service_role;
```

- [ ] **Step 2: Reset + reseed (RLS changes + new permission need a clean apply)**

Run: `npx supabase db reset && npm run seed:dev`
Expected: all migrations `0001`–`0011` apply; seed prints the 4 dev accounts.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_purchasing_rls.sql
git commit -m "Phase 3b: purchasing RLS, cost-column gates, supplier_price.write"
```

---

### Task 3: Costing library + unit tests

**Files:**

- Create: `lib/purchasing/costing.ts`
- Test: `tests/unit/costing.test.ts`

**Interfaces:**

- Produces: `purchaseCostToBase(unitCost: number, factor: number): number`; `weightedAverage(oldQty: number, oldAvg: number, recvQty: number, recvCost: number): number`. Both round to 4 dp.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/costing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { purchaseCostToBase, weightedAverage } from "@/lib/purchasing/costing";

describe("purchaseCostToBase", () => {
  it("converts a purchase-unit cost to a base-unit cost", () => {
    // ₱1000 per sack, 1 sack = 25 kg → ₱40/kg
    expect(purchaseCostToBase(1000, 25)).toBe(40);
  });
  it("returns the cost unchanged when factor is 1", () => {
    expect(purchaseCostToBase(12.5, 1)).toBe(12.5);
  });
});

describe("weightedAverage — critical scenario 7", () => {
  it("equals the received cost on the first receipt (no prior stock)", () => {
    expect(weightedAverage(0, 0, 100, 40)).toBe(40);
  });
  it("blends prior and received stock", () => {
    // 100 @ 40 + 100 @ 50 = 20000 / 200 = 45
    expect(weightedAverage(100, 40, 100, 50)).toBe(45);
  });
  it("treats negative prior qty as no prior stock", () => {
    expect(weightedAverage(-5, 99, 10, 20)).toBe(20);
  });
  it("rounds to 4 decimal places", () => {
    // (1*3 + 2*4)/3 = 11/3 = 3.6667
    expect(weightedAverage(1, 3, 2, 4)).toBe(3.6667);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/costing.test.ts`
Expected: FAIL — cannot resolve `@/lib/purchasing/costing`.

- [ ] **Step 3: Write the implementation**

Create `lib/purchasing/costing.ts`:

```ts
/**
 * Purchasing cost math — the TypeScript twin of the DB posting logic (migration 0012). The database
 * remains the source of truth for posted amounts; these pure helpers make the math unit-testable and
 * are reused for UI estimates. Critical scenario 7: weighted-average cost updates correctly.
 */

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e4) / 1e4;
}

/** Cost per base unit = purchase-unit cost ÷ (purchase→base conversion factor). */
export function purchaseCostToBase(unitCost: number, factor: number): number {
  if (!factor) return round4(unitCost);
  return round4(unitCost / factor);
}

/**
 * Weighted-average cost after receiving `recvQty` (base units) at `recvCost` (per base unit).
 * First receipt or non-positive prior quantity → the received cost.
 */
export function weightedAverage(
  oldQty: number,
  oldAvg: number,
  recvQty: number,
  recvCost: number,
): number {
  if (oldQty <= 0) return round4(recvCost);
  const total = oldQty + recvQty;
  if (total <= 0) return round4(recvCost);
  return round4((oldQty * oldAvg + recvQty * recvCost) / total);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/costing.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/purchasing/costing.ts tests/unit/costing.test.ts
git commit -m "Phase 3c: purchasing costing lib + unit tests (scenario 7)"
```

---

### Task 4: Posting functions (migration 0012) + integration tests (gate 6 & 7)

**Files:**

- Create: `supabase/migrations/0012_purchasing_functions.sql`
- Test: `tests/integration/purchasing.test.ts`

**Interfaces:**

- Consumes: Task 1 tables, `unit_conversions` (from 0006), `has_permission`.
- Produces SQL fns: `next_po_reference()`, `next_receipt_reference()`, `next_return_reference()`, `next_stock_txn_reference()`, `post_purchase_receipt(uuid)`, `post_supplier_return(uuid)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0012_purchasing_functions.sql`:

```sql
-- 0012_purchasing_functions.sql
-- Reference generators + atomic, idempotent posting functions. These are the ONLY writers of
-- inventory_lots / inventory_balances / stock_transactions. Gate scenarios 6 (only accepted qty
-- posts) and 7 (weighted-average correct).

-- ── Human reference generators (SECURITY DEFINER: no direct sequence USAGE needed) ──
create or replace function public.next_po_reference() returns text
  language sql volatile security definer set search_path=public as $$
  select 'PO-' || to_char(now(),'YYYY') || '-' || lpad(nextval('po_ref_seq')::text,6,'0'); $$;
create or replace function public.next_receipt_reference() returns text
  language sql volatile security definer set search_path=public as $$
  select 'RCV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('receipt_ref_seq')::text,6,'0'); $$;
create or replace function public.next_return_reference() returns text
  language sql volatile security definer set search_path=public as $$
  select 'RET-' || to_char(now(),'YYYY') || '-' || lpad(nextval('return_ref_seq')::text,6,'0'); $$;
create or replace function public.next_stock_txn_reference() returns text
  language sql volatile security definer set search_path=public as $$
  select 'STK-' || to_char(now(),'YYYY') || '-' || lpad(nextval('stock_txn_ref_seq')::text,6,'0'); $$;
grant execute on function public.next_po_reference(), public.next_receipt_reference(),
  public.next_return_reference(), public.next_stock_txn_reference() to authenticated, service_role;

-- ── Base-unit conversion helper: purchase unit → base unit factor for an item ─
-- Returns the factor F such that (qty in from_unit) * F = (qty in base unit). 1 if same unit or
-- an item-specific/global conversion is absent (caller supplies matching units in the MVP).
create or replace function public.unit_factor_to_base(p_item uuid, p_from_unit uuid)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare
  v_base uuid;
  v_factor numeric;
begin
  select base_unit_id into v_base from public.inventory_items where id=p_item;
  if v_base is null then raise exception 'Item % has no base unit', p_item; end if;
  if p_from_unit = v_base then return 1; end if;
  -- item-specific first, then global
  select factor into v_factor from public.unit_conversions
    where item_id=p_item and from_unit_id=p_from_unit and to_unit_id=v_base limit 1;
  if v_factor is not null then return v_factor; end if;
  select factor into v_factor from public.unit_conversions
    where item_id is null and from_unit_id=p_from_unit and to_unit_id=v_base limit 1;
  if v_factor is not null then return v_factor; end if;
  raise exception 'No conversion from unit % to base unit of item %', p_from_unit, p_item;
end; $$;
grant execute on function public.unit_factor_to_base(uuid,uuid) to authenticated, service_role;

-- ── post_purchase_receipt ────────────────────────────────────────────────────
create or replace function public.post_purchase_receipt(p_receipt_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_receipt   public.purchase_receipts%rowtype;
  v_main      uuid;
  v_txn_id    uuid;
  rl          record;
  v_factor    numeric;
  v_base_qty  numeric;
  v_base_cost numeric;
  v_old_qty   numeric;
  v_old_avg   numeric;
  v_outstanding numeric;
begin
  select * into v_receipt from public.purchase_receipts where id=p_receipt_id for update;
  if v_receipt.id is null then raise exception 'Receipt % not found', p_receipt_id; end if;

  -- Idempotency: same key already posted → return the existing txn, do not double-post.
  select id into v_txn_id from public.stock_transactions
    where idempotency_key = v_receipt.idempotency_key;
  if v_txn_id is not null then return v_txn_id; end if;

  select id into v_main from public.branches where is_main and deleted_at is null limit 1;
  if v_main is null then raise exception 'No main branch configured'; end if;

  insert into public.stock_transactions
    (reference, type, status, dest_branch_id, purchase_receipt_id, created_by,
     confirmed_at, idempotency_key, correlation_id)
  values (public.next_stock_txn_reference(), 'purchase_receiving', 'posted', v_main,
     v_receipt.id, v_receipt.received_by, now(), v_receipt.idempotency_key, v_receipt.correlation_id)
  returning id into v_txn_id;

  for rl in
    select prl.*, pol.item_id, pol.unit_id, pol.unit_cost, pol.ordered_qty,
           pol.received_accepted_qty, pol.id as po_line_id
    from public.purchase_receipt_lines prl
    join public.purchase_order_lines pol on pol.id = prl.po_line_id
    where prl.receipt_id = p_receipt_id and prl.accepted_qty > 0
  loop
    -- Over-receipt guard (scenario 6 boundary): accepted ≤ outstanding.
    v_outstanding := rl.ordered_qty - rl.received_accepted_qty;
    if rl.accepted_qty > v_outstanding then
      raise exception 'Over-receipt on PO line %: accepted % exceeds outstanding %',
        rl.po_line_id, rl.accepted_qty, v_outstanding;
    end if;

    v_factor    := public.unit_factor_to_base(rl.item_id, rl.unit_id);
    v_base_qty  := round(rl.accepted_qty * v_factor, 4);
    v_base_cost := round(rl.unit_cost / v_factor, 4);

    insert into public.inventory_lots
      (item_id, branch_id, lot_number, expiration_date, qty_remaining, unit_cost, status)
    values (rl.item_id, v_main, rl.lot_number, rl.expiration_date, v_base_qty, v_base_cost, 'available');

    insert into public.stock_transaction_lines
      (txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot)
    values (v_txn_id, rl.item_id, v_base_qty, rl.unit_id,
      (select id from public.inventory_lots
         where item_id=rl.item_id and branch_id=v_main order by created_at desc limit 1),
      v_base_cost);

    insert into public.inventory_balances (item_id, branch_id, qty_on_hand, updated_at)
    values (rl.item_id, v_main, v_base_qty, now())
    on conflict (item_id, branch_id) do update
      set qty_on_hand = public.inventory_balances.qty_on_hand + excluded.qty_on_hand,
          updated_at = now();

    -- Weighted-average recompute (scenario 7).
    select qty_on_hand into v_old_qty from public.inventory_balances
      where item_id=rl.item_id and branch_id=v_main;
    v_old_qty := coalesce(v_old_qty,0) - v_base_qty;  -- qty BEFORE this receipt
    select weighted_avg_cost into v_old_avg from public.inventory_items where id=rl.item_id;
    update public.inventory_items set
      weighted_avg_cost = case
        when coalesce(v_old_qty,0) <= 0 then v_base_cost
        else round((v_old_qty*coalesce(v_old_avg,0) + v_base_qty*v_base_cost)/(v_old_qty+v_base_qty),4)
      end
    where id = rl.item_id;

    update public.purchase_order_lines
      set received_accepted_qty = received_accepted_qty + rl.accepted_qty
      where id = rl.po_line_id;
  end loop;

  -- PO status transition.
  update public.purchase_orders po set status = case
    when not exists (
      select 1 from public.purchase_order_lines l
      where l.po_id = po.id and l.received_accepted_qty < l.ordered_qty
    ) then 'fully_received'::public.po_status
    else 'partially_received'::public.po_status
  end
  where po.id = v_receipt.po_id;

  update public.purchase_receipts set status='posted' where id=p_receipt_id;
  return v_txn_id;
end; $$;
grant execute on function public.post_purchase_receipt(uuid) to authenticated, service_role;

-- ── post_supplier_return ─────────────────────────────────────────────────────
create or replace function public.post_supplier_return(p_return_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_ret    public.supplier_returns%rowtype;
  v_txn_id uuid;
  rl       record;
  v_lot    public.inventory_lots%rowtype;
begin
  select * into v_ret from public.supplier_returns where id=p_return_id for update;
  if v_ret.id is null then raise exception 'Return % not found', p_return_id; end if;
  select id into v_txn_id from public.stock_transactions where idempotency_key=v_ret.idempotency_key;
  if v_txn_id is not null then return v_txn_id; end if;

  insert into public.stock_transactions
    (reference, type, status, source_branch_id, supplier_return_id, created_by,
     confirmed_at, idempotency_key, correlation_id)
  select public.next_stock_txn_reference(), 'supplier_return', 'posted',
     l.branch_id, v_ret.id, v_ret.created_by, now(), v_ret.idempotency_key, v_ret.correlation_id
  from public.inventory_lots l
  join public.supplier_return_lines srl on srl.lot_id=l.id
  where srl.return_id=p_return_id limit 1
  returning id into v_txn_id;

  for rl in select * from public.supplier_return_lines where return_id=p_return_id loop
    select * into v_lot from public.inventory_lots where id=rl.lot_id for update;
    if v_lot.qty_remaining < rl.qty then
      raise exception 'Return exceeds lot % remaining (% < %)', rl.lot_id, v_lot.qty_remaining, rl.qty;
    end if;
    update public.inventory_lots set qty_remaining = qty_remaining - rl.qty where id=rl.lot_id;
    update public.inventory_balances set qty_on_hand = qty_on_hand - rl.qty, updated_at=now()
      where item_id=rl.item_id and branch_id=v_lot.branch_id;
    insert into public.stock_transaction_lines
      (txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot)
    values (v_txn_id, rl.item_id, -rl.qty,
      (select base_unit_id from public.inventory_items where id=rl.item_id), rl.lot_id, v_lot.unit_cost);
  end loop;

  update public.supplier_returns set status='posted' where id=p_return_id;
  return v_txn_id;
end; $$;
grant execute on function public.post_supplier_return(uuid) to authenticated, service_role;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase migration up`
Expected: `Applying migration 0012_purchasing_functions.sql...` `Migrations applied`.

- [ ] **Step 3: Write the integration tests (gate 6 & 7)**

Create `tests/integration/purchasing.test.ts`. Mirror the fixture pattern from `tests/integration/catalog.test.ts` (same helpers). Full test:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { connect, createUser, assignRole, asUser, cleanupUsers } from "./helpers/db";

const EMAIL_LIKE = "purtest+%@zombeans.test";
let admin: Client, acting: Client;
const ids = {} as { super: string; inventory: string; manager: string };
const fx = {} as { itemId: string; unitKg: string; supplierId: string; siId: string; main: string };

async function newPO(orderedQty: number, unitCost: number) {
  const po = await admin.query(
    `insert into purchase_orders (reference, supplier_id, status, created_by)
     values (public.next_po_reference(), $1, 'approved', $2) returning id`,
    [fx.supplierId, ids.super],
  );
  const line = await admin.query(
    `insert into purchase_order_lines (po_id, item_id, unit_id, ordered_qty, unit_cost, created_by)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [po.rows[0].id, fx.itemId, fx.unitKg, orderedQty, unitCost, ids.super],
  );
  return { poId: po.rows[0].id as string, lineId: line.rows[0].id as string };
}
async function receive(poId: string, lineId: string, accepted: number, key: string) {
  const r = await admin.query(
    `insert into purchase_receipts (reference, po_id, received_by, idempotency_key, created_by)
     values (public.next_receipt_reference(), $1, $2, $3, $2) returning id`,
    [poId, ids.inventory, key],
  );
  await admin.query(
    `insert into purchase_receipt_lines (receipt_id, po_line_id, delivered_qty, accepted_qty)
     values ($1,$2,$3,$3)`,
    [r.rows[0].id, lineId, accepted],
  );
  return r.rows[0].id as string;
}
const avg = async () =>
  Number(
    (await admin.query(`select weighted_avg_cost c from inventory_items where id=$1`, [fx.itemId]))
      .rows[0].c,
  );
const onHand = async () =>
  Number(
    (
      await admin.query(
        `select qty_on_hand q from inventory_balances where item_id=$1 and branch_id=$2`,
        [fx.itemId, fx.main],
      )
    ).rows[0]?.q ?? 0,
  );

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  await cleanupUsers(admin, EMAIL_LIKE);
  await admin.query(`delete from inventory_items where sku like 'PURTEST-%'`);
  ids.super = await createUser(admin, "purtest+super@zombeans.test", { fullName: "P Super" });
  ids.inventory = await createUser(admin, "purtest+inv@zombeans.test", { fullName: "P Inv" });
  ids.manager = await createUser(admin, "purtest+mgr@zombeans.test", { fullName: "P Mgr" });
  await assignRole(admin, ids.super, "super_admin");
  await assignRole(admin, ids.inventory, "inventory");
  await assignRole(admin, ids.manager, "branch_manager");

  fx.main = (await admin.query(`select id from branches where is_main limit 1`)).rows[0].id;
  fx.unitKg = (await admin.query(`select id from units where code='kg'`)).rows[0].id;
  const item = await admin.query(
    `insert into inventory_items (name, sku, item_type, base_unit_id) values
     ('PurTest Beans','PURTEST-1','raw_ingredient',$1) returning id`,
    [fx.unitKg],
  );
  fx.itemId = item.rows[0].id;
  const sup = await admin.query(
    `insert into suppliers (name) values ('PurTest Supplier') returning id`,
  );
  fx.supplierId = sup.rows[0].id;
  const si = await admin.query(
    `insert into supplier_items (supplier_id, item_id) values ($1,$2) returning id`,
    [fx.supplierId, fx.itemId],
  );
  fx.siId = si.rows[0].id;
}, 60_000);

afterAll(async () => {
  await admin.query(`delete from inventory_items where sku like 'PURTEST-%'`);
  await cleanupUsers(admin, EMAIL_LIKE);
  await admin.end();
  await acting.end();
});

describe("scenario 6 — partial delivery posts only accepted quantities", () => {
  it("posts accepted qty, leaves PO partially_received, blocks over-receipt", async () => {
    const { poId, lineId } = await newPO(100, 40);
    const r1 = await receive(poId, lineId, 60, `p6-a-${poId}`);
    await admin.query(`select public.post_purchase_receipt($1)`, [r1]);
    expect(await onHand()).toBe(60);
    let po = await admin.query(`select status from purchase_orders where id=$1`, [poId]);
    expect(po.rows[0].status).toBe("partially_received");

    // Over-receipt: outstanding is 40, try 50 → raises.
    const rOver = await receive(poId, lineId, 50, `p6-over-${poId}`);
    await expect(admin.query(`select public.post_purchase_receipt($1)`, [rOver])).rejects.toThrow(
      /over-receipt/i,
    );

    // Receive the remaining 40 → fully_received.
    const r2 = await receive(poId, lineId, 40, `p6-b-${poId}`);
    await admin.query(`select public.post_purchase_receipt($1)`, [r2]);
    po = await admin.query(`select status from purchase_orders where id=$1`, [poId]);
    expect(po.rows[0].status).toBe("fully_received");
  });
});

describe("scenario 7 — weighted-average updates correctly", () => {
  it("blends costs across receipts and is idempotent", async () => {
    await admin.query(`update inventory_items set weighted_avg_cost=0 where id=$1`, [fx.itemId]);
    await admin.query(`delete from inventory_balances where item_id=$1`, [fx.itemId]);

    const a = await newPO(100, 40);
    const ra = await receive(a.poId, a.lineId, 100, `p7-a-${a.poId}`);
    await admin.query(`select public.post_purchase_receipt($1)`, [ra]);
    expect(await avg()).toBe(40);

    const b = await newPO(100, 50);
    const rb = await receive(b.poId, b.lineId, 100, `p7-b-${b.poId}`);
    await admin.query(`select public.post_purchase_receipt($1)`, [rb]);
    expect(await avg()).toBe(45); // (100*40 + 100*50)/200

    // Idempotent re-post: no double-count.
    const before = await onHand();
    await admin.query(`select public.post_purchase_receipt($1)`, [rb]);
    expect(await onHand()).toBe(before);
    expect(await avg()).toBe(45);
  });
});

describe("cost columns are gated from non-Super users", () => {
  it("inventory staff cannot read unit_cost on PO lines", async () => {
    await expect(
      asUser(acting, ids.inventory, (c) =>
        c.query(`select unit_cost from purchase_order_lines limit 1`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
  it("inventory staff cannot read lot unit_cost", async () => {
    await expect(
      asUser(acting, ids.inventory, (c) => c.query(`select unit_cost from inventory_lots limit 1`)),
    ).rejects.toThrow(/permission denied/i);
  });
  it("supplier_price.write is denied to a manager", async () => {
    await expect(
      asUser(acting, ids.manager, (c) =>
        c.query(`insert into supplier_prices (supplier_item_id, price) values ($1, 9)`, [fx.siId]),
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });
});

describe("supplier return reduces the right lot", () => {
  it("removes qty at the lot cost and leaves weighted-average unchanged", async () => {
    const po = await newPO(10, 40);
    const rc = await receive(po.poId, po.lineId, 10, `ret-seed-${po.poId}`);
    await admin.query(`select public.post_purchase_receipt($1)`, [rc]);
    const lot = await admin.query(
      `select id, qty_remaining from inventory_lots where item_id=$1 order by created_at desc limit 1`,
      [fx.itemId],
    );
    const avgBefore = await avg();
    const ret = await admin.query(
      `insert into supplier_returns (reference, supplier_id, idempotency_key, created_by)
       values (public.next_return_reference(), $1, $2, $3) returning id`,
      [fx.supplierId, `ret-${po.poId}`, ids.super],
    );
    await admin.query(
      `insert into supplier_return_lines (return_id, item_id, lot_id, qty) values ($1,$2,$3,$4)`,
      [ret.rows[0].id, fx.itemId, lot.rows[0].id, 4],
    );
    await admin.query(`select public.post_supplier_return($1)`, [ret.rows[0].id]);
    const after = await admin.query(`select qty_remaining from inventory_lots where id=$1`, [
      lot.rows[0].id,
    ]);
    expect(Number(after.rows[0].qty_remaining)).toBe(Number(lot.rows[0].qty_remaining) - 4);
    expect(await avg()).toBe(avgBefore); // removal doesn't change weighted-average
  });
});
```

- [ ] **Step 4: Run the integration tests**

Run: `npx vitest run tests/integration/purchasing.test.ts`
Expected: PASS (all describes). If a test fails, fix the function in `0012`, then `npx supabase db reset && npm run seed:dev` and re-run.

- [ ] **Step 5: Run the full vitest suite (no regressions)**

Run: `npx vitest run`
Expected: all Phase 1/2/3 unit + integration tests pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0012_purchasing_functions.sql tests/integration/purchasing.test.ts
git commit -m "Phase 3d: posting functions + gate tests (scenarios 6 & 7)"
```

---

### Task 5: Zod validation schemas

**Files:**

- Create: `lib/validation/purchasing.ts`

**Interfaces:**

- Produces: `supplierSchema`, `supplierItemSchema`, `supplierPriceSchema`, `poSchema`, `poLineSchema`, `receiptLineSchema`, `returnLineSchema` with inferred input types. Mirror the style of `lib/validation/catalog.ts` (trimmed strings, `z.coerce.number()`, nullish→null transforms).

- [ ] **Step 1: Write the schemas**

Create `lib/validation/purchasing.ts`:

```ts
import { z } from "zod";

const name = z.string().trim().min(2, "Enter a name").max(160, "Too long");
const nonNeg = z.coerce.number().nonnegative("Cannot be negative");
const pos = z.coerce.number().positive("Must be greater than zero");

export const supplierSchema = z.object({
  name,
  contactName: z.string().trim().max(120).nullish(),
  contactEmail: z.string().trim().email("Invalid email").max(160).nullish().or(z.literal("")),
  contactPhone: z.string().trim().max(40).nullish(),
  leadTimeDays: z.coerce.number().int().min(0).default(0),
  paymentTerms: z.string().trim().max(120).nullish(),
  active: z.boolean().default(true),
});
export type SupplierInput = z.infer<typeof supplierSchema>;

export const supplierItemSchema = z.object({
  supplierId: z.string().uuid(),
  itemId: z.string().uuid("Choose an item"),
  supplierSku: z.string().trim().max(80).nullish(),
  packSize: z.coerce.number().positive().nullish(),
});
export type SupplierItemInput = z.infer<typeof supplierItemSchema>;

export const supplierPriceSchema = z.object({
  supplierItemId: z.string().uuid(),
  price: nonNeg,
  currency: z.string().trim().length(3).default("PHP"),
  effectiveDate: z.string().date().optional(),
});
export type SupplierPriceInput = z.infer<typeof supplierPriceSchema>;

export const poSchema = z.object({
  supplierId: z.string().uuid("Choose a supplier"),
  expectedDate: z.string().date().optional(),
  notes: z.string().trim().max(500).nullish(),
});
export type PoInput = z.infer<typeof poSchema>;

export const poLineSchema = z.object({
  poId: z.string().uuid(),
  itemId: z.string().uuid("Choose an item"),
  unitId: z.string().uuid("Choose a unit"),
  orderedQty: pos,
});
export type PoLineInput = z.infer<typeof poLineSchema>;

export const receiptLineSchema = z.object({
  poLineId: z.string().uuid(),
  deliveredQty: nonNeg,
  acceptedQty: nonNeg,
  rejectedQty: nonNeg.default(0),
  damagedQty: nonNeg.default(0),
  missingQty: nonNeg.default(0),
  expirationDate: z.string().date().optional(),
  lotNumber: z.string().trim().max(60).nullish(),
});
export type ReceiptLineInput = z.infer<typeof receiptLineSchema>;

export const returnLineSchema = z.object({
  itemId: z.string().uuid(),
  lotId: z.string().uuid("Choose a lot"),
  qty: pos,
  reason: z.string().trim().max(200).nullish(),
});
export type ReturnLineInput = z.infer<typeof returnLineSchema>;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/validation/purchasing.ts
git commit -m "Phase 3e: purchasing Zod schemas"
```

---

### Task 6: Suppliers — server actions + UI

**Files:**

- Create: `app/(app)/purchasing/suppliers/actions.ts`
- Create: `app/(app)/purchasing/suppliers/page.tsx`
- Create: `components/purchasing/suppliers-client.tsx`
- Modify: `components/app/nav.ts` (add "Suppliers", href `/purchasing/suppliers`, icon `Truck`, permission `supplier.read`)

**Interfaces:**

- Consumes: `supplierSchema`, `requirePermission`, `writeAudit`, `createClient`.
- Produces: `createSupplierAction`, `updateSupplierAction` (`SupplierActionState = { error?: string; info?: string }`).

- [ ] **Step 1: Write `actions.ts`**

Mirror `app/(app)/admin/branches/actions.ts` exactly, swapping: permission `supplier.write`; table `suppliers`; fields from `supplierSchema` (map `contactEmail` empty-string → null); audit actions `supplier.created` / `supplier.updated`; `revalidatePath("/purchasing/suppliers")`. Full code:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { supplierSchema } from "@/lib/validation/purchasing";

export type SupplierActionState = { error?: string; info?: string };

function parse(formData: FormData) {
  return supplierSchema.safeParse({
    name: formData.get("name"),
    contactName: formData.get("contactName") || null,
    contactEmail: formData.get("contactEmail") || null,
    contactPhone: formData.get("contactPhone") || null,
    leadTimeDays: formData.get("leadTimeDays") || 0,
    paymentTerms: formData.get("paymentTerms") || null,
    active: formData.get("active") === "on",
  });
}
function fields(s: ReturnType<typeof supplierSchema.parse>) {
  return {
    name: s.name,
    contact_name: s.contactName ?? null,
    contact_email: s.contactEmail ? s.contactEmail : null,
    contact_phone: s.contactPhone ?? null,
    lead_time_days: s.leadTimeDays,
    payment_terms: s.paymentTerms ?? null,
    active: s.active,
  };
}

export async function createSupplierAction(
  _p: SupplierActionState,
  fd: FormData,
): Promise<SupplierActionState> {
  const { user } = await requirePermission("supplier.write");
  const parsed = parse(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({ ...fields(parsed.data), created_by: user.id, updated_by: user.id })
    .select("id")
    .single();
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "supplier.created",
    entityType: "supplier",
    entityId: data.id,
    after: parsed.data,
  });
  revalidatePath("/purchasing/suppliers");
  return { info: `Created ${parsed.data.name}.` };
}

export async function updateSupplierAction(
  id: string,
  _p: SupplierActionState,
  fd: FormData,
): Promise<SupplierActionState> {
  const { user } = await requirePermission("supplier.write");
  const parsed = parse(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .update({ ...fields(parsed.data), updated_by: user.id })
    .eq("id", id);
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "supplier.updated",
    entityType: "supplier",
    entityId: id,
    after: parsed.data,
  });
  revalidatePath("/purchasing/suppliers");
  return { info: `Updated ${parsed.data.name}.` };
}
```

- [ ] **Step 2: Write `page.tsx`**

Mirror `app/(app)/admin/branches/page.tsx`: gate `supplier.read`; select `id, name, contact_name, contact_email, contact_phone, lead_time_days, payment_terms, active` from `suppliers` where `deleted_at is null` order by `name`; pass `canWrite = can("supplier.write", ctx.permissions)` and rows to `SuppliersClient`. Header eyebrow "Purchasing", title "Suppliers".

- [ ] **Step 3: Write `suppliers-client.tsx`**

Mirror `components/admin/branches-client.tsx` (same dialog-owns-`useActionState`, close-on-`state.info` pattern). Fields: name, contactName, contactEmail, contactPhone, leadTimeDays (number), paymentTerms, active (checkbox). Table columns: Name, Contact, Lead time, Status, Action(Edit). Empty state: "No suppliers yet." Gate create/edit behind `canWrite`.

- [ ] **Step 4: Add nav entry**

In `components/app/nav.ts` import `Truck` from lucide-react and add:

```ts
{ label: "Suppliers", href: "/purchasing/suppliers", icon: Truck, permission: "supplier.read" },
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx eslint app/\(app\)/purchasing components/purchasing components/app/nav.ts && npm run format`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/purchasing/suppliers components/purchasing/suppliers-client.tsx components/app/nav.ts
git commit -m "Phase 3f: suppliers actions + UI"
```

---

### Task 7: Supplier prices + supplier_items (Super Admin) — actions + UI

**Files:**

- Create: `app/(app)/purchasing/suppliers/[id]/actions.ts`
- Create: `app/(app)/purchasing/suppliers/[id]/page.tsx`
- Create: `components/purchasing/supplier-detail-client.tsx`

**Interfaces:**

- Consumes: `supplierItemSchema`, `supplierPriceSchema`, `requirePermission`.
- Produces: `addSupplierItemAction`, `addSupplierPriceAction`.

- [ ] **Step 1: Write `actions.ts`**

Two actions. `addSupplierItemAction` requires `supplier.write`, inserts into `supplier_items`. `addSupplierPriceAction` requires `supplier_price.write`, inserts into `supplier_prices` (append-only new row). Both bound with the supplier id, audit, `revalidatePath("/purchasing/suppliers/"+id)`. Follow the Task 6 action shape. Full code:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { supplierItemSchema, supplierPriceSchema } from "@/lib/validation/purchasing";

export type DetailActionState = { error?: string; info?: string };

export async function addSupplierItemAction(
  supplierId: string,
  _p: DetailActionState,
  fd: FormData,
): Promise<DetailActionState> {
  const { user } = await requirePermission("supplier.write");
  const parsed = supplierItemSchema.safeParse({
    supplierId,
    itemId: fd.get("itemId"),
    supplierSku: fd.get("supplierSku") || null,
    packSize: fd.get("packSize") || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_items").insert({
    supplier_id: supplierId,
    item_id: parsed.data.itemId,
    supplier_sku: parsed.data.supplierSku ?? null,
    pack_size: parsed.data.packSize ?? null,
    created_by: user.id,
    updated_by: user.id,
  });
  if (error)
    return {
      error: /duplicate/i.test(error.message)
        ? "That item is already linked."
        : error.message.replace(/^.*?:\s*/, ""),
    };
  await writeAudit({
    actorId: user.id,
    action: "supplier_item.added",
    entityType: "supplier",
    entityId: supplierId,
    after: parsed.data,
  });
  revalidatePath(`/purchasing/suppliers/${supplierId}`);
  return { info: "Item linked." };
}

export async function addSupplierPriceAction(
  supplierId: string,
  _p: DetailActionState,
  fd: FormData,
): Promise<DetailActionState> {
  const { user } = await requirePermission("supplier_price.write");
  const parsed = supplierPriceSchema.safeParse({
    supplierItemId: fd.get("supplierItemId"),
    price: fd.get("price"),
    currency: fd.get("currency") || "PHP",
    effectiveDate: fd.get("effectiveDate") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const row: Record<string, unknown> = {
    supplier_item_id: parsed.data.supplierItemId,
    price: parsed.data.price,
    currency: parsed.data.currency,
    created_by: user.id,
  };
  if (parsed.data.effectiveDate) row.effective_date = parsed.data.effectiveDate;
  const { error } = await supabase.from("supplier_prices").insert(row);
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "supplier_price.added",
    entityType: "supplier_item",
    entityId: parsed.data.supplierItemId,
    after: { price: parsed.data.price },
  });
  revalidatePath(`/purchasing/suppliers/${supplierId}`);
  return { info: "Price recorded." };
}
```

- [ ] **Step 2: Write `page.tsx`**

Server component (`params: Promise<{ id: string }>` — Next 15 async params). Gate `supplier.read`. Fetch the supplier; its `supplier_items` joined to `inventory_items(name, sku)`; per supplier_item the latest `supplier_prices` (only if `can("supplier_price.read")` — omit price otherwise); the list of `inventory_items` for the "link item" dropdown. Pass `canManagePrice = can("supplier_price.write")`. Render `SupplierDetailClient`.

- [ ] **Step 3: Write `supplier-detail-client.tsx`**

Two dialogs (link item; add price) using the branches-client dialog pattern. Show a table of linked items with their current price (`formatPeso`) — column shown only when `canReadPrice`. The add-price dialog is rendered only when `canManagePrice`.

- [ ] **Step 4: Verify + commit**

```bash
npx tsc --noEmit && npm run lint && npm run format
git add app/\(app\)/purchasing/suppliers/\[id\] components/purchasing/supplier-detail-client.tsx
git commit -m "Phase 3g: supplier items + price history UI"
```

---

### Task 8: Purchase orders — actions + UI

**Files:**

- Create: `app/(app)/purchasing/orders/actions.ts`
- Create: `app/(app)/purchasing/orders/page.tsx`
- Create: `app/(app)/purchasing/orders/[id]/page.tsx`
- Create: `components/purchasing/orders-client.tsx`
- Create: `components/purchasing/order-detail-client.tsx`
- Modify: `components/app/nav.ts` (add "Purchase orders", `/purchasing/orders`, icon `ClipboardList`, permission `purchase.create`)

**Interfaces:**

- Consumes: `poSchema`, `poLineSchema`, `requirePermission`.
- Produces: `createPoAction`, `addPoLineAction`, `submitPoAction`, `approvePoAction`, `setPaymentStatusAction`.

- [ ] **Step 1: Write `actions.ts`**

- `createPoAction` (`purchase.create`): generate reference via `supabase.rpc("next_po_reference")`; insert `purchase_orders` (status draft). Audit `po.created`.
- `addPoLineAction(poId)` (`purchase.create`): resolve current supplier price → auto-fill `unit_cost`. Look up the supplier_item for `(po.supplier_id, itemId)` then its latest `supplier_prices.price`; if none, `unit_cost = 0`. Insert `purchase_order_lines` with `unit_cost` set via the **service-role admin client** (`createAdminClient()`) because `authenticated` has no grant on the `unit_cost` column (cost is server-only). Recompute PO `subtotal/total` with the admin client. Audit `po.line.added`.
- `submitPoAction(poId)` (`purchase.create`): status draft→submitted.
- `approvePoAction(poId)` (`purchase.approve`): status submitted→approved, set `approved_by/approved_at`. Audit `po.approved`.
- `setPaymentStatusAction(poId, status)` (`purchase.approve`): update `payment_status`. Audit `po.payment.updated`.

Full code:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { poSchema, poLineSchema } from "@/lib/validation/purchasing";

export type PoActionState = { error?: string; info?: string };
const PAYMENT = ["unpaid", "partially_paid", "paid", "overdue", "cancelled", "refunded"] as const;

export async function createPoAction(_p: PoActionState, fd: FormData): Promise<PoActionState> {
  const { user } = await requirePermission("purchase.create");
  const parsed = poSchema.safeParse({
    supplierId: fd.get("supplierId"),
    expectedDate: fd.get("expectedDate") || undefined,
    notes: fd.get("notes") || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const supabase = await createClient();
  const { data: ref } = await supabase.rpc("next_po_reference");
  const row: Record<string, unknown> = {
    reference: ref as string,
    supplier_id: parsed.data.supplierId,
    status: "draft",
    notes: parsed.data.notes ?? null,
    created_by: user.id,
    updated_by: user.id,
  };
  if (parsed.data.expectedDate) row.expected_date = parsed.data.expectedDate;
  const { data, error } = await supabase.from("purchase_orders").insert(row).select("id").single();
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "po.created",
    entityType: "purchase_order",
    entityId: data.id,
    after: { reference: ref },
  });
  revalidatePath("/purchasing/orders");
  return { info: `Created ${ref}.` };
}

export async function addPoLineAction(
  poId: string,
  _p: PoActionState,
  fd: FormData,
): Promise<PoActionState> {
  const { user } = await requirePermission("purchase.create");
  const parsed = poLineSchema.safeParse({
    poId,
    itemId: fd.get("itemId"),
    unitId: fd.get("unitId"),
    orderedQty: fd.get("orderedQty"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  // Cost lookup + write uses the service role (unit_cost/subtotal/total are server-only columns).
  const admin = createAdminClient();
  const { data: po } = await admin
    .from("purchase_orders")
    .select("supplier_id")
    .eq("id", poId)
    .single();
  if (!po) return { error: "PO not found." };
  const { data: si } = await admin
    .from("supplier_items")
    .select("id")
    .eq("supplier_id", po.supplier_id)
    .eq("item_id", parsed.data.itemId)
    .maybeSingle();
  let unitCost = 0;
  if (si) {
    const { data: price } = await admin
      .from("supplier_prices")
      .select("price")
      .eq("supplier_item_id", si.id)
      .order("effective_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    unitCost = price ? Number(price.price) : 0;
  }
  const { error } = await admin.from("purchase_order_lines").insert({
    po_id: poId,
    item_id: parsed.data.itemId,
    unit_id: parsed.data.unitId,
    ordered_qty: parsed.data.orderedQty,
    unit_cost: unitCost,
    created_by: user.id,
    updated_by: user.id,
  });
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  // Recompute totals.
  const { data: lines } = await admin
    .from("purchase_order_lines")
    .select("ordered_qty, unit_cost")
    .eq("po_id", poId);
  const subtotal = (lines ?? []).reduce(
    (s, l) => s + Number(l.ordered_qty) * Number(l.unit_cost),
    0,
  );
  await admin
    .from("purchase_orders")
    .update({ subtotal, total: subtotal, updated_by: user.id })
    .eq("id", poId);
  await writeAudit({
    actorId: user.id,
    action: "po.line.added",
    entityType: "purchase_order",
    entityId: poId,
    after: { itemId: parsed.data.itemId, orderedQty: parsed.data.orderedQty },
  });
  revalidatePath(`/purchasing/orders/${poId}`);
  return { info: "Line added." };
}

export async function submitPoAction(poId: string): Promise<PoActionState> {
  const { user } = await requirePermission("purchase.create");
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ status: "submitted", updated_by: user.id })
    .eq("id", poId)
    .eq("status", "draft");
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "po.submitted",
    entityType: "purchase_order",
    entityId: poId,
  });
  revalidatePath(`/purchasing/orders/${poId}`);
  return { info: "Submitted for approval." };
}

export async function approvePoAction(poId: string): Promise<PoActionState> {
  const { user } = await requirePermission("purchase.approve");
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({
      status: "approved",
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", poId)
    .eq("status", "submitted");
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "po.approved",
    entityType: "purchase_order",
    entityId: poId,
  });
  revalidatePath(`/purchasing/orders/${poId}`);
  return { info: "Approved." };
}

export async function setPaymentStatusAction(poId: string, status: string): Promise<PoActionState> {
  const { user } = await requirePermission("purchase.approve");
  if (!(PAYMENT as readonly string[]).includes(status)) return { error: "Invalid status." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("purchase_orders")
    .update({ payment_status: status, updated_by: user.id })
    .eq("id", poId);
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  await writeAudit({
    actorId: user.id,
    action: "po.payment.updated",
    entityType: "purchase_order",
    entityId: poId,
    after: { status },
  });
  revalidatePath(`/purchasing/orders/${poId}`);
  return { info: "Payment status updated." };
}
```

- [ ] **Step 2: Write `orders/page.tsx`** (list)

Gate `purchase.create OR purchase.approve OR purchase.receive` (use `can` for any). Select `id, reference, status, payment_status, expected_date, supplier:suppliers(name)` order by `created_at desc`. Render `OrdersClient` with a create dialog (supplier dropdown from `suppliers`), gated behind `purchase.create`.

- [ ] **Step 3: Write `orders/[id]/page.tsx`** (detail)

Async params. Fetch the PO + lines joined to `inventory_items(name, sku)` and `units(code)`. Show cost columns only when `can("cost.read")` (query `unit_cost` via the admin client in the server component when permitted; otherwise omit). Pass action availability flags. Render `OrderDetailClient` with: add-line dialog (item + unit + qty; gated `purchase.create`, only in draft), Submit (draft), Approve (submitted, `purchase.approve`), payment-status control (`purchase.approve`).

- [ ] **Step 4: Write the two client components**

Follow the products-client dialog pattern. `OrdersClient`: table + create dialog. `OrderDetailClient`: line table, status badges, action buttons wired to the actions via `useTransition`/`useActionState`.

- [ ] **Step 5: Add nav + verify + commit**

```bash
# nav.ts: import ClipboardList; add { label: "Purchase orders", href: "/purchasing/orders", icon: ClipboardList, permission: "purchase.create" }
npx tsc --noEmit && npm run lint && npm run format
git add app/\(app\)/purchasing/orders components/purchasing/orders-client.tsx components/purchasing/order-detail-client.tsx components/app/nav.ts
git commit -m "Phase 3h: purchase orders actions + UI"
```

---

### Task 9: Receiving — actions + UI + review queue

**Files:**

- Create: `app/(app)/purchasing/receiving/actions.ts`
- Create: `app/(app)/purchasing/receiving/page.tsx`
- Create: `app/(app)/purchasing/receiving/[poId]/page.tsx`
- Create: `components/purchasing/receiving-client.tsx`
- Modify: `components/app/nav.ts` (add "Receiving", `/purchasing/receiving`, icon `PackageCheck`, permission `purchase.receive`)

**Interfaces:**

- Consumes: `receiptLineSchema`, `requirePermission`, `crypto.randomUUID` for the idempotency key.
- Produces: `submitReceiptAction(poId, prev, formData)`.

- [ ] **Step 1: Write `actions.ts`**

`submitReceiptAction` (`purchase.receive`): reads accepted/rejected/damaged/missing/expiry/lot per PO line from the form; creates a `purchase_receipts` row (reference via `rpc next_receipt_reference`; `idempotency_key = crypto.randomUUID()`; set `has_shortage/has_damage/needs_review` from the inputs); inserts `purchase_receipt_lines`; then calls `supabase.rpc("post_purchase_receipt", { p_receipt_id })`. On the definer function raising (e.g. over-receipt), return the error string. Audit `receipt.posted`. Full code:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

export type ReceiveActionState = { error?: string; info?: string };
const num = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? Number(s) : 0;
};

export async function submitReceiptAction(
  poId: string,
  _p: ReceiveActionState,
  fd: FormData,
): Promise<ReceiveActionState> {
  const { user } = await requirePermission("purchase.receive");
  const supabase = await createClient();

  const { data: lines, error: linesErr } = await supabase
    .from("purchase_order_lines")
    .select("id, ordered_qty, received_accepted_qty")
    .eq("po_id", poId);
  if (linesErr || !lines?.length) return { error: "Could not load the order lines." };

  const parsed = lines.map((l) => ({
    poLineId: l.id as string,
    accepted: num(fd.get(`accepted_${l.id}`)),
    rejected: num(fd.get(`rejected_${l.id}`)),
    damaged: num(fd.get(`damaged_${l.id}`)),
    missing: num(fd.get(`missing_${l.id}`)),
    delivered:
      num(fd.get(`accepted_${l.id}`)) +
      num(fd.get(`rejected_${l.id}`)) +
      num(fd.get(`damaged_${l.id}`)),
    lot: (fd.get(`lot_${l.id}`) as string) || null,
    expiry: (fd.get(`expiry_${l.id}`) as string) || null,
    outstanding: Number(l.ordered_qty) - Number(l.received_accepted_qty),
  }));
  if (
    parsed.every((p) => p.accepted === 0 && p.rejected === 0 && p.damaged === 0 && p.missing === 0)
  )
    return { error: "Enter at least one received quantity." };

  const hasDamage = parsed.some((p) => p.damaged > 0);
  const hasShortage = parsed.some((p) => p.missing > 0 || p.accepted < p.outstanding);

  const { data: ref } = await supabase.rpc("next_receipt_reference");
  const idempotencyKey = crypto.randomUUID();
  const { data: receipt, error: rErr } = await supabase
    .from("purchase_receipts")
    .insert({
      reference: ref as string,
      po_id: poId,
      received_by: user.id,
      idempotency_key: idempotencyKey,
      has_damage: hasDamage,
      has_shortage: hasShortage,
      needs_review: hasDamage || hasShortage,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (rErr) return { error: rErr.message.replace(/^.*?:\s*/, "") };

  const { error: rlErr } = await supabase.from("purchase_receipt_lines").insert(
    parsed
      .filter((p) => p.delivered > 0 || p.missing > 0)
      .map((p) => ({
        receipt_id: receipt.id,
        po_line_id: p.poLineId,
        delivered_qty: p.delivered,
        accepted_qty: p.accepted,
        rejected_qty: p.rejected,
        damaged_qty: p.damaged,
        missing_qty: p.missing,
        lot_number: p.lot,
        expiration_date: p.expiry,
      })),
  );
  if (rlErr) return { error: rlErr.message.replace(/^.*?:\s*/, "") };

  const { error: postErr } = await supabase.rpc("post_purchase_receipt", {
    p_receipt_id: receipt.id,
  });
  if (postErr) return { error: postErr.message.replace(/^.*?:\s*/, "") };

  await writeAudit({
    actorId: user.id,
    action: "receipt.posted",
    entityType: "purchase_receipt",
    entityId: receipt.id,
    after: { reference: ref },
  });
  revalidatePath("/purchasing/receiving");
  revalidatePath(`/purchasing/orders/${poId}`);
  return { info: `Received ${ref}.` };
}
```

- [ ] **Step 2: Write `receiving/page.tsx`**

Gate `purchase.receive`. List approved / partially_received POs (`purchase_orders` where status in those) with supplier name and a "Receive" link to `/purchasing/receiving/[poId]`.

- [ ] **Step 3: Write `receiving/[poId]/page.tsx`**

Async params. Gate `purchase.receive`. Fetch the PO lines joined to `inventory_items(name, sku)` and `units(code)` with `ordered_qty` and `received_accepted_qty` (NOT cost — receiver never sees cost). Render `ReceivingClient` with a per-line row: accepted / rejected / damaged / missing inputs + lot + expiry. Submit → `submitReceiptAction`.

- [ ] **Step 4: Write `receiving-client.tsx`**

One form (not a dialog) with a row per PO line showing outstanding = ordered − received. Number inputs and lot/expiry per line. Submit button wired via `useActionState`. Show the returned error/info via `toast`.

- [ ] **Step 5: Add nav + verify + commit**

```bash
# nav.ts: import PackageCheck; add { label: "Receiving", href: "/purchasing/receiving", icon: PackageCheck, permission: "purchase.receive" }
npx tsc --noEmit && npm run lint && npm run format
git add app/\(app\)/purchasing/receiving components/purchasing/receiving-client.tsx components/app/nav.ts
git commit -m "Phase 3i: receiving actions + UI"
```

---

### Task 10: Supplier returns — actions + UI

**Files:**

- Create: `app/(app)/purchasing/returns/actions.ts`
- Create: `app/(app)/purchasing/returns/page.tsx`
- Create: `components/purchasing/returns-client.tsx`
- Modify: `components/app/nav.ts` (add "Returns", `/purchasing/returns`, icon `Undo2`, permission `supplier.write`)

**Interfaces:**

- Consumes: `returnLineSchema`, `requirePermission`.
- Produces: `createReturnAction`.

- [ ] **Step 1: Write `actions.ts`**

`createReturnAction` (`supplier.write`): create a `supplier_returns` row (reference via `rpc next_return_reference`, `idempotency_key = crypto.randomUUID()`, supplier from form); insert `supplier_return_lines` for each selected lot+qty; call `supabase.rpc("post_supplier_return", { p_return_id })`. Return the error string if the definer function raises (e.g. qty exceeds lot). Audit `return.posted`. Follow the Task 9 action shape (create rows then call the rpc).

- [ ] **Step 2: Write `page.tsx`**

Gate `supplier.read`. List suppliers (for the create dropdown) and available lots (`inventory_lots` where `qty_remaining > 0 and status='available'`, joined to `inventory_items(name, sku)`). List recent returns. Render `ReturnsClient` (create gated behind `supplier.write`).

- [ ] **Step 3: Write `returns-client.tsx`**

Create dialog: pick supplier, add lines (lot dropdown showing item name + lot + remaining qty, qty input, reason). Submit → `createReturnAction`. Table of recent returns with reference + status.

- [ ] **Step 4: Add nav + verify + commit**

```bash
# nav.ts: import Undo2; add { label: "Returns", href: "/purchasing/returns", icon: Undo2, permission: "supplier.write" }
npx tsc --noEmit && npm run lint && npm run format
git add app/\(app\)/purchasing/returns components/purchasing/returns-client.tsx components/app/nav.ts
git commit -m "Phase 3j: supplier returns actions + UI"
```

---

### Task 11: e2e, docs, phase report, full verification

**Files:**

- Create: `tests/e2e/purchasing.spec.ts`
- Modify: `docs/CHANGELOG.md`, `docs/ASSUMPTIONS.md`
- Create: `docs/reports/PHASE_3.md`
- Modify: `components/app/sidebar.tsx` (footer label "Phase 2" → "Phase 3")

- [ ] **Step 1: Write `tests/e2e/purchasing.spec.ts`**

Viewport-agnostic permission gating (mirror `tests/e2e/catalog.spec.ts`; use the same `login` helper). Tests:

1. Inventory staff: `/purchasing/receiving` heading visible; `/purchasing/suppliers` redirects to `/dashboard` (no `supplier.read`).
2. Inventory staff: `/purchasing/orders/<any>` — cannot see cost (assert no "Unit cost" column text). Use a seeded/known route or skip if no data — prefer asserting `/purchasing/suppliers` redirect and receiving-page access only.
3. Manager: `/purchasing/orders` heading visible; `/purchasing/receiving` redirects to `/dashboard` (no `purchase.receive`).
4. Desktop-only: sidebar shows "Suppliers"/"Purchase orders" per permission (skip on mobile as in catalog.spec).

Note: `manager@zombeans.dev` has `supplier.read`, `purchase.create`, but not `purchase.receive`; `inventory@zombeans.dev` has `purchase.receive` but not `supplier.read`/`purchase.create`. Assert accordingly.

- [ ] **Step 2: Run e2e**

Run: `npx playwright test tests/e2e/purchasing.spec.ts`
Expected: pass on chromium + mobile (desktop-only test skipped on mobile).

- [ ] **Step 3: Update docs**

- `docs/CHANGELOG.md`: add a "Phase 3 — Ingredients, Suppliers & Purchasing — 2026-07-11" section under `[Unreleased]` (Added / Tests / Gate), mirroring the Phase 2 entry.
- `docs/ASSUMPTIONS.md`: add a "Phase 3 additions" table with A-021..A-024 (global-per-item weighted-average; returns remove at lot cost, avg unchanged; receiving posts at expected PO cost with Super-Admin correction for invoice diffs; `supplier_price.write` added to the catalog).
- `docs/reports/PHASE_3.md`: end-of-phase report (completed work, files, migrations 0010–0012, tests added/passed, gate 6 & 7, known limitations, security, next phase = Phase 4 Recipes & Costing).

- [ ] **Step 4: Full CI verification**

Run: `npm run format && npm run format:check && npm run lint && npm run typecheck && npm run test && npm run build && npm run scan:bundle`
Expected: every step passes. Then run the DB-backed suites: `npm run test:integration` and `npx playwright test`.
Expected: all pass.

- [ ] **Step 5: Commit + finish**

```bash
git add -A
git commit -m "Phase 3k: purchasing e2e + docs + phase report"
```

Then invoke `superpowers:finishing-a-development-branch` to push and open the PR into `main`.

---

## Self-review notes (author)

- **Spec coverage:** suppliers/items/prices (Tasks 6–7), POs + auto-cost (Task 8), partial receiving + posting (Tasks 4, 9), supplier returns (Tasks 4, 10), payment status (Task 8), ledger core + weighted-average (Tasks 1, 4), cost gates + `supplier_price.write` (Task 2), gate scenarios 6 & 7 (Task 4), e2e + docs (Task 11). All spec §1–§9 items map to a task.
- **Sensitive-cost rule:** every cost column granted by column-list omission; PO-line `unit_cost` writes/reads go through the admin (service-role) client in actions; receiver UI never selects cost.
- **Idempotency:** receipts/returns carry a unique `idempotency_key`; the posting functions no-op on a repeat key (tested).
- **Over-receipt:** blocked in `post_purchase_receipt` and covered by the scenario-6 test.
- **Type consistency:** action state types (`SupplierActionState`, `PoActionState`, `ReceiveActionState`, etc.) and function names are referenced consistently across tasks; RPC param name `p_receipt_id` / `p_return_id` matches the SQL signatures.
