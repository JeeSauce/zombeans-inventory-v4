-- 0018_production_functions.sql
-- Phase 5 — protected order planning and atomic/idempotent production completion.

create or replace function public.next_production_reference() returns text
language sql security definer set search_path = public as $$
  select 'PROD-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.production_ref_seq')::text, 5, '0')
$$;
revoke all on function public.next_production_reference() from public;
grant execute on function public.next_production_reference() to authenticated, service_role;

create or replace function public.create_production_order(
  p_template_id uuid,
  p_batch_multiplier numeric,
  p_idempotency_key text,
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_template public.production_templates%rowtype;
  v_version public.recipe_versions%rowtype;
  v_recipe public.recipes%rowtype;
  v_snapshot_id uuid;
  v_branch_id uuid;
  v_order_id uuid;
  v_reference text;
  v_existing public.production_orders%rowtype;
  v_line_count integer;
begin
  if v_user is null or not public.has_permission(v_user, 'production.create') then
    raise exception 'Permission denied: production.create required';
  end if;
  if p_batch_multiplier is null or p_batch_multiplier <= 0 then
    raise exception 'Batch multiplier must be positive';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  select * into v_existing from public.production_orders
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'id', v_existing.id,
      'reference', v_existing.reference,
      'already_exists', true
    );
  end if;

  select * into v_template from public.production_templates
  where id = p_template_id and active and deleted_at is null;
  if not found then raise exception 'Active production template not found'; end if;

  select * into v_recipe from public.recipes
  where id = v_template.recipe_id and kind = 'production' and active and deleted_at is null;
  if not found then raise exception 'Active production recipe not found'; end if;

  select * into v_version from public.recipe_versions
  where recipe_id = v_recipe.id and is_active
  order by activated_at desc limit 1;
  if not found then raise exception 'Production recipe has no active version'; end if;

  select id into v_snapshot_id from public.cost_snapshots
  where recipe_version_id = v_version.id and snapshot_reason = 'activation'
  order by computed_at desc, created_at desc limit 1;
  if v_snapshot_id is null then raise exception 'Active recipe version has no cost snapshot'; end if;

  select id into v_branch_id from public.branches
  where is_main and active and deleted_at is null
  order by created_at limit 1;
  if v_branch_id is null then raise exception 'Active Main branch not found'; end if;

  v_reference := public.next_production_reference();
  insert into public.production_orders (
    reference, template_id, recipe_version_id, cost_snapshot_id, branch_id,
    output_item_id, output_unit_id, status, batch_multiplier, planned_output_qty,
    notes, idempotency_key, created_by, updated_by
  ) values (
    v_reference, v_template.id, v_version.id, v_snapshot_id, v_branch_id,
    v_recipe.output_item_id, v_version.output_unit_id, 'draft', p_batch_multiplier,
    round(v_version.output_qty * p_batch_multiplier, 4), nullif(btrim(p_notes), ''),
    p_idempotency_key, v_user, v_user
  ) returning id into v_order_id;

  insert into public.production_order_inputs (
    production_order_id, recipe_line_id, item_id, unit_id, planned_qty
  )
  select v_order_id, rl.id, rl.input_item_id, ii.base_unit_id,
         round(rl.qty * p_batch_multiplier, 4)
  from public.recipe_lines rl
  join public.inventory_items ii on ii.id = rl.input_item_id
  where rl.recipe_version_id = v_version.id;
  get diagnostics v_line_count = row_count;
  if v_line_count = 0 then raise exception 'Production recipe has no input lines'; end if;

  return jsonb_build_object('id', v_order_id, 'reference', v_reference, 'already_exists', false);
end $$;
revoke all on function public.create_production_order(uuid, numeric, text, text) from public;
grant execute on function public.create_production_order(uuid, numeric, text, text)
  to authenticated, service_role;

create or replace function public.post_production_completion(p_production_order_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_order public.production_orders%rowtype;
  v_input record;
  v_movement record;
  v_lot record;
  v_remaining numeric(14,4);
  v_take numeric(14,4);
  v_consumption_txn_id uuid;
  v_waste_txn_id uuid;
  v_output_txn_id uuid;
  v_output_lot_id uuid;
  v_has_consumption boolean;
  v_has_waste boolean;
  v_item_name text;
  v_business_date date := (now() at time zone 'Asia/Manila')::date;
  v_snapshot_total numeric(14,4);
  v_output_unit_cost numeric(14,4);
  v_old_output_qty numeric(14,4);
  v_old_output_avg numeric(14,4);
  v_balance_rows integer;
begin
  if v_user is null or not public.has_permission(v_user, 'production.confirm') then
    raise exception 'Permission denied: production.confirm required';
  end if;

  select * into v_order from public.production_orders
  where id = p_production_order_id for update;
  if not found then raise exception 'Production order not found'; end if;

  if v_order.status = 'completed' then
    return v_order.production_output_txn_id;
  end if;
  if v_order.status <> 'awaiting_confirmation' then
    raise exception 'Production order must be awaiting confirmation';
  end if;
  if v_order.actual_output_qty is null or v_order.actual_output_qty <= 0
     or v_order.output_lot_number is null
     or v_order.production_date is null or v_order.expiration_date is null then
    raise exception 'Production actual output, lot, production date, and expiration are required';
  end if;
  if v_order.expiration_date < v_order.production_date
     or v_order.expiration_date < v_business_date then
    raise exception 'Production output expiration cannot be in the past';
  end if;
  if not exists (
    select 1 from public.branches where id = v_order.branch_id and is_main and active
  ) then
    raise exception 'Phase 5 production can post only to the active Main branch';
  end if;
  if not exists (
    select 1 from public.cost_snapshots cs
    where cs.id = v_order.cost_snapshot_id
      and cs.recipe_version_id = v_order.recipe_version_id
  ) then
    raise exception 'Production cost snapshot does not match the recipe version';
  end if;

  select coalesce(bool_or(actual_consumed_qty > 0), false),
         coalesce(bool_or(waste_qty > 0), false)
    into v_has_consumption, v_has_waste
  from public.production_order_inputs where production_order_id = v_order.id;
  if not v_has_consumption then raise exception 'Production requires actual input consumption'; end if;

  insert into public.stock_transactions (
    reference, type, status, source_branch_id, reason, production_order_id,
    created_by, approved_by, confirmed_at, idempotency_key, correlation_id
  ) values (
    public.next_stock_txn_reference(), 'production_consumption', 'posted', v_order.branch_id,
    'Production consumption for ' || v_order.reference, v_order.id,
    coalesce(v_order.recorded_by, v_order.created_by), v_user, now(),
    v_order.idempotency_key || ':consumption', v_order.correlation_id
  ) returning id into v_consumption_txn_id;

  if v_has_waste then
    insert into public.stock_transactions (
      reference, type, status, source_branch_id, reason, production_order_id,
      created_by, approved_by, confirmed_at, idempotency_key, correlation_id
    ) values (
      public.next_stock_txn_reference(), 'waste', 'posted', v_order.branch_id,
      'Production waste for ' || v_order.reference, v_order.id,
      coalesce(v_order.recorded_by, v_order.created_by), v_user, now(),
      v_order.idempotency_key || ':waste', v_order.correlation_id
    ) returning id into v_waste_txn_id;
  end if;

  insert into public.stock_transactions (
    reference, type, status, dest_branch_id, reason, production_order_id,
    created_by, approved_by, confirmed_at, idempotency_key, correlation_id
  ) values (
    public.next_stock_txn_reference(), 'production_output', 'posted', v_order.branch_id,
    'Production output for ' || v_order.reference, v_order.id,
    coalesce(v_order.recorded_by, v_order.created_by), v_user, now(),
    v_order.idempotency_key || ':output', v_order.correlation_id
  ) returning id into v_output_txn_id;

  for v_input in
    select poi.*, ii.name as item_name
    from public.production_order_inputs poi
    join public.inventory_items ii on ii.id = poi.item_id
    where poi.production_order_id = v_order.id
    order by poi.created_at, poi.id
  loop
    for v_movement in
      select v_input.actual_consumed_qty::numeric as qty, v_consumption_txn_id as txn_id
      union all
      select v_input.waste_qty::numeric, v_waste_txn_id
    loop
      if v_movement.qty <= 0 then continue; end if;
      v_remaining := v_movement.qty;

      for v_lot in
        select id, qty_remaining, unit_cost
        from public.inventory_lots
        where item_id = v_input.item_id and branch_id = v_order.branch_id
          and status = 'available' and qty_remaining > 0
          and (expiration_date is null or expiration_date >= v_business_date)
        order by expiration_date asc nulls last, received_date asc, created_at asc, id asc
        for update
      loop
        exit when v_remaining <= 0;
        v_take := least(v_remaining, v_lot.qty_remaining);

        update public.inventory_lots
          set qty_remaining = qty_remaining - v_take
          where id = v_lot.id;
        update public.inventory_balances
          set qty_on_hand = qty_on_hand - v_take, updated_at = now()
          where item_id = v_input.item_id and branch_id = v_order.branch_id;
        get diagnostics v_balance_rows = row_count;
        if v_balance_rows <> 1 then
          raise exception 'Inventory balance missing for %', v_input.item_name;
        end if;

        insert into public.stock_transaction_lines (
          txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot
        ) values (
          v_movement.txn_id, v_input.item_id, -v_take, v_input.unit_id,
          v_lot.id, v_lot.unit_cost
        );
        v_remaining := round(v_remaining - v_take, 4);
      end loop;

      if v_remaining > 0 then
        raise exception 'Insufficient unexpired available stock for %', v_input.item_name;
      end if;
    end loop;
  end loop;

  select total_cost into v_snapshot_total from public.cost_snapshots
  where id = v_order.cost_snapshot_id;
  v_output_unit_cost := round(
    (v_snapshot_total * v_order.batch_multiplier) / v_order.actual_output_qty,
    4
  );

  insert into public.inventory_lots (
    item_id, branch_id, lot_number, received_date, expiration_date,
    qty_remaining, unit_cost, status
  ) values (
    v_order.output_item_id, v_order.branch_id, btrim(v_order.output_lot_number),
    v_order.production_date, v_order.expiration_date, v_order.actual_output_qty,
    v_output_unit_cost, 'available'
  ) returning id into v_output_lot_id;

  -- Preserve the Phase 3 weighted-average projection for downstream costing. Lock the item before
  -- reading its current average, and use the pre-production branch balance as the old quantity.
  select weighted_avg_cost into v_old_output_avg from public.inventory_items
  where id = v_order.output_item_id for update;
  select qty_on_hand into v_old_output_qty from public.inventory_balances
  where item_id = v_order.output_item_id and branch_id = v_order.branch_id;
  v_old_output_qty := coalesce(v_old_output_qty, 0);

  insert into public.inventory_balances (item_id, branch_id, qty_on_hand, updated_at)
  values (v_order.output_item_id, v_order.branch_id, v_order.actual_output_qty, now())
  on conflict (item_id, branch_id) do update
    set qty_on_hand = public.inventory_balances.qty_on_hand + excluded.qty_on_hand,
        updated_at = now();

  update public.inventory_items set
    weighted_avg_cost = case
      when v_old_output_qty <= 0 then v_output_unit_cost
      else round(
        (v_old_output_qty * coalesce(v_old_output_avg, 0)
          + v_order.actual_output_qty * v_output_unit_cost)
        / (v_old_output_qty + v_order.actual_output_qty),
        4
      )
    end
  where id = v_order.output_item_id;

  insert into public.stock_transaction_lines (
    txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot
  ) values (
    v_output_txn_id, v_order.output_item_id, v_order.actual_output_qty,
    v_order.output_unit_id, v_output_lot_id, v_output_unit_cost
  );

  update public.production_orders set
    status = 'completed', confirmed_at = now(), confirmed_by = v_user,
    production_output_txn_id = v_output_txn_id, updated_by = v_user
  where id = v_order.id;

  return v_output_txn_id;
end $$;
revoke all on function public.post_production_completion(uuid) from public;
grant execute on function public.post_production_completion(uuid) to authenticated, service_role;
