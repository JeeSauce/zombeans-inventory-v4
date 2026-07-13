-- 0016_production_schema.sql
-- Phase 5 — production templates, frozen production orders, and planned/actual inputs.
-- RLS/grants in 0017; planning and atomic posting functions in 0018.

create type public.production_status as enum
  ('draft', 'in_progress', 'awaiting_confirmation', 'completed', 'cancelled');

create sequence if not exists public.production_ref_seq as bigint start 1;

create table public.production_templates (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  recipe_id                uuid not null references public.recipes(id) on delete restrict,
  default_batch_multiplier numeric(14,4) not null default 1,
  default_expiry_days      integer,
  instructions             text,
  active                   boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  version integer not null default 1,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id),
  purge_at timestamptz,
  constraint production_templates_name_nonblank check (length(btrim(name)) > 0),
  constraint production_templates_multiplier_pos check (default_batch_multiplier > 0),
  constraint production_templates_expiry_nonneg check (
    default_expiry_days is null or default_expiry_days >= 0
  )
);
create unique index production_templates_recipe_unique
  on public.production_templates(recipe_id) where deleted_at is null;
create index production_templates_active
  on public.production_templates(active) where deleted_at is null;

create table public.production_orders (
  id                       uuid primary key default gen_random_uuid(),
  reference                text not null unique,
  template_id              uuid not null references public.production_templates(id) on delete restrict,
  recipe_version_id        uuid not null references public.recipe_versions(id) on delete restrict,
  cost_snapshot_id         uuid not null references public.cost_snapshots(id) on delete restrict,
  branch_id                uuid not null references public.branches(id) on delete restrict,
  output_item_id           uuid not null references public.inventory_items(id) on delete restrict,
  output_unit_id           uuid not null references public.units(id) on delete restrict,
  status                   public.production_status not null default 'draft',
  batch_multiplier         numeric(14,4) not null,
  planned_output_qty       numeric(14,4) not null,
  actual_output_qty        numeric(14,4),
  output_lot_number        text,
  production_date          date,
  expiration_date          date,
  notes                    text,
  idempotency_key          text not null unique,
  correlation_id           uuid not null default gen_random_uuid(),
  started_at               timestamptz,
  started_by               uuid references public.profiles(id),
  recorded_at              timestamptz,
  recorded_by              uuid references public.profiles(id),
  submitted_at             timestamptz,
  submitted_by             uuid references public.profiles(id),
  confirmed_at             timestamptz,
  confirmed_by             uuid references public.profiles(id),
  production_output_txn_id uuid references public.stock_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  version integer not null default 1,
  constraint production_orders_multiplier_pos check (batch_multiplier > 0),
  constraint production_orders_planned_output_pos check (planned_output_qty > 0),
  constraint production_orders_actual_output_pos check (
    actual_output_qty is null or actual_output_qty > 0
  ),
  constraint production_orders_lot_nonblank check (
    output_lot_number is null or length(btrim(output_lot_number)) > 0
  ),
  constraint production_orders_expiry_valid check (
    expiration_date is null or production_date is null or expiration_date >= production_date
  ),
  constraint production_orders_completion_consistent check (
    (status = 'completed' and confirmed_at is not null and confirmed_by is not null
      and production_output_txn_id is not null)
    or
    (status <> 'completed' and production_output_txn_id is null)
  )
);
create index production_orders_status on public.production_orders(status, created_at desc);
create index production_orders_template on public.production_orders(template_id, created_at desc);
create index production_orders_recipe_version on public.production_orders(recipe_version_id);

create table public.production_order_inputs (
  id                  uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  recipe_line_id      uuid not null references public.recipe_lines(id) on delete restrict,
  item_id             uuid not null references public.inventory_items(id) on delete restrict,
  unit_id             uuid not null references public.units(id) on delete restrict,
  planned_qty         numeric(14,4) not null,
  actual_consumed_qty numeric(14,4) not null default 0,
  waste_qty           numeric(14,4) not null default 0,
  notes               text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint production_inputs_planned_pos check (planned_qty > 0),
  constraint production_inputs_actual_nonneg check (
    actual_consumed_qty >= 0 and waste_qty >= 0
  ),
  unique (production_order_id, item_id),
  unique (production_order_id, recipe_line_id)
);
create index production_order_inputs_order
  on public.production_order_inputs(production_order_id);

alter table public.stock_transactions
  add column production_order_id uuid
    references public.production_orders(id) on delete restrict;
create index stock_txn_production_order
  on public.stock_transactions(production_order_id)
  where production_order_id is not null;

create trigger set_updated_at before update on public.production_templates
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.production_orders
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.production_order_inputs
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_validate_production_template()
returns trigger language plpgsql set search_path = public as $$
declare v_kind public.recipe_kind; v_active boolean;
begin
  select kind, active and deleted_at is null into v_kind, v_active
  from public.recipes where id = new.recipe_id;
  if v_kind is distinct from 'production' or not coalesce(v_active, false) then
    raise exception 'Production templates require an active production recipe';
  end if;
  return new;
end $$;
create trigger validate_production_template
  before insert or update of recipe_id on public.production_templates
  for each row execute function public.tg_validate_production_template();

create or replace function public.tg_guard_production_order()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status in ('completed', 'cancelled') then
    raise exception 'Completed or cancelled production orders are immutable';
  end if;

  if row(old.template_id, old.recipe_version_id, old.cost_snapshot_id, old.branch_id,
         old.output_item_id, old.output_unit_id, old.batch_multiplier, old.planned_output_qty,
         old.idempotency_key, old.correlation_id)
     is distinct from
     row(new.template_id, new.recipe_version_id, new.cost_snapshot_id, new.branch_id,
         new.output_item_id, new.output_unit_id, new.batch_multiplier, new.planned_output_qty,
         new.idempotency_key, new.correlation_id) then
    raise exception 'Production order planning fields are immutable';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status in ('in_progress', 'cancelled')) or
    (old.status = 'in_progress' and new.status in ('awaiting_confirmation', 'cancelled')) or
    (old.status = 'awaiting_confirmation' and new.status in ('completed', 'cancelled'))
  ) then
    raise exception 'Invalid production status transition: % to %', old.status, new.status;
  end if;

  if new.status = 'completed' and current_user not in ('postgres', 'service_role') then
    raise exception 'Production completion must use post_production_completion';
  end if;

  if old.status = 'awaiting_confirmation' and new.status <> 'completed'
     and row(old.actual_output_qty, old.output_lot_number, old.production_date,
             old.expiration_date, old.notes)
         is distinct from
         row(new.actual_output_qty, new.output_lot_number, new.production_date,
             new.expiration_date, new.notes) then
    raise exception 'Submitted production actuals are immutable';
  end if;
  return new;
end $$;
create trigger guard_production_order
  before update on public.production_orders
  for each row execute function public.tg_guard_production_order();

create or replace function public.tg_guard_production_input()
returns trigger language plpgsql set search_path = public as $$
declare v_status public.production_status;
begin
  select status into v_status from public.production_orders
  where id = coalesce(new.production_order_id, old.production_order_id);

  if tg_op = 'DELETE' or v_status <> 'in_progress' then
    raise exception 'Production inputs can only be recorded while in progress';
  end if;
  if row(old.production_order_id, old.recipe_line_id, old.item_id, old.unit_id, old.planned_qty)
     is distinct from
     row(new.production_order_id, new.recipe_line_id, new.item_id, new.unit_id, new.planned_qty) then
    raise exception 'Production input planning fields are immutable';
  end if;
  return new;
end $$;
create trigger guard_production_input
  before update or delete on public.production_order_inputs
  for each row execute function public.tg_guard_production_input();
