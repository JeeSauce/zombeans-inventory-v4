-- 0030_phase9_schema.sql
-- Phase 9 lifecycle history, explicit retention holds, idempotent purge runs, and safe backup
-- metadata. Reports are query functions over existing frozen/append-only data and need no tables.

create type public.recycle_entity_type as enum (
  'category',
  'inventory_item',
  'supplier',
  'purchase_order',
  'recipe',
  'production_template'
);

create type public.recycle_command_type as enum ('soft_delete', 'restore', 'purge');
create type public.retention_dependency_type as enum ('ledger', 'audit', 'legal', 'accounting');
create type public.backup_mechanism as enum ('managed', 'pg_dump', 'pitr_test');
create type public.backup_run_status as enum ('running', 'succeeded', 'failed', 'verified');

-- Generic holds are deliberate declarations, not foreign keys to a polymorphic root. Releasing a
-- hold preserves the original record and reason for retention/audit review.
create table public.retention_holds (
  id              uuid primary key default gen_random_uuid(),
  entity_type     public.recycle_entity_type not null,
  entity_id       uuid not null,
  dependency_type public.retention_dependency_type not null,
  reason          text not null,
  idempotency_key text not null unique,
  placed_by       uuid references public.profiles(id) on delete restrict,
  placed_at       timestamptz not null default now(),
  released_by     uuid references public.profiles(id) on delete restrict,
  released_at     timestamptz,
  release_reason  text,
  release_idempotency_key text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer not null default 1,
  constraint retention_holds_reason_nonblank check (length(btrim(reason)) >= 3),
  constraint retention_holds_key_nonblank check (length(btrim(idempotency_key)) >= 8),
  constraint retention_holds_release_key_nonblank check (
    release_idempotency_key is null or length(btrim(release_idempotency_key)) >= 8
  ),
  constraint retention_holds_release_consistent check (
    (released_at is null and released_by is null and release_reason is null
      and release_idempotency_key is null)
    or
    (released_at is not null and released_by is not null
      and length(btrim(coalesce(release_reason, ''))) >= 3
      and release_idempotency_key is not null)
  )
);
create unique index retention_holds_one_active_kind
  on public.retention_holds(entity_type, entity_id, dependency_type)
  where released_at is null;
create index retention_holds_active_entity
  on public.retention_holds(entity_type, entity_id)
  where released_at is null;

-- Every lifecycle command is append-only and points at its audit record. entity_id deliberately has
-- no FK, so command/audit history remains after an eligible business row is physically purged.
create table public.recycle_bin_commands (
  id                  uuid primary key default gen_random_uuid(),
  entity_type         public.recycle_entity_type not null,
  entity_id           uuid not null,
  command_type        public.recycle_command_type not null,
  idempotency_key     text not null unique,
  actor_id            uuid references public.profiles(id) on delete restrict,
  audit_log_id        uuid not null references public.audit_logs(id) on delete restrict,
  previous_deleted_at timestamptz,
  result              jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  constraint recycle_commands_key_nonblank check (length(btrim(idempotency_key)) >= 8),
  constraint recycle_commands_result_object check (jsonb_typeof(result) = 'object')
);
create index recycle_commands_entity
  on public.recycle_bin_commands(entity_type, entity_id, created_at desc);

-- A run row is inserted before selection and finalized in the same transaction. A replay reads the
-- frozen result rather than evaluating the current recycle bin a second time.
create table public.recycle_purge_runs (
  id              uuid primary key default gen_random_uuid(),
  run_key         text not null unique,
  requested_limit integer not null,
  started_by      uuid references public.profiles(id) on delete restrict,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  purged_count    integer not null default 0,
  skipped_count   integer not null default 0,
  result          jsonb not null default '{}'::jsonb,
  constraint recycle_purge_run_key_nonblank check (length(btrim(run_key)) >= 8),
  constraint recycle_purge_limit_range check (requested_limit between 1 and 500),
  constraint recycle_purge_counts_nonnegative check (purged_count >= 0 and skipped_count >= 0),
  constraint recycle_purge_result_object check (jsonb_typeof(result) = 'object')
);

-- Metadata only. Never store credentials, URLs, dump paths/object keys, or backup contents here.
create table public.backup_runs (
  id                   uuid primary key default gen_random_uuid(),
  run_key              text not null unique,
  reference            text not null unique,
  mechanism            public.backup_mechanism not null,
  status               public.backup_run_status not null default 'running',
  storage_provider     text,
  encrypted            boolean not null default false,
  started_at           timestamptz not null,
  completed_at         timestamptz,
  retention_until      date,
  size_bytes           bigint,
  verified_at          timestamptz,
  safe_failure_summary text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  version              integer not null default 1,
  constraint backup_runs_key_nonblank check (length(btrim(run_key)) >= 8),
  constraint backup_runs_reference_nonblank check (length(btrim(reference)) >= 3),
  constraint backup_runs_provider_nonblank check (
    storage_provider is null or length(btrim(storage_provider)) >= 2
  ),
  constraint backup_runs_size_nonnegative check (size_bytes is null or size_bytes >= 0),
  constraint backup_runs_times_valid check (
    completed_at is null or completed_at >= started_at
  ),
  constraint backup_runs_verified_valid check (
    verified_at is null or (completed_at is not null and verified_at >= completed_at)
  ),
  constraint backup_runs_state_valid check (
    (status = 'running' and completed_at is null and safe_failure_summary is null)
    or
    (status = 'failed' and completed_at is not null
      and length(btrim(coalesce(safe_failure_summary, ''))) >= 3)
    or
    (status in ('succeeded', 'verified') and completed_at is not null
      and safe_failure_summary is null)
  )
);
create index backup_runs_started on public.backup_runs(started_at desc);
create index backup_runs_status on public.backup_runs(status, started_at desc);

create trigger set_updated_at before update on public.retention_holds
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.backup_runs
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_phase9_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger recycle_bin_commands_append_only
  before update or delete on public.recycle_bin_commands
  for each row execute function public.tg_phase9_append_only();

-- Only the Phase 9 lifecycle definer functions set this transaction-local flag. It closes legacy
-- table grants that otherwise permit callers to write deleted_at directly or hard-delete roots.
create or replace function public.tg_guard_phase9_lifecycle()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if current_user <> 'postgres'
      and current_setting('zombeans.lifecycle_command', true) is distinct from 'on' then
      raise exception 'Hard delete must use the Phase 9 purge routine';
    end if;
    return old;
  end if;

  if row(old.deleted_at, old.deleted_by, old.purge_at)
     is distinct from row(new.deleted_at, new.deleted_by, new.purge_at)
     and current_user <> 'postgres'
     and current_setting('zombeans.lifecycle_command', true) is distinct from 'on' then
    raise exception 'Lifecycle columns must use a Phase 9 lifecycle command';
  end if;
  return new;
end;
$$;

create trigger categories_phase9_lifecycle_guard
  before update or delete on public.categories
  for each row execute function public.tg_guard_phase9_lifecycle();
create trigger inventory_items_phase9_lifecycle_guard
  before update or delete on public.inventory_items
  for each row execute function public.tg_guard_phase9_lifecycle();
create trigger suppliers_phase9_lifecycle_guard
  before update or delete on public.suppliers
  for each row execute function public.tg_guard_phase9_lifecycle();
create trigger purchase_orders_phase9_lifecycle_guard
  before update or delete on public.purchase_orders
  for each row execute function public.tg_guard_phase9_lifecycle();
create trigger recipes_phase9_lifecycle_guard
  before update or delete on public.recipes
  for each row execute function public.tg_guard_phase9_lifecycle();
create trigger production_templates_phase9_lifecycle_guard
  before update or delete on public.production_templates
  for each row execute function public.tg_guard_phase9_lifecycle();

grant select, insert, update, delete on
  public.retention_holds,
  public.recycle_bin_commands,
  public.recycle_purge_runs,
  public.backup_runs
  to service_role;
