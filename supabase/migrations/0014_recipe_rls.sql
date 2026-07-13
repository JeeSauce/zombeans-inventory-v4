-- 0014_recipe_rls.sql
-- Recipe composition is recipe.read/recipe.write gated. Cost snapshots have no authenticated
-- table access; sensitive values are exposed only through 0015 permission-checking functions.

-- ── Table privileges ─────────────────────────────────────────────────────────
grant select on public.recipes, public.recipe_versions, public.recipe_lines to authenticated;

grant insert (
  name, kind, output_item_id, product_id, variant_id, modifier_option_id,
  active, created_by, updated_by
) on public.recipes to authenticated;
grant update (
  name, active, updated_by, version, deleted_at, deleted_by, purge_at
) on public.recipes to authenticated;
grant delete on public.recipes to authenticated;

grant insert (
  recipe_id, version_number, effective_date, output_qty, output_unit_id,
  expected_yield_pct, expected_waste_pct, prep_notes, created_by, updated_by
) on public.recipe_versions to authenticated;
grant update (
  effective_date, output_qty, output_unit_id, expected_yield_pct,
  expected_waste_pct, prep_notes, updated_by, version
) on public.recipe_versions to authenticated;
grant delete on public.recipe_versions to authenticated;

grant insert (
  recipe_version_id, input_item_id, qty, is_packaging, created_by, updated_by
) on public.recipe_lines to authenticated;
grant update (qty, is_packaging, updated_by, version) on public.recipe_lines to authenticated;
grant delete on public.recipe_lines to authenticated;

-- Intentionally no authenticated grants on cost_snapshots.
revoke all on public.cost_snapshots from authenticated;

grant select, insert, update, delete on
  public.recipes, public.recipe_versions, public.recipe_lines, public.cost_snapshots
  to service_role;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.recipes enable row level security;
alter table public.recipe_versions enable row level security;
alter table public.recipe_lines enable row level security;
alter table public.cost_snapshots enable row level security;

create policy recipes_select on public.recipes for select to authenticated
  using (deleted_at is null and public.has_permission(auth.uid(), 'recipe.read'));
create policy recipes_write on public.recipes for all to authenticated
  using (public.has_permission(auth.uid(), 'recipe.write'))
  with check (public.has_permission(auth.uid(), 'recipe.write'));

create policy recipe_versions_select on public.recipe_versions for select to authenticated
  using (
    public.has_permission(auth.uid(), 'recipe.read')
    and exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.deleted_at is null
    )
  );
create policy recipe_versions_write on public.recipe_versions for all to authenticated
  using (public.has_permission(auth.uid(), 'recipe.write') and activated_at is null)
  with check (public.has_permission(auth.uid(), 'recipe.write') and activated_at is null);

create policy recipe_lines_select on public.recipe_lines for select to authenticated
  using (
    public.has_permission(auth.uid(), 'recipe.read')
    and exists (
      select 1
      from public.recipe_versions rv
      join public.recipes r on r.id = rv.recipe_id
      where rv.id = recipe_version_id and r.deleted_at is null
    )
  );
create policy recipe_lines_write on public.recipe_lines for all to authenticated
  using (
    public.has_permission(auth.uid(), 'recipe.write')
    and exists (
      select 1 from public.recipe_versions rv
      where rv.id = recipe_version_id and rv.activated_at is null
    )
  )
  with check (
    public.has_permission(auth.uid(), 'recipe.write')
    and exists (
      select 1 from public.recipe_versions rv
      where rv.id = recipe_version_id and rv.activated_at is null
    )
  );

-- No authenticated policy on cost_snapshots. service_role bypasses RLS.
