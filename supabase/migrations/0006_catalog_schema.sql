-- 0006_catalog_schema.sql
-- Phase 2 — Org & Catalog domain: branches, branch assignments, categories, units + conversions,
-- unified inventory_items, products, variants, modifiers, per-branch pricing, barcodes, and the
-- application_settings key/value store (home of the VAT config).
-- RLS is enabled in 0007; functions in 0008; reference data seeded in 0009.

-- ── Enums ────────────────────────────────────────────────────────────────────
create type public.item_type as enum (
  'drink', 'food', 'raw_ingredient', 'sub_product', 'portioned_product', 'packaging', 'container'
);
create type public.unit_dimension  as enum ('mass', 'volume', 'count');
create type public.product_kind    as enum ('drink', 'food');
create type public.tax_mode        as enum ('none', 'inclusive', 'exclusive');
create type public.modifier_selection as enum ('single', 'multi');
create type public.modifier_affects   as enum ('price', 'inventory', 'both', 'none');
create type public.barcode_symbology  as enum ('ean13', 'ean8', 'upca', 'code128', 'qr', 'other');

-- ── branches ─────────────────────────────────────────────────────────────────
create table public.branches (
  id                    uuid primary key default gen_random_uuid(),
  key                   text not null unique,               -- short slug, e.g. 'main', 'bgc'
  name                  text not null,
  is_main               boolean not null default false,     -- central warehouse / factory
  holds_raw_ingredients boolean not null default false,
  active                boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id),
  updated_by  uuid references public.profiles (id),
  version     integer not null default 1,
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id),
  purge_at    timestamptz
);
comment on table public.branches is 'Physical locations: cafés/restaurants + central warehouse/factory.';
create unique index branches_one_main on public.branches (is_main) where is_main and deleted_at is null;

-- audit_logs.branch_id was created in Phase 1 without an FK (branches did not exist yet).
alter table public.audit_logs
  add constraint audit_logs_branch_id_fkey foreign key (branch_id) references public.branches (id);

-- ── user_branch_assignments (deferred from Phase 1) ──────────────────────────
-- Absent assignment ⇒ global visibility (Super Admin / Branch Manager in the MVP).
create table public.user_branch_assignments (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  branch_id   uuid not null references public.branches (id) on delete cascade,
  assigned_by uuid references public.profiles (id),
  assigned_at timestamptz not null default now(),
  primary key (profile_id, branch_id)
);

-- ── categories (self-referencing tree, scoped by item_type) ──────────────────
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  item_type   public.item_type not null,
  parent_id   uuid references public.categories (id) on delete restrict,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id),
  updated_by  uuid references public.profiles (id),
  version     integer not null default 1,
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id),
  purge_at    timestamptz,
  constraint categories_not_self_parent check (parent_id is null or parent_id <> id)
);
create unique index categories_unique_name
  on public.categories (item_type, lower(name)) where deleted_at is null;
create index categories_parent on public.categories (parent_id);

-- ── units + conversions ──────────────────────────────────────────────────────
create table public.units (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,                         -- g, kg, ml, l, pc, serving, ...
  name        text not null,
  dimension   public.unit_dimension not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id),
  updated_by  uuid references public.profiles (id),
  version     integer not null default 1
);
comment on table public.units is 'Measurement units. Item-specific conversions live in unit_conversions.';

-- factor: multiply a quantity in from_unit by `factor` to get to_unit.
-- item_id null ⇒ global conversion (e.g. 1 kg = 1000 g); non-null ⇒ item-specific (1 sack = 25 kg).
create table public.unit_conversions (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid,                                       -- FK added after inventory_items exists
  from_unit_id  uuid not null references public.units (id) on delete restrict,
  to_unit_id    uuid not null references public.units (id) on delete restrict,
  factor        numeric(18,6) not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles (id),
  updated_by    uuid references public.profiles (id),
  version       integer not null default 1,
  constraint unit_conversions_factor_pos check (factor > 0),
  constraint unit_conversions_distinct_units check (from_unit_id <> to_unit_id)
);
-- One conversion per (scope, from, to). Two partial indexes because NULLs don't compare equal.
create unique index unit_conversions_global_unique
  on public.unit_conversions (from_unit_id, to_unit_id) where item_id is null;
create unique index unit_conversions_item_unique
  on public.unit_conversions (item_id, from_unit_id, to_unit_id) where item_id is not null;

-- ── inventory_items (unified item table) ─────────────────────────────────────
create table public.inventory_items (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  sku                 text not null unique,
  item_type           public.item_type not null,
  category_id         uuid references public.categories (id) on delete set null,
  base_unit_id        uuid not null references public.units (id) on delete restrict,
  purchase_unit_id    uuid references public.units (id) on delete restrict,
  low_stock_threshold numeric(14,4),
  reorder_level       numeric(14,4),
  trackable           boolean not null default true,        -- appears in stock ledger/balances
  batch_tracked       boolean not null default false,
  expiry_tracked      boolean not null default false,
  is_consumable       boolean not null default true,        -- containers default false via app logic
  image_url           text,
  storage_notes       text,
  active              boolean not null default true,
  weighted_avg_cost   numeric(14,4) not null default 0,     -- SENSITIVE (cost.read); maintained in P3
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id),
  updated_by  uuid references public.profiles (id),
  version     integer not null default 1,
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id),
  purge_at    timestamptz,
  constraint inventory_items_low_stock_nonneg check (low_stock_threshold is null or low_stock_threshold >= 0),
  constraint inventory_items_reorder_nonneg   check (reorder_level is null or reorder_level >= 0)
);
comment on column public.inventory_items.weighted_avg_cost is 'SENSITIVE: cost.read gated at UI + DB.';
create index inventory_items_category on public.inventory_items (category_id);
create index inventory_items_type on public.inventory_items (item_type);
create index inventory_items_active on public.inventory_items (active) where deleted_at is null;

-- now that inventory_items exists, wire the optional item scope on unit_conversions
alter table public.unit_conversions
  add constraint unit_conversions_item_fkey
  foreign key (item_id) references public.inventory_items (id) on delete cascade;

-- ── products (sellable overlay on an item) ───────────────────────────────────
create table public.products (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null unique references public.inventory_items (id) on delete cascade,
  product_kind  public.product_kind not null,
  description   text,
  is_active     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id),
  updated_by  uuid references public.profiles (id),
  version     integer not null default 1,
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id),
  purge_at    timestamptz
);
comment on table public.products is 'Sellable overlay on an inventory_item; selling name comes from the item.';

-- ── product_variants ─────────────────────────────────────────────────────────
create table public.product_variants (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  name        text not null,                                -- e.g. Small / Medium / Large
  sku         text not null unique,
  barcode     text unique,                                  -- convenience; general barcodes table too
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id),
  updated_by  uuid references public.profiles (id),
  version     integer not null default 1,
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id),
  purge_at    timestamptz
);
create index product_variants_product on public.product_variants (product_id);
create unique index product_variants_name_unique
  on public.product_variants (product_id, lower(name)) where deleted_at is null;

-- ── modifiers + options ──────────────────────────────────────────────────────
create table public.modifiers (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  name        text not null,
  selection   public.modifier_selection not null default 'single',
  required    boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id),
  updated_by  uuid references public.profiles (id),
  version     integer not null default 1
);
create index modifiers_product on public.modifiers (product_id);

create table public.modifier_options (
  id            uuid primary key default gen_random_uuid(),
  modifier_id   uuid not null references public.modifiers (id) on delete cascade,
  name          text not null,
  affects       public.modifier_affects not null default 'none',
  price_delta   numeric(14,4) not null default 0,           -- applied when affects in (price, both)
  is_active     boolean not null default true,
  -- deduction_recipe_version_id linked in Phase 4 when recipes exist
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id),
  updated_by  uuid references public.profiles (id),
  version     integer not null default 1
);
create index modifier_options_modifier on public.modifier_options (modifier_id);

-- ── branch_prices (independent per branch — critical scenario 19) ────────────
-- A price targets EITHER a product (no variants) OR a specific variant, never both.
create table public.branch_prices (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches (id) on delete cascade,
  product_id  uuid references public.products (id) on delete cascade,
  variant_id  uuid references public.product_variants (id) on delete cascade,
  price       numeric(14,4) not null,
  tax_mode    public.tax_mode not null default 'none',      -- how VAT relates to this price
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id),
  updated_by  uuid references public.profiles (id),
  version     integer not null default 1,
  constraint branch_prices_price_nonneg check (price >= 0),
  constraint branch_prices_one_target check (num_nonnulls(product_id, variant_id) = 1)
);
comment on table public.branch_prices is 'Selling price per (branch, product|variant). Independent per branch.';
-- One active price row per target per branch (partial uniques: product-scope and variant-scope).
create unique index branch_prices_product_unique
  on public.branch_prices (branch_id, product_id) where product_id is not null;
create unique index branch_prices_variant_unique
  on public.branch_prices (branch_id, variant_id) where variant_id is not null;

-- ── barcodes (general, item-linked) ──────────────────────────────────────────
create table public.barcodes (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.inventory_items (id) on delete cascade,
  code        text not null unique,
  symbology   public.barcode_symbology not null default 'ean13',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id),
  updated_by  uuid references public.profiles (id),
  version     integer not null default 1
);
create index barcodes_item on public.barcodes (item_id);

-- ── application_settings (key/value config; home of VAT config) ──────────────
create table public.application_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id),
  version     integer not null default 1
);
comment on table public.application_settings is 'Global config (VAT, thresholds). Gated by settings.manage.';

-- ── updated_at / version triggers ────────────────────────────────────────────
create trigger set_updated_at before update on public.branches
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.categories
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.units
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.unit_conversions
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.inventory_items
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.products
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.product_variants
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.modifiers
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.modifier_options
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.branch_prices
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.barcodes
  for each row execute function public.tg_set_updated_at();
create trigger set_updated_at before update on public.application_settings
  for each row execute function public.tg_set_updated_at();
