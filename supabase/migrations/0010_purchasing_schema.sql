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
