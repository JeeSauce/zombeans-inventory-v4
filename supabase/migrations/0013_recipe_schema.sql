-- 0013_recipe_schema.sql
-- Phase 4 — versioned recipes, normalized recipe lines, and immutable cost snapshots.
-- RLS/grants in 0014; validation and costing functions in 0015.

create type public.recipe_kind as enum ('production', 'sale', 'modifier');
create type public.cost_snapshot_reason as enum ('activation', 'manual', 'production', 'transaction');

-- ── recipes ──────────────────────────────────────────────────────────────────
create table public.recipes (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  kind               public.recipe_kind not null,
  output_item_id     uuid not null references public.inventory_items(id) on delete restrict,
  product_id         uuid references public.products(id) on delete cascade,
  variant_id         uuid references public.product_variants(id) on delete cascade,
  modifier_option_id uuid references public.modifier_options(id) on delete cascade,
  active             boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  version integer not null default 1,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id),
  purge_at timestamptz,
  constraint recipes_name_nonblank check (length(btrim(name)) > 0),
  constraint recipes_target_matches_kind check (
    (kind = 'production' and num_nonnulls(product_id, variant_id, modifier_option_id) = 0)
    or
    (kind = 'sale' and num_nonnulls(product_id, variant_id) = 1 and modifier_option_id is null)
    or
    (kind = 'modifier' and product_id is null and variant_id is null and modifier_option_id is not null)
  )
);
create index recipes_output_item on public.recipes(output_item_id) where deleted_at is null;
create unique index recipes_production_output_unique
  on public.recipes(output_item_id) where kind = 'production' and deleted_at is null;
create unique index recipes_sale_product_unique
  on public.recipes(product_id) where kind = 'sale' and product_id is not null and deleted_at is null;
create unique index recipes_sale_variant_unique
  on public.recipes(variant_id) where kind = 'sale' and variant_id is not null and deleted_at is null;
create unique index recipes_modifier_option_unique
  on public.recipes(modifier_option_id)
  where kind = 'modifier' and modifier_option_id is not null and deleted_at is null;

-- ── recipe_versions ──────────────────────────────────────────────────────────
create table public.recipe_versions (
  id                 uuid primary key default gen_random_uuid(),
  recipe_id          uuid not null references public.recipes(id) on delete cascade,
  version_number     integer not null,
  effective_date     date not null default (now() at time zone 'utc')::date,
  output_qty         numeric(14,4) not null,
  output_unit_id     uuid not null references public.units(id) on delete restrict,
  expected_yield_pct numeric(7,4) not null default 100,
  expected_waste_pct numeric(7,4) not null default 0,
  is_active          boolean not null default false,
  activated_at       timestamptz,
  activated_by       uuid references public.profiles(id),
  prep_notes         text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  version integer not null default 1,
  constraint recipe_versions_number_pos check (version_number > 0),
  constraint recipe_versions_output_pos check (output_qty > 0),
  constraint recipe_versions_yield_range check (expected_yield_pct > 0 and expected_yield_pct <= 100),
  constraint recipe_versions_waste_range check (expected_waste_pct >= 0 and expected_waste_pct < 100),
  constraint recipe_versions_activation_consistent check (
    (activated_at is null and activated_by is null and not is_active)
    or (activated_at is not null and activated_by is not null)
  ),
  unique (recipe_id, version_number)
);
create unique index recipe_versions_one_active
  on public.recipe_versions(recipe_id) where is_active;
create index recipe_versions_recipe on public.recipe_versions(recipe_id, version_number desc);

-- ── recipe_lines ─────────────────────────────────────────────────────────────
create table public.recipe_lines (
  id                uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null references public.recipe_versions(id) on delete cascade,
  input_item_id     uuid not null references public.inventory_items(id) on delete restrict,
  qty               numeric(14,4) not null,
  is_packaging      boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  version integer not null default 1,
  constraint recipe_lines_qty_pos check (qty > 0),
  unique (recipe_version_id, input_item_id)
);
create index recipe_lines_input on public.recipe_lines(input_item_id);

-- ── cost_snapshots (SENSITIVE, append-only) ──────────────────────────────────
create table public.cost_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  recipe_version_id  uuid not null references public.recipe_versions(id) on delete restrict,
  snapshot_reason    public.cost_snapshot_reason not null default 'activation',
  total_cost         numeric(14,4) not null,
  unit_cost          numeric(14,4) not null,
  ingredient_cost    numeric(14,4) not null,
  packaging_cost     numeric(14,4) not null,
  waste_cost         numeric(14,4) not null,
  effective_output_qty numeric(14,4) not null,
  breakdown          jsonb not null default '[]'::jsonb,
  computed_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id),
  constraint cost_snapshots_costs_nonneg check (
    total_cost >= 0 and unit_cost >= 0 and ingredient_cost >= 0
    and packaging_cost >= 0 and waste_cost >= 0 and effective_output_qty > 0
  ),
  constraint cost_snapshots_breakdown_array check (jsonb_typeof(breakdown) = 'array')
);
create index cost_snapshots_version_time
  on public.cost_snapshots(recipe_version_id, computed_at desc);
comment on table public.cost_snapshots is
  'SENSITIVE and append-only: cost.read gated through SECURITY DEFINER functions.';
comment on column public.cost_snapshots.total_cost is 'SENSITIVE: cost.read gated at UI + DB.';
comment on column public.cost_snapshots.unit_cost is 'SENSITIVE: cost.read gated at UI + DB.';
comment on column public.cost_snapshots.breakdown is 'SENSITIVE: contains item-level cost inputs.';

-- ── Updated-at/version triggers ───────────────────────────────────────────────
create trigger set_updated_at before update on public.recipes
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.recipe_versions
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.recipe_lines
  for each row execute function public.tg_set_updated_at();

-- Activated versions may only transition from active to retired. Their content is historical.
create or replace function public.tg_guard_activated_recipe_version()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and old.activated_at is not null then
    raise exception 'Activated recipe versions are immutable';
  end if;

  if tg_op = 'UPDATE' and old.activated_at is not null then
    if old.is_active and not new.is_active
       and (to_jsonb(new) - 'is_active' - 'updated_at' - 'version')
           = (to_jsonb(old) - 'is_active' - 'updated_at' - 'version') then
      return new;
    end if;
    raise exception 'Activated recipe versions are immutable';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_activated_recipe_version
  before update or delete on public.recipe_versions
  for each row execute function public.tg_guard_activated_recipe_version();

create or replace function public.tg_guard_activated_recipe_lines()
returns trigger language plpgsql set search_path = public as $$
declare
  v_version_id uuid := coalesce(new.recipe_version_id, old.recipe_version_id);
begin
  if exists (
    select 1 from public.recipe_versions
    where id = v_version_id and activated_at is not null
  ) then
    raise exception 'Lines on an activated recipe version are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_activated_recipe_lines
  before insert or update or delete on public.recipe_lines
  for each row execute function public.tg_guard_activated_recipe_lines();

create or replace function public.tg_cost_snapshots_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Cost snapshots are append-only';
end;
$$;
create trigger cost_snapshots_append_only
  before update or delete on public.cost_snapshots
  for each row execute function public.tg_cost_snapshots_append_only();
