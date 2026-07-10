-- 0007_catalog_rls.sql
-- Row Level Security for the Org & Catalog domain. Mirrors the server-side permission checks;
-- RLS is the real backstop. Permission slugs come from 0004:
--   catalog.item.read / catalog.item.write · price.read / price.write · cost.read · settings.manage.
--
-- Sensitive data (rule 4): the weighted-average cost column is revoked from `authenticated` at the
-- DB layer — hiding it in the UI is not enough. Cost-gated read paths arrive with costing (P4).
-- application_settings (VAT config + thresholds) is readable only by settings.manage; pricing code
-- reaches the VAT config through the SECURITY DEFINER tax_config() helper (0008), never a raw select.

-- ── Table privileges ─────────────────────────────────────────────────────────
grant select, insert, update, delete on
  public.branches,
  public.user_branch_assignments,
  public.categories,
  public.units,
  public.unit_conversions,
  public.products,
  public.product_variants,
  public.modifiers,
  public.modifier_options,
  public.branch_prices,
  public.barcodes
  to authenticated;
grant select, insert, update, delete on public.application_settings to authenticated;

-- inventory_items: the weighted_avg_cost column is SENSITIVE (rule 4). A table-level SELECT grant
-- would implicitly cover every column and cannot be carved back with REVOKE, so `authenticated` is
-- granted column-by-column, omitting weighted_avg_cost. Cost-gated read paths (for cost.read) arrive
-- with costing in Phase 4; the raw column stays server-only (service_role) until then.
grant select (
  id, name, sku, item_type, category_id, base_unit_id, purchase_unit_id, low_stock_threshold,
  reorder_level, trackable, batch_tracked, expiry_tracked, is_consumable, image_url, storage_notes,
  active, created_at, updated_at, created_by, updated_by, version, deleted_at, deleted_by, purge_at
) on public.inventory_items to authenticated;
grant insert (
  name, sku, item_type, category_id, base_unit_id, purchase_unit_id, low_stock_threshold,
  reorder_level, trackable, batch_tracked, expiry_tracked, is_consumable, image_url, storage_notes,
  active, created_by, updated_by, deleted_at, deleted_by, purge_at
) on public.inventory_items to authenticated;
grant update (
  name, sku, item_type, category_id, base_unit_id, purchase_unit_id, low_stock_threshold,
  reorder_level, trackable, batch_tracked, expiry_tracked, is_consumable, image_url, storage_notes,
  active, updated_by, version, deleted_at, deleted_by, purge_at
) on public.inventory_items to authenticated;
grant delete on public.inventory_items to authenticated;

-- Service role (BYPASSRLS) still needs explicit grants; it owns cost maintenance + privileged paths.
grant select, insert, update, delete on
  public.branches,
  public.user_branch_assignments,
  public.categories,
  public.units,
  public.unit_conversions,
  public.inventory_items,
  public.products,
  public.product_variants,
  public.modifiers,
  public.modifier_options,
  public.branch_prices,
  public.barcodes,
  public.application_settings
  to service_role;

-- ── Enable RLS ───────────────────────────────────────────────────────────────
alter table public.branches                enable row level security;
alter table public.user_branch_assignments enable row level security;
alter table public.categories              enable row level security;
alter table public.units                   enable row level security;
alter table public.unit_conversions        enable row level security;
alter table public.inventory_items         enable row level security;
alter table public.products                enable row level security;
alter table public.product_variants        enable row level security;
alter table public.modifiers               enable row level security;
alter table public.modifier_options        enable row level security;
alter table public.branch_prices           enable row level security;
alter table public.barcodes                enable row level security;
alter table public.application_settings    enable row level security;

-- ── branches ─────────────────────────────────────────────────────────────────
-- Everyone with catalog read sees non-deleted branches; managers/admins also see inactive ones.
create policy branches_select on public.branches for select to authenticated
  using (
    deleted_at is null
    and public.has_permission(auth.uid(), 'catalog.item.read')
    and (active or public.has_permission(auth.uid(), 'settings.manage'))
  );
create policy branches_write on public.branches for all to authenticated
  using (public.has_permission(auth.uid(), 'settings.manage'))
  with check (public.has_permission(auth.uid(), 'settings.manage'));

-- ── user_branch_assignments ──────────────────────────────────────────────────
create policy uba_select on public.user_branch_assignments for select to authenticated
  using (profile_id = auth.uid() or public.has_permission(auth.uid(), 'users.manage'));
create policy uba_write on public.user_branch_assignments for all to authenticated
  using (public.has_permission(auth.uid(), 'users.manage'))
  with check (public.has_permission(auth.uid(), 'users.manage'));

-- ── categories / units / unit_conversions / items / products / variants /
--    modifiers / modifier_options / barcodes — catalog read vs catalog write ──
create policy categories_select on public.categories for select to authenticated
  using (deleted_at is null and public.has_permission(auth.uid(), 'catalog.item.read'));
create policy categories_write on public.categories for all to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.write'))
  with check (public.has_permission(auth.uid(), 'catalog.item.write'));

create policy units_select on public.units for select to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.read'));
create policy units_write on public.units for all to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.write'))
  with check (public.has_permission(auth.uid(), 'catalog.item.write'));

create policy unit_conversions_select on public.unit_conversions for select to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.read'));
create policy unit_conversions_write on public.unit_conversions for all to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.write'))
  with check (public.has_permission(auth.uid(), 'catalog.item.write'));

create policy inventory_items_select on public.inventory_items for select to authenticated
  using (deleted_at is null and public.has_permission(auth.uid(), 'catalog.item.read'));
create policy inventory_items_write on public.inventory_items for all to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.write'))
  with check (public.has_permission(auth.uid(), 'catalog.item.write'));

create policy products_select on public.products for select to authenticated
  using (deleted_at is null and public.has_permission(auth.uid(), 'catalog.item.read'));
create policy products_write on public.products for all to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.write'))
  with check (public.has_permission(auth.uid(), 'catalog.item.write'));

create policy product_variants_select on public.product_variants for select to authenticated
  using (deleted_at is null and public.has_permission(auth.uid(), 'catalog.item.read'));
create policy product_variants_write on public.product_variants for all to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.write'))
  with check (public.has_permission(auth.uid(), 'catalog.item.write'));

create policy modifiers_select on public.modifiers for select to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.read'));
create policy modifiers_write on public.modifiers for all to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.write'))
  with check (public.has_permission(auth.uid(), 'catalog.item.write'));

create policy modifier_options_select on public.modifier_options for select to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.read'));
create policy modifier_options_write on public.modifier_options for all to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.write'))
  with check (public.has_permission(auth.uid(), 'catalog.item.write'));

create policy barcodes_select on public.barcodes for select to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.read'));
create policy barcodes_write on public.barcodes for all to authenticated
  using (public.has_permission(auth.uid(), 'catalog.item.write'))
  with check (public.has_permission(auth.uid(), 'catalog.item.write'));

-- ── branch_prices — selling prices gated by price.read / price.write ─────────
create policy branch_prices_select on public.branch_prices for select to authenticated
  using (public.has_permission(auth.uid(), 'price.read'));
create policy branch_prices_write on public.branch_prices for all to authenticated
  using (public.has_permission(auth.uid(), 'price.write'))
  with check (public.has_permission(auth.uid(), 'price.write'));

-- ── application_settings — settings.manage only (VAT reached via tax_config()) ─
create policy application_settings_select on public.application_settings for select to authenticated
  using (public.has_permission(auth.uid(), 'settings.manage'));
create policy application_settings_write on public.application_settings for all to authenticated
  using (public.has_permission(auth.uid(), 'settings.manage'))
  with check (public.has_permission(auth.uid(), 'settings.manage'));
