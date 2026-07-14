-- 0026_phase8_schema.sql
-- Phase 8 schema: targeted notifications, calendar events, popup engagement sessions, and the
-- supporting append-only command/event history. RLS/grants are added in 0027 and definer
-- functions in 0028.

create type public.notification_severity as enum ('critical', 'warning', 'info');
create type public.notification_status as enum ('active', 'resolved');
create type public.notification_source_type as enum (
  'negative_inventory',
  'expired_lot',
  'overdue_recount',
  'unusual_recount',
  'failed_production',
  'low_stock',
  'out_of_stock',
  'pending_stock_request'
);
create type public.notification_event_type as enum (
  'raised',
  'reraised',
  'resolved',
  'read',
  'acknowledged',
  'delivery_queued',
  'delivery_claimed',
  'delivery_delivered',
  'delivery_failed'
);
create type public.notification_delivery_channel as enum ('in_app', 'email');
create type public.notification_delivery_status as enum (
  'queued', 'processing', 'delivered', 'failed'
);

create type public.calendar_event_type as enum (
  'operation', 'popup', 'production', 'delivery', 'recount', 'other'
);
create type public.calendar_event_status as enum (
  'scheduled', 'in_progress', 'completed', 'cancelled'
);
create type public.calendar_command_type as enum ('create', 'update', 'cancel');
create type public.popup_event_status as enum (
  'planned', 'in_progress', 'reconciling', 'completed', 'cancelled'
);
create type public.popup_command_type as enum (
  'create', 'update', 'start', 'count', 'link_movement', 'complete', 'cancel'
);
create type public.popup_movement_type as enum (
  'outbound_transfer', 'return_transfer', 'consumed', 'waste', 'loss', 'gain'
);

create sequence if not exists public.notification_ref_seq as bigint start 1;
create sequence if not exists public.calendar_event_ref_seq as bigint start 1;
create sequence if not exists public.popup_event_ref_seq as bigint start 1;

-- Current notification state. Every transition is additionally recorded in notification_events.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  severity public.notification_severity not null,
  source_type public.notification_source_type not null,
  status public.notification_status not null default 'active',
  title text not null,
  message text not null,
  entity_type text not null,
  entity_id uuid,
  entity_reference text,
  target_role_id uuid references public.roles(id) on delete restrict,
  target_branch_id uuid references public.branches(id) on delete restrict,
  target_user_id uuid references public.profiles(id) on delete restrict,
  dedup_key text not null,
  email_required boolean not null default false,
  first_raised_at timestamptz not null default now(),
  last_raised_at timestamptz not null default now(),
  raise_count integer not null default 1,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id),
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint notifications_title_nonblank check (length(btrim(title)) > 0),
  constraint notifications_message_nonblank check (length(btrim(message)) > 0),
  constraint notifications_entity_type_nonblank check (length(btrim(entity_type)) > 0),
  constraint notifications_entity_reference_nonblank check (
    entity_reference is null or length(btrim(entity_reference)) > 0
  ),
  constraint notifications_dedup_nonblank check (length(btrim(dedup_key)) > 0),
  constraint notifications_raise_count_positive check (raise_count > 0),
  constraint notifications_email_critical_only check (
    not email_required or severity = 'critical'
  ),
  constraint notifications_resolution_consistent check (
    (status = 'active' and resolved_at is null and resolved_by is null and resolution is null)
    or
    (status = 'resolved' and resolved_at is not null and resolution is not null
      and length(btrim(resolution)) >= 3)
  )
);
create unique index notifications_one_active_dedup
  on public.notifications(dedup_key) where status = 'active';
create index notifications_target_user_active
  on public.notifications(target_user_id, severity, last_raised_at desc)
  where status = 'active';
create index notifications_target_branch_active
  on public.notifications(target_branch_id, severity, last_raised_at desc)
  where status = 'active';
create index notifications_target_role_active
  on public.notifications(target_role_id, severity, last_raised_at desc)
  where status = 'active';
create index notifications_source_entity
  on public.notifications(source_type, entity_id, last_raised_at desc);

-- Per-user current in-app state. Read/ack events stay append-only in notification_events.
create table public.notification_receipts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  read_at timestamptz,
  acknowledged_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (notification_id, user_id),
  constraint notification_receipts_ack_after_read check (
    acknowledged_at is null or (read_at is not null and acknowledged_at >= read_at)
  )
);
create index notification_receipts_user_unread
  on public.notification_receipts(user_id, notification_id) where read_at is null;

-- Append-only record of condition and user/delivery transitions.
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete restrict,
  event_type public.notification_event_type not null,
  actor_id uuid references public.profiles(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint notification_events_metadata_object check (jsonb_typeof(metadata) = 'object')
);
create index notification_events_notification_time
  on public.notification_events(notification_id, created_at desc, id desc);

-- Server-only in-app/email delivery tracking and email outbox.
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete restrict,
  channel public.notification_delivery_channel not null,
  recipient_user_id uuid not null references public.profiles(id) on delete restrict,
  recipient_address text,
  status public.notification_delivery_status not null default 'queued',
  idempotency_key text not null unique,
  attempt_count integer not null default 0,
  claim_token uuid,
  claimed_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_key_nonblank check (
    length(btrim(idempotency_key)) > 0
  ),
  constraint notification_deliveries_attempt_nonnegative check (attempt_count >= 0),
  constraint notification_deliveries_recipient_consistent check (
    (channel = 'in_app' and recipient_address is null)
    or
    (channel = 'email' and recipient_address is not null
      and length(btrim(recipient_address)) > 3)
  ),
  constraint notification_deliveries_state_consistent check (
    (status = 'queued' and claim_token is null and claimed_at is null
      and delivered_at is null and failed_at is null)
    or
    (status = 'processing' and claim_token is not null and claimed_at is not null
      and delivered_at is null and failed_at is null)
    or
    (status = 'delivered' and delivered_at is not null and failed_at is null)
    or
    (status = 'failed' and failed_at is not null and delivered_at is null
      and last_error is not null)
  )
);
create unique index notification_deliveries_in_app_user
  on public.notification_deliveries(notification_id, recipient_user_id)
  where channel = 'in_app';
create unique index notification_deliveries_email_address
  on public.notification_deliveries(notification_id, lower(recipient_address))
  where channel = 'email';
create index notification_deliveries_email_queue
  on public.notification_deliveries(created_at, id)
  where channel = 'email' and status in ('queued', 'failed');

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  title text not null,
  description text,
  location text,
  event_type public.calendar_event_type not null default 'operation',
  status public.calendar_event_status not null default 'scheduled',
  branch_id uuid references public.branches(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null default 'Asia/Manila',
  create_idempotency_key text not null unique,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint calendar_events_title_nonblank check (length(btrim(title)) >= 2),
  constraint calendar_events_description_nonblank check (
    description is null or length(btrim(description)) > 0
  ),
  constraint calendar_events_location_nonblank check (
    location is null or length(btrim(location)) > 0
  ),
  constraint calendar_events_time_valid check (ends_at > starts_at),
  constraint calendar_events_timezone_manila check (timezone = 'Asia/Manila'),
  constraint calendar_events_key_nonblank check (
    length(btrim(create_idempotency_key)) > 0
  )
);
create index calendar_events_range on public.calendar_events(starts_at, ends_at, status);
create index calendar_events_branch_range
  on public.calendar_events(branch_id, starts_at, ends_at);

-- Durable idempotency record for every calendar create/update/cancel command.
create table public.calendar_event_commands (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events(id) on delete restrict,
  command_type public.calendar_command_type not null,
  idempotency_key text not null unique,
  resulting_version integer not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  audit_log_id uuid not null unique references public.audit_logs(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint calendar_commands_key_nonblank check (length(btrim(idempotency_key)) > 0),
  constraint calendar_commands_version_positive check (resulting_version > 0)
);
create index calendar_event_commands_event
  on public.calendar_event_commands(event_id, created_at desc);

create table public.popup_event_sessions (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  calendar_event_id uuid not null unique references public.calendar_events(id) on delete restrict,
  popup_branch_id uuid not null references public.branches(id) on delete restrict,
  return_branch_id uuid not null references public.branches(id) on delete restrict,
  status public.popup_event_status not null default 'planned',
  notes text,
  create_idempotency_key text not null unique,
  started_at timestamptz,
  started_by uuid references public.profiles(id) on delete restrict,
  counted_at timestamptz,
  counted_by uuid references public.profiles(id) on delete restrict,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint popup_events_distinct_branches check (popup_branch_id <> return_branch_id),
  constraint popup_events_notes_nonblank check (notes is null or length(btrim(notes)) > 0),
  constraint popup_events_key_nonblank check (length(btrim(create_idempotency_key)) > 0),
  constraint popup_events_lifecycle_consistent check (
    (status = 'planned' and started_at is null and counted_at is null and completed_at is null)
    or
    (status = 'in_progress' and started_at is not null and counted_at is null
      and completed_at is null)
    or
    (status = 'reconciling' and started_at is not null and counted_at is not null
      and completed_at is null)
    or
    (status = 'completed' and started_at is not null and counted_at is not null
      and completed_at is not null)
    or status = 'cancelled'
  )
);
create index popup_event_sessions_status
  on public.popup_event_sessions(status, created_at desc);
create index popup_event_sessions_branch
  on public.popup_event_sessions(popup_branch_id, status, created_at desc);

alter table public.transfers
  add column popup_event_id uuid references public.popup_event_sessions(id) on delete restrict;
create index transfers_popup_event
  on public.transfers(popup_event_id, created_at desc) where popup_event_id is not null;

create table public.popup_event_count_lines (
  id uuid primary key default gen_random_uuid(),
  popup_event_id uuid not null references public.popup_event_sessions(id) on delete restrict,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  transferred_in_qty numeric(14,4) not null default 0,
  remaining_qty numeric(14,4) not null default 0,
  returned_qty numeric(14,4) not null default 0,
  consumed_qty numeric(14,4) not null default 0,
  waste_qty numeric(14,4) not null default 0,
  loss_qty numeric(14,4) not null default 0,
  gain_qty numeric(14,4) not null default 0,
  ending_qty numeric(14,4) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (popup_event_id, item_id),
  constraint popup_count_quantities_nonnegative check (
    transferred_in_qty >= 0 and remaining_qty >= 0 and returned_qty >= 0
    and consumed_qty >= 0 and waste_qty >= 0 and loss_qty >= 0
    and gain_qty >= 0 and ending_qty >= 0
  ),
  constraint popup_count_remaining_formula check (
    remaining_qty = round(returned_qty + ending_qty, 4)
  ),
  constraint popup_count_reconciliation_formula check (
    round(transferred_in_qty + gain_qty, 4)
      = round(consumed_qty + waste_qty + loss_qty + remaining_qty, 4)
  ),
  constraint popup_count_notes_nonblank check (notes is null or length(btrim(notes)) > 0)
);
create index popup_event_count_lines_event
  on public.popup_event_count_lines(popup_event_id, created_at, id);

-- Links the frozen event summary to stock effects already posted through Phase 6 functions.
create table public.popup_event_movements (
  id uuid primary key default gen_random_uuid(),
  popup_event_id uuid not null references public.popup_event_sessions(id) on delete restrict,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  movement_type public.popup_movement_type not null,
  quantity numeric(14,4) not null,
  transfer_id uuid references public.transfers(id) on delete restrict,
  stock_txn_id uuid references public.stock_transactions(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint popup_movements_quantity_positive check (quantity > 0),
  constraint popup_movements_source_consistent check (
    (movement_type in ('outbound_transfer', 'return_transfer')
      and transfer_id is not null and stock_txn_id is null)
    or
    (movement_type in ('consumed', 'waste', 'loss', 'gain')
      and transfer_id is null and stock_txn_id is not null)
  )
);
create unique index popup_movements_unique_transfer_item
  on public.popup_event_movements(popup_event_id, movement_type, transfer_id, item_id)
  where transfer_id is not null;
create unique index popup_movements_unique_txn_item
  on public.popup_event_movements(popup_event_id, movement_type, stock_txn_id, item_id)
  where stock_txn_id is not null;
create index popup_event_movements_event
  on public.popup_event_movements(popup_event_id, movement_type, created_at);

-- Durable idempotency record for popup lifecycle/count/link commands.
create table public.popup_event_commands (
  id uuid primary key default gen_random_uuid(),
  popup_event_id uuid not null references public.popup_event_sessions(id) on delete restrict,
  command_type public.popup_command_type not null,
  idempotency_key text not null unique,
  resulting_version integer not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  audit_log_id uuid not null unique references public.audit_logs(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint popup_commands_key_nonblank check (length(btrim(idempotency_key)) > 0),
  constraint popup_commands_version_positive check (resulting_version > 0)
);
create index popup_event_commands_event
  on public.popup_event_commands(popup_event_id, created_at desc);

-- A failed production is a terminal cancelled order with explicit failure metadata. This avoids
-- overloading an ordinary cancellation and gives the notification producer a durable signal.
alter table public.production_orders
  add column failed_at timestamptz,
  add column failed_by uuid references public.profiles(id) on delete restrict,
  add column failure_reason text,
  add column failure_idempotency_key text unique;
alter table public.production_orders
  add constraint production_orders_failure_consistent check (
    (failed_at is null and failed_by is null and failure_reason is null
      and failure_idempotency_key is null)
    or
    (status = 'cancelled' and failed_at is not null and failed_by is not null
      and failure_reason is not null and length(btrim(failure_reason)) >= 3
      and failure_idempotency_key is not null
      and length(btrim(failure_idempotency_key)) > 0)
  );
create index production_orders_failed
  on public.production_orders(failed_at desc) where failed_at is not null;

comment on column public.notification_deliveries.recipient_address is
  'SENSITIVE server-only delivery address; never granted to authenticated users.';
comment on table public.popup_event_movements is
  'Links popup summaries to existing posted stock or received-transfer effects; never posts stock.';

-- Current-state tables without optimistic-concurrency versions still need timestamps refreshed.
create or replace function public.tg_set_updated_at_only()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.notifications
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.notification_receipts
  for each row execute function public.tg_set_updated_at_only();
create trigger set_updated_at before update on public.notification_deliveries
  for each row execute function public.tg_set_updated_at_only();
create trigger set_updated_at before update on public.calendar_events
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.popup_event_sessions
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.popup_event_count_lines
  for each row execute function public.tg_set_updated_at_only();

create or replace function public.tg_phase8_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger notification_events_append_only
  before update or delete on public.notification_events
  for each row execute function public.tg_phase8_append_only();
create trigger calendar_event_commands_append_only
  before update or delete on public.calendar_event_commands
  for each row execute function public.tg_phase8_append_only();
create trigger popup_event_movements_append_only
  before update or delete on public.popup_event_movements
  for each row execute function public.tg_phase8_append_only();
create trigger popup_event_commands_append_only
  before update or delete on public.popup_event_commands
  for each row execute function public.tg_phase8_append_only();
