-- 0033_phase10_schema.sql
-- Phase 10 — offline synchronization receipts/conflicts and POS staging/mapping records.
-- RLS/grants are in 0034; actor-aware atomic functions are in 0035.

create type public.offline_submission_type as enum ('recount', 'production');
create type public.offline_submission_status as enum
  ('synced', 'posted', 'review_required', 'rejected');
create type public.offline_resolution_decision as enum ('accept', 'reject');
create type public.loyverse_entity_type as enum ('item', 'variant', 'modifier');
create type public.loyverse_mapping_command_type as enum ('upsert', 'deactivate');
create type public.pos_import_status as enum ('preview', 'confirmed');
create type public.pos_row_status as enum ('valid', 'unmapped', 'duplicate', 'invalid');
create type public.pos_movement_type as enum ('sale', 'refund');

create sequence if not exists public.offline_submission_ref_seq as bigint start 1;
create sequence if not exists public.pos_import_ref_seq as bigint start 1;

-- Server-issued snapshot receipts prevent a browser from forging a future timestamp to suppress a
-- conflict. A receipt is scoped to one actor, client draft, branch, type, and normalized item set.
create table public.offline_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  snapshot_type       public.offline_submission_type not null,
  branch_id           uuid not null references public.branches(id) on delete restrict,
  client_draft_id     uuid not null,
  production_order_id uuid references public.production_orders(id) on delete restrict,
  captured_at         timestamptz not null default now(),
  expires_at          timestamptz not null default (now() + interval '30 days'),
  created_by          uuid not null references public.profiles(id) on delete restrict,
  audit_log_id        uuid not null unique references public.audit_logs(id) on delete restrict,
  created_at          timestamptz not null default now(),
  constraint offline_snapshots_expiry check (expires_at > captured_at),
  constraint offline_snapshots_type_target check (
    (snapshot_type = 'recount' and production_order_id is null)
    or (snapshot_type = 'production' and production_order_id is not null)
  ),
  unique (created_by, client_draft_id)
);
create index offline_snapshots_actor_expiry
  on public.offline_snapshots(created_by, expires_at desc);

create table public.offline_snapshot_items (
  id          uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.offline_snapshots(id) on delete restrict,
  item_id     uuid not null references public.inventory_items(id) on delete restrict,
  created_at  timestamptz not null default now(),
  unique (snapshot_id, item_id)
);
create index offline_snapshot_items_scope on public.offline_snapshot_items(item_id, snapshot_id);

-- Durable receipt for every device submission. Payloads contain operational quantities only and
-- are exposed to authenticated callers through narrowly scoped safe RPCs, not table grants.
create table public.offline_submissions (
  id                         uuid primary key default gen_random_uuid(),
  reference                  text not null unique,
  submission_type            public.offline_submission_type not null,
  status                     public.offline_submission_status not null,
  branch_id                  uuid not null references public.branches(id) on delete restrict,
  client_draft_id            uuid not null,
  snapshot_id                uuid not null unique references public.offline_snapshots(id) on delete restrict,
  client_created_at          timestamptz not null,
  snapshot_at                timestamptz not null,
  business_date              date,
  idempotency_key            uuid not null unique,
  payload                    jsonb not null,
  conflict_reason            text,
  submitted_by               uuid not null references public.profiles(id) on delete restrict,
  submitted_at               timestamptz not null default now(),
  result_recount_session_id  uuid references public.recount_sessions(id) on delete restrict,
  result_production_order_id uuid references public.production_orders(id) on delete restrict,
  result_stock_txn_id        uuid references public.stock_transactions(id) on delete restrict,
  resolved_by                uuid references public.profiles(id) on delete restrict,
  resolved_at                timestamptz,
  audit_log_id               uuid not null unique references public.audit_logs(id) on delete restrict,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  version                    integer not null default 1,
  constraint offline_submissions_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint offline_submissions_conflict_state check (
    (status = 'review_required' and conflict_reason is not null
      and length(btrim(conflict_reason)) >= 3 and resolved_by is null and resolved_at is null)
    or (status in ('synced', 'posted') and conflict_reason is null
      and resolved_by is null and resolved_at is null)
    or (status in ('synced', 'posted', 'rejected') and resolved_by is not null
      and resolved_at is not null)
  ),
  constraint offline_submissions_type_result check (
    (submission_type = 'recount' and business_date is not null
      and result_production_order_id is null)
    or (submission_type = 'production' and business_date is null
      and result_recount_session_id is null)
  ),
  constraint offline_submissions_posted_result check (
    status <> 'posted' or result_stock_txn_id is not null
  ),
  unique (submitted_by, client_draft_id)
);
create index offline_submissions_branch_status
  on public.offline_submissions(branch_id, status, submitted_at desc);
create index offline_submissions_actor
  on public.offline_submissions(submitted_by, submitted_at desc);

-- Normalized scope makes locking and overlap checks independent of browser JSON ordering.
create table public.offline_submission_items (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references public.offline_submissions(id) on delete restrict,
  item_id         uuid not null references public.inventory_items(id) on delete restrict,
  physical_qty    numeric(14,4),
  created_at      timestamptz not null default now(),
  constraint offline_submission_items_physical_nonnegative check (
    physical_qty is null or physical_qty >= 0
  ),
  unique (submission_id, item_id)
);
create index offline_submission_items_scope
  on public.offline_submission_items(item_id, submission_id);

-- One explicit decision per conflict; immutable evidence preserves the losing draft and reason.
create table public.offline_conflict_resolutions (
  id                  uuid primary key default gen_random_uuid(),
  submission_id       uuid not null unique references public.offline_submissions(id) on delete restrict,
  decision            public.offline_resolution_decision not null,
  reason              text not null,
  idempotency_key     uuid not null unique,
  actor_id             uuid not null references public.profiles(id) on delete restrict,
  audit_log_id         uuid not null unique references public.audit_logs(id) on delete restrict,
  result_stock_txn_id uuid references public.stock_transactions(id) on delete restrict,
  created_at          timestamptz not null default now(),
  constraint offline_resolutions_reason_nonblank check (length(btrim(reason)) >= 3),
  constraint offline_resolutions_result_consistent check (
    (decision = 'reject' and result_stock_txn_id is null) or decision = 'accept'
  )
);

create table public.loyverse_mappings (
  id                 uuid primary key default gen_random_uuid(),
  entity_type        public.loyverse_entity_type not null,
  external_id        text not null,
  external_name      text,
  external_sku       text,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  inventory_qty      numeric(14,4) not null default 1,
  active             boolean not null default true,
  created_by         uuid not null references public.profiles(id) on delete restrict,
  updated_by         uuid not null references public.profiles(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            integer not null default 1,
  constraint loyverse_mappings_external_id_nonblank check (length(btrim(external_id)) >= 1),
  constraint loyverse_mappings_external_name_safe check (
    external_name is null or length(btrim(external_name)) between 1 and 200
  ),
  constraint loyverse_mappings_external_sku_safe check (
    external_sku is null or length(btrim(external_sku)) between 1 and 100
  ),
  constraint loyverse_mappings_inventory_qty_positive check (inventory_qty > 0),
  unique (entity_type, external_id)
);
create index loyverse_mappings_item_active
  on public.loyverse_mappings(inventory_item_id, active);

create table public.loyverse_mapping_commands (
  id              uuid primary key default gen_random_uuid(),
  mapping_id      uuid not null references public.loyverse_mappings(id) on delete restrict,
  command_type    public.loyverse_mapping_command_type not null,
  idempotency_key uuid not null unique,
  reason          text not null,
  actor_id        uuid not null references public.profiles(id) on delete restrict,
  audit_log_id    uuid not null unique references public.audit_logs(id) on delete restrict,
  result          jsonb not null,
  created_at      timestamptz not null default now(),
  constraint loyverse_mapping_commands_reason_nonblank check (length(btrim(reason)) >= 3),
  constraint loyverse_mapping_commands_result_object check (jsonb_typeof(result) = 'object')
);

-- Preview headers and rows are staging only. Inventory linkage is created exclusively at confirm.
create table public.pos_imports (
  id                      uuid primary key default gen_random_uuid(),
  reference               text not null unique,
  branch_id               uuid not null references public.branches(id) on delete restrict,
  source                  text not null default 'loyverse',
  filename                text not null,
  status                  public.pos_import_status not null default 'preview',
  preview_idempotency_key uuid not null unique,
  payload_hash            text not null,
  row_count               integer not null,
  valid_count             integer not null,
  error_count             integer not null,
  previewed_by            uuid not null references public.profiles(id) on delete restrict,
  previewed_at            timestamptz not null default now(),
  preview_audit_log_id    uuid not null unique references public.audit_logs(id) on delete restrict,
  confirm_idempotency_key uuid unique,
  confirm_reason          text,
  confirmed_by            uuid references public.profiles(id) on delete restrict,
  confirmed_at            timestamptz,
  confirm_audit_log_id    uuid unique references public.audit_logs(id) on delete restrict,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  version                 integer not null default 1,
  constraint pos_imports_source_loyverse check (source = 'loyverse'),
  constraint pos_imports_filename_nonblank check (length(btrim(filename)) between 1 and 255),
  constraint pos_imports_payload_hash check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint pos_imports_counts_valid check (
    row_count between 1 and 500 and valid_count >= 0 and error_count >= 0
      and valid_count + error_count = row_count
  ),
  constraint pos_imports_confirmation_state check (
    (status = 'preview' and confirm_idempotency_key is null and confirm_reason is null
      and confirmed_by is null and confirmed_at is null and confirm_audit_log_id is null)
    or (status = 'confirmed' and confirm_idempotency_key is not null
      and confirm_reason is not null and length(btrim(confirm_reason)) >= 3
      and confirmed_by is not null and confirmed_at is not null
      and confirm_audit_log_id is not null and error_count = 0)
  )
);
create index pos_imports_branch_status
  on public.pos_imports(branch_id, status, previewed_at desc);

create table public.pos_import_rows (
  id                    uuid primary key default gen_random_uuid(),
  import_id             uuid not null references public.pos_imports(id) on delete restrict,
  row_number            integer not null,
  external_reference    text not null,
  external_line_id      text not null,
  occurred_at           timestamptz not null,
  movement_type         public.pos_movement_type not null,
  entity_type           public.loyverse_entity_type not null,
  external_id           text not null,
  quantity              numeric(14,4) not null,
  mapping_id            uuid references public.loyverse_mappings(id) on delete restrict,
  inventory_item_id     uuid references public.inventory_items(id) on delete restrict,
  inventory_qty         numeric(14,4),
  validation_status     public.pos_row_status not null,
  validation_error      text,
  created_at            timestamptz not null default now(),
  constraint pos_import_rows_number_positive check (row_number >= 2),
  constraint pos_import_rows_external_reference_nonblank check (
    length(btrim(external_reference)) between 1 and 160
  ),
  constraint pos_import_rows_external_line_nonblank check (
    length(btrim(external_line_id)) between 1 and 160
  ),
  constraint pos_import_rows_external_id_nonblank check (length(btrim(external_id)) between 1 and 200),
  constraint pos_import_rows_quantity_positive check (quantity > 0),
  constraint pos_import_rows_inventory_qty_positive check (inventory_qty is null or inventory_qty > 0),
  constraint pos_import_rows_validation_consistent check (
    (validation_status = 'valid' and mapping_id is not null and inventory_item_id is not null
      and inventory_qty is not null and validation_error is null)
    or (validation_status <> 'valid' and validation_error is not null
      and length(btrim(validation_error)) >= 3)
  ),
  unique (import_id, row_number),
  unique (import_id, external_line_id, movement_type)
);
create index pos_import_rows_import_status
  on public.pos_import_rows(import_id, validation_status, row_number);

create table public.pos_import_postings (
  id                  uuid primary key default gen_random_uuid(),
  import_id           uuid not null references public.pos_imports(id) on delete restrict,
  import_row_id       uuid not null unique references public.pos_import_rows(id) on delete restrict,
  external_line_id    text not null,
  movement_type       public.pos_movement_type not null,
  stock_txn_id        uuid not null unique references public.stock_transactions(id) on delete restrict,
  idempotency_key     text not null unique,
  created_at          timestamptz not null default now(),
  unique (external_line_id, movement_type)
);
create index pos_import_postings_import on public.pos_import_postings(import_id, created_at);

comment on table public.pos_imports is
  'Loyverse CSV staging. Preview rows never mutate stock; confirm posts through 0035 only.';
comment on column public.pos_import_rows.inventory_qty is
  'Operational base-unit quantity resolved from mapping; contains no cost or supplier price.';
comment on table public.pos_import_postings is
  'Append-only link from a confirmed external line to its one ledger transaction.';

create trigger set_updated_at before update on public.offline_submissions
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.loyverse_mappings
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.pos_imports
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_phase10_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger offline_submission_items_append_only
  before update or delete on public.offline_submission_items
  for each row execute function public.tg_phase10_append_only();
create trigger offline_snapshot_items_append_only
  before update or delete on public.offline_snapshot_items
  for each row execute function public.tg_phase10_append_only();
create trigger offline_conflict_resolutions_append_only
  before update or delete on public.offline_conflict_resolutions
  for each row execute function public.tg_phase10_append_only();
create trigger loyverse_mapping_commands_append_only
  before update or delete on public.loyverse_mapping_commands
  for each row execute function public.tg_phase10_append_only();
create trigger pos_import_rows_append_only
  before update or delete on public.pos_import_rows
  for each row execute function public.tg_phase10_append_only();
create trigger pos_import_postings_append_only
  before update or delete on public.pos_import_postings
  for each row execute function public.tg_phase10_append_only();

-- Reference permissions are part of the migration so upgraded and freshly reset environments agree.
insert into public.permissions (slug, description, is_sensitive) values
  ('offline.sync', 'Synchronize owned offline recount and production drafts', false),
  ('offline.review', 'Accept or reject offline synchronization conflicts', false),
  ('pos.import', 'Manage Loyverse mappings and staged POS imports', false)
on conflict (slug) do update set
  description = excluded.description,
  is_sensitive = excluded.is_sensitive;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.slug in ('offline.sync', 'offline.review', 'pos.import')
where r.key in ('super_admin', 'branch_manager')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.slug = 'offline.sync'
where r.key in ('production', 'inventory')
on conflict do nothing;
