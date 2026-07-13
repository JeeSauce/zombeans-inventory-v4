-- 0015_recipe_functions.sql
-- Phase 4 validation, recursive protected costing, atomic activation, and dashboard RPCs.

-- ── Row validation ────────────────────────────────────────────────────────────
create or replace function public.tg_validate_recipe_target()
returns trigger language plpgsql set search_path = public as $$
declare
  v_target_item uuid;
  v_output_type public.item_type;
  v_modifier_affects public.modifier_affects;
begin
  select item_type into v_output_type
  from public.inventory_items
  where id = new.output_item_id;

  if new.kind = 'production'
     and v_output_type not in ('sub_product', 'portioned_product', 'drink', 'food') then
    raise exception 'Production recipes must output a prepared or sellable item';
  end if;

  if new.kind = 'sale' and new.product_id is not null then
    select item_id into v_target_item from public.products where id = new.product_id;
  elsif new.kind = 'sale' and new.variant_id is not null then
    select p.item_id into v_target_item
    from public.product_variants pv join public.products p on p.id = pv.product_id
    where pv.id = new.variant_id;
  elsif new.kind = 'modifier' then
    select p.item_id, mo.affects into v_target_item, v_modifier_affects
    from public.modifier_options mo
    join public.modifiers m on m.id = mo.modifier_id
    join public.products p on p.id = m.product_id
    where mo.id = new.modifier_option_id;
    if v_modifier_affects not in ('inventory', 'both') then
      raise exception 'Modifier recipes require an inventory-affecting option';
    end if;
  else
    return new;
  end if;

  if v_target_item is null or v_target_item <> new.output_item_id then
    raise exception 'Recipe output item does not match its product, variant, or modifier target';
  end if;
  return new;
end;
$$;
create trigger validate_recipe_target
  before insert or update of kind, output_item_id, product_id, variant_id, modifier_option_id
  on public.recipes for each row execute function public.tg_validate_recipe_target();

create or replace function public.tg_validate_recipe_version_unit()
returns trigger language plpgsql set search_path = public as $$
declare
  v_base_unit uuid;
begin
  select i.base_unit_id into v_base_unit
  from public.recipes r join public.inventory_items i on i.id = r.output_item_id
  where r.id = new.recipe_id;

  if v_base_unit is null or v_base_unit <> new.output_unit_id then
    raise exception 'Recipe output quantity must use the output item base unit';
  end if;
  return new;
end;
$$;
create trigger validate_recipe_version_unit
  before insert or update of recipe_id, output_unit_id on public.recipe_versions
  for each row execute function public.tg_validate_recipe_version_unit();

create or replace function public.tg_validate_recipe_line()
returns trigger language plpgsql set search_path = public as $$
declare
  v_kind public.recipe_kind;
  v_item_type public.item_type;
begin
  select r.kind, i.item_type into v_kind, v_item_type
  from public.recipe_versions rv
  join public.recipes r on r.id = rv.recipe_id
  join public.inventory_items i on i.id = new.input_item_id
  where rv.id = new.recipe_version_id;

  if v_kind is null or v_item_type is null then
    raise exception 'Recipe version or input item not found';
  end if;

  if new.is_packaging <> (v_item_type in ('packaging', 'container')) then
    raise exception 'Packaging flag must match a packaging or container input';
  end if;

  if v_kind in ('sale', 'modifier') and v_item_type = 'raw_ingredient' then
    raise exception 'Sale and modifier recipes cannot directly consume raw ingredients';
  end if;

  if v_kind in ('sale', 'modifier')
     and v_item_type not in ('sub_product', 'portioned_product', 'packaging', 'container') then
    raise exception 'Sale and modifier recipes may only consume prepared items and packaging';
  end if;

  return new;
end;
$$;
create trigger validate_recipe_line
  before insert or update of recipe_version_id, input_item_id, is_packaging
  on public.recipe_lines for each row execute function public.tg_validate_recipe_line();

-- ── Internal recursive calculation ───────────────────────────────────────────
create or replace function public._calculate_recipe_cost_internal(
  p_recipe_version_id uuid,
  p_path uuid[],
  p_depth integer,
  p_override_recipe_id uuid,
  p_override_version_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_version record;
  v_line record;
  v_sub_recipe_id uuid;
  v_sub_version_id uuid;
  v_nested jsonb;
  v_source_cost numeric(14,4);
  v_extended numeric(14,4);
  v_ingredient numeric(14,4) := 0;
  v_packaging numeric(14,4) := 0;
  v_waste numeric(14,4);
  v_total numeric(14,4);
  v_effective_output numeric(14,4);
  v_unit_cost numeric(14,4);
  v_breakdown jsonb := '[]'::jsonb;
begin
  if p_depth > 32 then
    raise exception 'Recipe nesting exceeds the maximum depth of 32';
  end if;
  if p_recipe_version_id = any(coalesce(p_path, array[]::uuid[])) then
    raise exception 'Recipe cycle detected';
  end if;

  select
    rv.id, rv.recipe_id, rv.output_qty, rv.expected_yield_pct, rv.expected_waste_pct,
    r.kind, r.output_item_id
  into v_version
  from public.recipe_versions rv
  join public.recipes r on r.id = rv.recipe_id
  where rv.id = p_recipe_version_id and r.deleted_at is null;

  if not found then
    raise exception 'Recipe version not found';
  end if;

  for v_line in
    select
      rl.input_item_id, rl.qty, rl.is_packaging,
      i.name item_name, i.sku, i.item_type, i.is_consumable, i.weighted_avg_cost,
      u.code unit_code
    from public.recipe_lines rl
    join public.inventory_items i on i.id = rl.input_item_id
    join public.units u on u.id = i.base_unit_id
    where rl.recipe_version_id = p_recipe_version_id
    order by i.name, i.id
  loop
    v_sub_recipe_id := null;
    v_sub_version_id := null;
    v_nested := null;

    if v_line.item_type = 'container' and not v_line.is_consumable then
      v_source_cost := 0;
    else
      select r.id into v_sub_recipe_id
      from public.recipes r
      where r.kind = 'production'
        and r.output_item_id = v_line.input_item_id
        and r.active and r.deleted_at is null;

      if v_sub_recipe_id is not null then
        if v_sub_recipe_id = p_override_recipe_id then
          v_sub_version_id := p_override_version_id;
        else
          select rv.id into v_sub_version_id
          from public.recipe_versions rv
          where rv.recipe_id = v_sub_recipe_id and rv.is_active;
        end if;
      end if;

      if v_sub_version_id is not null then
        v_nested := public._calculate_recipe_cost_internal(
          v_sub_version_id,
          coalesce(p_path, array[]::uuid[]) || p_recipe_version_id,
          p_depth + 1,
          p_override_recipe_id,
          p_override_version_id
        );
        v_source_cost := round((v_nested->>'unit_cost')::numeric, 4);
      else
        v_source_cost := round(coalesce(v_line.weighted_avg_cost, 0), 4);
      end if;
    end if;

    v_extended := round(v_line.qty * v_source_cost, 4);
    if v_line.is_packaging then
      v_packaging := v_packaging + v_extended;
    else
      v_ingredient := v_ingredient + v_extended;
    end if;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'item_id', v_line.input_item_id,
      'name', v_line.item_name,
      'sku', v_line.sku,
      'qty', v_line.qty,
      'unit', v_line.unit_code,
      'is_packaging', v_line.is_packaging,
      'nested_recipe', v_sub_version_id is not null,
      'source_unit_cost', v_source_cost,
      'extended_cost', v_extended
    ));
  end loop;

  v_waste := round(v_ingredient * v_version.expected_waste_pct / 100, 4);
  v_effective_output := round(v_version.output_qty * v_version.expected_yield_pct / 100, 4);
  if v_effective_output <= 0 then
    raise exception 'Effective recipe output must be positive';
  end if;
  v_total := round(v_ingredient + v_packaging + v_waste, 4);
  v_unit_cost := round(v_total / v_effective_output, 4);

  return jsonb_build_object(
    'recipe_version_id', p_recipe_version_id,
    'ingredient_cost', round(v_ingredient, 4),
    'packaging_cost', round(v_packaging, 4),
    'waste_cost', v_waste,
    'total_cost', v_total,
    'effective_output_qty', v_effective_output,
    'unit_cost', v_unit_cost,
    'breakdown', v_breakdown
  );
end;
$$;
revoke all on function public._calculate_recipe_cost_internal(uuid, uuid[], integer, uuid, uuid)
  from public, authenticated;
grant execute on function public._calculate_recipe_cost_internal(uuid, uuid[], integer, uuid, uuid)
  to service_role;

-- ── Protected public RPCs ────────────────────────────────────────────────────
create or replace function public.calculate_recipe_cost(p_recipe_version_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_recipe_id uuid;
begin
  if not public.has_permission(auth.uid(), 'cost.read') then
    raise exception 'Permission denied: cost.read required';
  end if;
  select recipe_id into v_recipe_id from public.recipe_versions where id = p_recipe_version_id;
  if v_recipe_id is null then raise exception 'Recipe version not found'; end if;
  return public._calculate_recipe_cost_internal(
    p_recipe_version_id, array[]::uuid[], 0, v_recipe_id, p_recipe_version_id
  );
end;
$$;
revoke all on function public.calculate_recipe_cost(uuid) from public;
grant execute on function public.calculate_recipe_cost(uuid) to authenticated, service_role;

create or replace function public.activate_recipe_version(p_recipe_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version record;
  v_cost jsonb;
  v_snapshot_id uuid;
begin
  if not public.has_permission(auth.uid(), 'recipe.write')
     or not public.has_permission(auth.uid(), 'cost.read') then
    raise exception 'Permission denied: recipe.write and cost.read required';
  end if;

  select rv.id, rv.recipe_id, rv.is_active, rv.activated_at
  into v_version
  from public.recipe_versions rv
  where rv.id = p_recipe_version_id
  for update;
  if not found then raise exception 'Recipe version not found'; end if;

  -- Serialize competing activations for the same recipe, even when they target different drafts.
  perform 1 from public.recipes where id = v_version.recipe_id for update;

  if v_version.is_active and v_version.activated_at is not null then
    select id into v_snapshot_id
    from public.cost_snapshots
    where recipe_version_id = p_recipe_version_id and snapshot_reason = 'activation'
    order by computed_at desc limit 1;
    return jsonb_build_object('snapshot_id', v_snapshot_id, 'already_active', true);
  end if;
  if v_version.activated_at is not null then
    raise exception 'A retired recipe version cannot be reactivated; create a new version';
  end if;
  if not exists (select 1 from public.recipe_lines where recipe_version_id = p_recipe_version_id) then
    raise exception 'A recipe version must contain at least one line before activation';
  end if;

  v_cost := public._calculate_recipe_cost_internal(
    p_recipe_version_id, array[]::uuid[], 0, v_version.recipe_id, p_recipe_version_id
  );

  update public.recipe_versions
  set is_active = false
  where recipe_id = v_version.recipe_id and is_active and id <> p_recipe_version_id;

  update public.recipe_versions
  set is_active = true, activated_at = now(), activated_by = auth.uid(), updated_by = auth.uid()
  where id = p_recipe_version_id;

  insert into public.cost_snapshots (
    recipe_version_id, snapshot_reason, total_cost, unit_cost,
    ingredient_cost, packaging_cost, waste_cost, effective_output_qty,
    breakdown, created_by
  ) values (
    p_recipe_version_id, 'activation',
    (v_cost->>'total_cost')::numeric,
    (v_cost->>'unit_cost')::numeric,
    (v_cost->>'ingredient_cost')::numeric,
    (v_cost->>'packaging_cost')::numeric,
    (v_cost->>'waste_cost')::numeric,
    (v_cost->>'effective_output_qty')::numeric,
    v_cost->'breakdown', auth.uid()
  ) returning id into v_snapshot_id;

  return v_cost || jsonb_build_object('snapshot_id', v_snapshot_id, 'already_active', false);
end;
$$;
revoke all on function public.activate_recipe_version(uuid) from public;
grant execute on function public.activate_recipe_version(uuid) to authenticated, service_role;

create or replace function public.recipe_cost_snapshot(p_recipe_version_id uuid)
returns table (
  snapshot_id uuid,
  snapshot_reason public.cost_snapshot_reason,
  total_cost numeric,
  unit_cost numeric,
  ingredient_cost numeric,
  packaging_cost numeric,
  waste_cost numeric,
  effective_output_qty numeric,
  breakdown jsonb,
  computed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_permission(auth.uid(), 'cost.read') then
    raise exception 'Permission denied: cost.read required';
  end if;
  return query
    select cs.id, cs.snapshot_reason, cs.total_cost, cs.unit_cost,
           cs.ingredient_cost, cs.packaging_cost, cs.waste_cost,
           cs.effective_output_qty, cs.breakdown, cs.computed_at
    from public.cost_snapshots cs
    where cs.recipe_version_id = p_recipe_version_id
    order by cs.computed_at desc
    limit 1;
end;
$$;
revoke all on function public.recipe_cost_snapshot(uuid) from public;
grant execute on function public.recipe_cost_snapshot(uuid) to authenticated, service_role;
