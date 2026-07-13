-- 0020_phase6_stock_schema.sql
-- Phase 6 — stock requests, branch transfers, discrepancies, and negative-inventory alerts.
-- RLS/grants in 0021; atomic posting functions in 0022.

create type public.stock_request_status as enum
  ('requested', 'approved', 'rejected', 'fulfilled', 'cancelled');
create type public.transfer_status as enum
  ('prepared', 'in_transit', 'received', 'cancelled');
create type public.transfer_discrepancy_type as enum
  ('rejected', 'damaged', 'missing');
create type public.transfer_discrepancy_status as enum
  ('open', 'resolved');
create type public.inventory_alert_status as enum
  ('active', 'resolved');

create sequence if not exists public.stock_request_ref_seq as bigint start 1;
create sequence if not exists public.transfer_ref_seq as bigint start 1;

create table public.stock_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  requesting_branch_id uuid not null references public.branches(id) on delete restrict,
  status public.stock_request_status not null default 'requested',
  notes text,
  requested_by uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  version integer not null default 1,
  constraint stock_requests_review_consistent check (
    (status = 'requested' and reviewed_by is null and reviewed_at is null)
    or status in ('cancelled')
    or (status in ('approved', 'rejected', 'fulfilled') and reviewed_by is not null and reviewed_at is not null)
  )
);
create index stock_requests_branch_status
  on public.stock_requests(requesting_branch_id, status, created_at desc);

create table public.stock_request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.stock_requests(id) on delete restrict,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  requested_qty numeric(14,4) not null,
  approved_qty numeric(14,4) not null default 0,
  created_at timestamptz not null default now(),
  constraint stock_request_lines_requested_pos check (requested_qty > 0),
  constraint stock_request_lines_approved_range check (
    approved_qty >= 0 and approved_qty <= requested_qty
  ),
  unique (request_id, item_id)
);
create index stock_request_lines_request on public.stock_request_lines(request_id);

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  stock_request_id uuid references public.stock_requests(id) on delete restrict,
  source_branch_id uuid not null references public.branches(id) on delete restrict,
  dest_branch_id uuid not null references public.branches(id) on delete restrict,
  status public.transfer_status not null default 'prepared',
  notes text,
  idempotency_key text not null unique,
  receive_idempotency_key text unique,
  correlation_id uuid not null default gen_random_uuid(),
  prepared_by uuid not null references public.profiles(id),
  prepared_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  received_by uuid references public.profiles(id),
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint transfers_distinct_branches check (source_branch_id <> dest_branch_id),
  constraint transfers_lifecycle_consistent check (
    (status = 'prepared' and approved_by is null and approved_at is null
      and received_by is null and received_at is null)
    or (status = 'in_transit' and approved_by is not null and approved_at is not null
      and received_by is null and received_at is null)
    or (status = 'received' and approved_by is not null and approved_at is not null
      and received_by is not null and received_at is not null and receive_idempotency_key is not null)
    or status = 'cancelled'
  )
);
create index transfers_status_created on public.transfers(status, created_at desc);
create index transfers_source on public.transfers(source_branch_id, status);
create index transfers_dest on public.transfers(dest_branch_id, status);
create unique index transfers_one_per_request
  on public.transfers(stock_request_id) where stock_request_id is not null and status <> 'cancelled';

create table public.transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers(id) on delete restrict,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  prepared_qty numeric(14,4) not null,
  shipped_qty numeric(14,4) not null default 0,
  received_qty numeric(14,4) not null default 0,
  rejected_qty numeric(14,4) not null default 0,
  damaged_qty numeric(14,4) not null default 0,
  missing_qty numeric(14,4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transfer_lines_prepared_pos check (prepared_qty > 0),
  constraint transfer_lines_quantities_valid check (
    shipped_qty >= 0 and shipped_qty <= prepared_qty
    and received_qty >= 0 and rejected_qty >= 0 and damaged_qty >= 0 and missing_qty >= 0
    and received_qty + rejected_qty + damaged_qty + missing_qty <= shipped_qty
  ),
  unique (transfer_id, item_id)
);
create index transfer_lines_transfer on public.transfer_lines(transfer_id);

create table public.transfer_lot_allocations (
  id uuid primary key default gen_random_uuid(),
  transfer_line_id uuid not null references public.transfer_lines(id) on delete restrict,
  source_lot_id uuid not null references public.inventory_lots(id) on delete restrict,
  destination_lot_id uuid references public.inventory_lots(id) on delete restrict,
  allocated_qty numeric(14,4) not null,
  received_qty numeric(14,4) not null default 0,
  unit_cost_snapshot numeric(14,4) not null,
  lot_number text,
  received_date date not null,
  expiration_date date,
  created_at timestamptz not null default now(),
  constraint transfer_allocations_qty_pos check (allocated_qty > 0),
  constraint transfer_allocations_received_range check (
    received_qty >= 0 and received_qty <= allocated_qty
  ),
  unique (transfer_line_id, source_lot_id)
);
create index transfer_lot_allocations_line on public.transfer_lot_allocations(transfer_line_id);

create table public.transfer_discrepancies (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers(id) on delete restrict,
  transfer_line_id uuid not null references public.transfer_lines(id) on delete restrict,
  type public.transfer_discrepancy_type not null,
  qty numeric(14,4) not null,
  reason text not null,
  status public.transfer_discrepancy_status not null default 'open',
  resolution text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  constraint transfer_discrepancies_qty_pos check (qty > 0),
  constraint transfer_discrepancies_reason_nonblank check (length(btrim(reason)) > 0),
  constraint transfer_discrepancies_resolution_consistent check (
    (status = 'open' and resolution is null and resolved_by is null and resolved_at is null)
    or (status = 'resolved' and resolution is not null and resolved_by is not null and resolved_at is not null)
  ),
  unique (transfer_line_id, type)
);
create index transfer_discrepancies_transfer_status
  on public.transfer_discrepancies(transfer_id, status);

alter table public.stock_transactions
  add column transfer_id uuid references public.transfers(id) on delete restrict;
create index stock_txn_transfer on public.stock_transactions(transfer_id)
  where transfer_id is not null;

alter table public.transfers
  add column source_txn_id uuid references public.stock_transactions(id) on delete restrict,
  add column receive_txn_id uuid references public.stock_transactions(id) on delete restrict;

create table public.inventory_alerts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  severity text not null default 'critical',
  status public.inventory_alert_status not null default 'active',
  qty_on_hand numeric(14,4) not null,
  cause_txn_id uuid not null references public.stock_transactions(id) on delete restrict,
  reason text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  resolution text,
  constraint inventory_alerts_critical_only check (severity = 'critical'),
  constraint inventory_alerts_negative_only check (qty_on_hand < 0),
  constraint inventory_alerts_reason_nonblank check (length(btrim(reason)) > 0),
  constraint inventory_alerts_resolution_consistent check (
    (status = 'active' and resolution is null and resolved_by is null and resolved_at is null)
    or (status = 'resolved' and resolution is not null and resolved_by is not null and resolved_at is not null)
  ),
  unique (cause_txn_id, item_id, branch_id)
);
create index inventory_alerts_active
  on public.inventory_alerts(branch_id, created_at desc) where status = 'active';
create index inventory_alerts_item_branch
  on public.inventory_alerts(item_id, branch_id, status);

create trigger set_updated_at before update on public.stock_requests
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.transfers
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.transfer_lines
  for each row execute function public.tg_set_updated_at();
