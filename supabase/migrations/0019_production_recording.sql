-- 0019_production_recording.sql
-- Record all production actuals and submit for confirmation in one server-side transaction.

create or replace function public.record_production_actuals(
  p_production_order_id uuid,
  p_actual_output_qty numeric,
  p_output_lot_number text,
  p_production_date date,
  p_expiration_date date,
  p_notes text,
  p_inputs jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_order public.production_orders%rowtype;
  v_input jsonb;
  v_expected_count integer;
  v_distinct_count integer;
  v_actual numeric;
  v_waste numeric;
begin
  if v_user is null or not public.has_permission(v_user, 'production.record') then
    raise exception 'Permission denied: production.record required';
  end if;

  select * into v_order from public.production_orders
  where id = p_production_order_id for update;
  if not found then raise exception 'Production order not found'; end if;
  if v_order.status <> 'in_progress' then
    raise exception 'Production order must be in progress';
  end if;
  if p_actual_output_qty is null or p_actual_output_qty <= 0 then
    raise exception 'Actual output must be greater than zero';
  end if;
  if p_output_lot_number is null or length(btrim(p_output_lot_number)) = 0 then
    raise exception 'Output batch or lot number is required';
  end if;
  if p_production_date is null or p_expiration_date is null
     or p_expiration_date < p_production_date then
    raise exception 'Expiration cannot be before the production date';
  end if;
  if jsonb_typeof(p_inputs) <> 'array' then raise exception 'Production inputs are required'; end if;

  select count(*)::int into v_expected_count from public.production_order_inputs
  where production_order_id = v_order.id;
  select count(distinct value->>'id')::int into v_distinct_count
  from jsonb_array_elements(p_inputs);
  if jsonb_array_length(p_inputs) <> v_expected_count or v_distinct_count <> v_expected_count then
    raise exception 'Every production input must be recorded exactly once';
  end if;

  for v_input in select value from jsonb_array_elements(p_inputs)
  loop
    begin
      v_actual := (v_input->>'actual_consumed_qty')::numeric;
      v_waste := (v_input->>'waste_qty')::numeric;
    exception when invalid_text_representation then
      raise exception 'Production input quantities must be numeric';
    end;
    if v_actual < 0 or v_waste < 0 then
      raise exception 'Production input quantities cannot be negative';
    end if;

    update public.production_order_inputs set
      actual_consumed_qty = v_actual,
      waste_qty = v_waste,
      notes = nullif(btrim(v_input->>'notes'), '')
    where id = (v_input->>'id')::uuid and production_order_id = v_order.id;
    if not found then raise exception 'Production input does not belong to this order'; end if;
  end loop;

  update public.production_orders set
    status = 'awaiting_confirmation',
    actual_output_qty = p_actual_output_qty,
    output_lot_number = btrim(p_output_lot_number),
    production_date = p_production_date,
    expiration_date = p_expiration_date,
    notes = nullif(btrim(p_notes), ''),
    recorded_at = now(), recorded_by = v_user,
    submitted_at = now(), submitted_by = v_user,
    updated_by = v_user
  where id = v_order.id;
end $$;
revoke all on function public.record_production_actuals(uuid, numeric, text, date, date, text, jsonb)
  from public;
grant execute on function public.record_production_actuals(uuid, numeric, text, date, date, text, jsonb)
  to authenticated, service_role;
