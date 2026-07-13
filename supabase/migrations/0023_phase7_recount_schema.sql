-- 0023_phase7_recount_schema.sql
-- Phase 7 — recount sessions, variance adjustments, and daily operational close state.
-- RLS/grants are in 0024; atomic functions are in 0025.

create type public.recount_session_type as enum
  ('start_of_day', 'end_of_day', 'cycle');
create type public.recount_session_status as enum
  ('draft', 'submitted', 'adjusted', 'closed');
create type public.recount_adjustment_reason as enum
  ('counting_error', 'unrecorded_movement', 'spoilage', 'damage', 'theft_or_loss',
   'found_stock', 'unit_conversion', 'other');
create type public.day_close_status as enum ('closed', 'reopened');
create type public.day_close_event_type as enum ('close', 'reopen');

create sequence if not exists public.recount_ref_seq as bigint start 1;
create sequence if not exists public.recount_adjustment_ref_seq as bigint start 1;
create sequence if not exists public.day_close_ref_seq as bigint start 1;
create sequence if not exists public.day_close_event_ref_seq as bigint start 1;

-- One mutable current-state row per branch/business date. Every transition is also recorded in the
-- append-only day_close_events table below.
create table public.daily_operational_closures (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  branch_id uuid not null references public.branches(id) on delete restrict,
  business_date date not null,
  status public.day_close_status not null default 'closed',
  close_count integer not null default 1,
  reopen_count integer not null default 0,
  last_closed_by uuid not null references public.profiles(id),
  last_closed_at timestamptz not null default now(),
  last_reopened_by uuid references public.profiles(id),
  last_reopened_at timestamptz,
  latest_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint daily_closures_counts_valid check (
    close_count >= 1 and reopen_count >= 0 and reopen_count <= close_count
  ),
  constraint daily_closures_reopen_consistent check (
    (status = 'closed' and (
      last_reopened_at is null or last_closed_at > last_reopened_at
    ))
    or
    (status = 'reopened' and last_reopened_by is not null and last_reopened_at is not null
      and last_reopened_at >= last_closed_at)
  ),
  unique (branch_id, business_date)
);
create index daily_closures_branch_status
  on public.daily_operational_closures(branch_id, status, business_date desc);

create table public.day_close_events (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  closure_id uuid not null references public.daily_operational_closures(id) on delete restrict,
  event_type public.day_close_event_type not null,
  idempotency_key text not null unique,
  reason text,
  actor_id uuid not null references public.profiles(id),
  audit_log_id uuid not null unique references public.audit_logs(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint day_close_events_key_nonblank check (length(btrim(idempotency_key)) > 0),
  constraint day_close_events_reason_consistent check (
    (event_type = 'reopen' and reason is not null and length(btrim(reason)) >= 3)
    or event_type = 'close'
  )
);
create index day_close_events_closure_time
  on public.day_close_events(closure_id, created_at desc);

alter table public.daily_operational_closures
  add constraint daily_closures_latest_event_fkey
  foreign key (latest_event_id) references public.day_close_events(id) on delete restrict;

create table public.recount_sessions (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  branch_id uuid not null references public.branches(id) on delete restrict,
  business_date date not null,
  type public.recount_session_type not null,
  status public.recount_session_status not null default 'draft',
  snapshot_at timestamptz not null default now(),
  open_idempotency_key text not null unique,
  submit_idempotency_key text unique,
  is_unusual boolean not null default false,
  unusual_signals text[] not null default '{}'::text[],
  opened_by uuid not null references public.profiles(id),
  opened_at timestamptz not null default now(),
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  adjusted_by uuid references public.profiles(id),
  adjusted_at timestamptz,
  day_reopen_event_id uuid references public.day_close_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint recount_sessions_open_key_nonblank check (length(btrim(open_idempotency_key)) > 0),
  constraint recount_sessions_signals_nonnull check (array_position(unusual_signals, null) is null),
  constraint recount_sessions_lifecycle_consistent check (
    (status = 'draft' and submit_idempotency_key is null
      and submitted_by is null and submitted_at is null
      and adjusted_by is null and adjusted_at is null)
    or
    (status = 'submitted' and submit_idempotency_key is not null
      and submitted_by is not null and submitted_at is not null
      and adjusted_by is null and adjusted_at is null)
    or
    (status = 'adjusted' and submit_idempotency_key is not null
      and submitted_by is not null and submitted_at is not null
      and adjusted_by is not null and adjusted_at is not null)
    or
    (status = 'closed' and submit_idempotency_key is not null
      and submitted_by is not null and submitted_at is not null
      and adjusted_by is null and adjusted_at is null)
  )
);
create unique index recount_sessions_one_open_type
  on public.recount_sessions(branch_id, business_date, type)
  where status in ('draft', 'submitted');
create index recount_sessions_branch_date
  on public.recount_sessions(branch_id, business_date desc, status, type);
create index recount_sessions_opened_by
  on public.recount_sessions(opened_by, opened_at desc);

create table public.recount_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.recount_sessions(id) on delete restrict,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  opening_qty numeric(14,4) not null default 0,
  received_qty numeric(14,4) not null default 0,
  production_output_qty numeric(14,4) not null default 0,
  transfers_out_qty numeric(14,4) not null default 0,
  usage_qty numeric(14,4) not null default 0,
  stock_out_qty numeric(14,4) not null default 0,
  waste_qty numeric(14,4) not null default 0,
  expected_qty numeric(14,4) not null default 0,
  physical_qty numeric(14,4),
  variance_qty numeric(14,4),
  unit_cost_snapshot numeric(14,4) not null default 0,
  variance_value_snapshot numeric(14,4),
  unusual_signals text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  constraint recount_lines_components_nonnegative check (
    received_qty >= 0 and production_output_qty >= 0 and transfers_out_qty >= 0
    and usage_qty >= 0 and stock_out_qty >= 0 and waste_qty >= 0
  ),
  constraint recount_lines_expected_formula check (
    expected_qty = round(opening_qty + received_qty + production_output_qty
      - transfers_out_qty - usage_qty - stock_out_qty - waste_qty, 4)
  ),
  constraint recount_lines_physical_nonnegative check (physical_qty is null or physical_qty >= 0),
  constraint recount_lines_cost_nonnegative check (unit_cost_snapshot >= 0),
  constraint recount_lines_submission_consistent check (
    (physical_qty is null and variance_qty is null and variance_value_snapshot is null)
    or
    (physical_qty is not null and variance_qty = round(physical_qty - expected_qty, 4)
      and variance_value_snapshot = round(variance_qty * unit_cost_snapshot, 4))
  ),
  constraint recount_lines_signals_nonnull check (array_position(unusual_signals, null) is null),
  unique (session_id, item_id)
);
create index recount_lines_session on public.recount_lines(session_id, created_at, id);
create index recount_lines_item on public.recount_lines(item_id, created_at desc);

create table public.variance_adjustments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  session_id uuid not null unique references public.recount_sessions(id) on delete restrict,
  reason_type public.recount_adjustment_reason not null,
  reason text not null,
  idempotency_key text not null unique,
  stock_txn_id uuid not null unique references public.stock_transactions(id) on delete restrict,
  total_variance_value numeric(14,4) not null,
  is_unusual boolean not null default false,
  posted_by uuid not null references public.profiles(id),
  posted_at timestamptz not null default now(),
  day_reopen_event_id uuid references public.day_close_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint variance_adjustments_reason_nonblank check (length(btrim(reason)) >= 3),
  constraint variance_adjustments_key_nonblank check (length(btrim(idempotency_key)) > 0)
);
create index variance_adjustments_posted_by
  on public.variance_adjustments(posted_by, posted_at desc);

-- Every stock posting after a reopen is tied to that reopen event. The insert guard in 0025 sets
-- this column and blocks writes while the branch/date is closed.
alter table public.stock_transactions
  add column day_reopen_event_id uuid references public.day_close_events(id) on delete restrict;
create index stock_txn_reopen_event
  on public.stock_transactions(day_reopen_event_id)
  where day_reopen_event_id is not null;

comment on column public.recount_lines.unit_cost_snapshot is
  'SENSITIVE: frozen from an existing posted ledger cost snapshot; never exposed to operations UI.';
comment on column public.recount_lines.variance_value_snapshot is
  'SENSITIVE: frozen variance quantity times unit-cost snapshot.';
comment on column public.variance_adjustments.total_variance_value is
  'SENSITIVE: sum of absolute frozen recount variance values.';

create trigger set_updated_at before update on public.daily_operational_closures
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.recount_sessions
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_day_close_events_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Day-close events are append-only';
end;
$$;
create trigger day_close_events_append_only
  before update or delete on public.day_close_events
  for each row execute function public.tg_day_close_events_append_only();

-- Extend the already seeded global threshold setting without overwriting owner customizations.
update public.application_settings
set value = value
  || jsonb_build_object(
    'recount_variance_percent', coalesce(value->'recount_variance_percent', '10'::jsonb),
    'recount_variance_value', coalesce(value->'recount_variance_value', value->'high_value_adjustment', '5000'::jsonb),
    'recount_repeat_count', coalesce(value->'recount_repeat_count', '3'::jsonb),
    'recount_repeat_window_days', coalesce(value->'recount_repeat_window_days', '7'::jsonb)
  )
where key = 'thresholds';

