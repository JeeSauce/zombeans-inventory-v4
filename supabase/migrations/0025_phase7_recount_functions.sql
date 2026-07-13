-- 0025_phase7_recount_functions.sql
-- Phase 7 atomic/idempotent recount, adjustment, day-close, and reopen functions.

create or replace function public.next_recount_reference() returns text
language sql volatile security definer set search_path = public as $$
  select 'RCT-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.recount_ref_seq')::text, 5, '0')
$$;
create or replace function public.next_recount_adjustment_reference() returns text
language sql volatile security definer set search_path = public as $$
  select 'ADJ-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.recount_adjustment_ref_seq')::text, 5, '0')
$$;
create or replace function public.next_day_close_reference() returns text
language sql volatile security definer set search_path = public as $$
  select 'DAY-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.day_close_ref_seq')::text, 5, '0')
$$;
create or replace function public.next_day_close_event_reference() returns text
language sql volatile security definer set search_path = public as $$
  select 'DCE-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.day_close_event_ref_seq')::text, 5, '0')
$$;
revoke all on function public.next_recount_reference() from public;
revoke all on function public.next_recount_adjustment_reference() from public;
revoke all on function public.next_day_close_reference() from public;
revoke all on function public.next_day_close_event_reference() from public;

-- Raises while closed and otherwise returns the latest reopen event to attribute later changes.
create or replace function public.assert_business_day_open(p_branch_id uuid, p_business_date date)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_closure public.daily_operational_closures%rowtype;
  v_event_type public.day_close_event_type;
begin
  select * into v_closure
  from public.daily_operational_closures
  where branch_id = p_branch_id and business_date = p_business_date;

  if not found then return null; end if;
  if v_closure.status = 'closed' then
    raise exception 'Business day % is closed for this branch', p_business_date;
  end if;

  select event_type into v_event_type
  from public.day_close_events where id = v_closure.latest_event_id;
  if v_event_type is distinct from 'reopen'::public.day_close_event_type then
    raise exception 'Reopened day is missing its audit event';
  end if;
  return v_closure.latest_event_id;
end;
$$;
revoke all on function public.assert_business_day_open(uuid, date) from public;

-- This guard also covers Phase 1–6 posting functions: no ledger insert can bypass a closed day.
create or replace function public.tg_guard_stock_transaction_business_day()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_branch_id uuid;
  v_transfer_status public.transfer_status;
  v_business_date date;
begin
  if new.source_branch_id is not null and new.source_branch_id = new.dest_branch_id then
    v_branch_id := new.source_branch_id;
  elsif new.type = 'transfer' and new.transfer_id is not null then
    select status into v_transfer_status from public.transfers where id = new.transfer_id;
    if v_transfer_status = 'prepared' then
      v_branch_id := new.source_branch_id;
    else
      v_branch_id := new.dest_branch_id;
    end if;
  elsif new.type in ('stock_in', 'batch_stock_in', 'purchase_receiving',
                     'production_output', 'pos_refund') then
    v_branch_id := new.dest_branch_id;
  else
    v_branch_id := coalesce(new.source_branch_id, new.dest_branch_id);
  end if;

  if v_branch_id is null then return new; end if;
  v_business_date := (coalesce(new.created_at, now()) at time zone 'Asia/Manila')::date;
  new.day_reopen_event_id := public.assert_business_day_open(v_branch_id, v_business_date);
  return new;
end;
$$;
create trigger guard_stock_transaction_business_day
  before insert on public.stock_transactions
  for each row execute function public.tg_guard_stock_transaction_business_day();

create or replace function public.open_recount(
  p_branch_id uuid,
  p_business_date date,
  p_type public.recount_session_type,
  p_idempotency_key text,
  p_item_ids jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_session public.recount_sessions%rowtype;
  v_item record;
  v_reference text;
  v_snapshot timestamptz := clock_timestamp();
  v_day_start timestamptz;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_reopen_event_id uuid;
  v_requested integer;
  v_distinct integer;
  v_eligible integer;
  v_opening numeric(14,4);
  v_received numeric(14,4);
  v_output numeric(14,4);
  v_transfers_out numeric(14,4);
  v_usage numeric(14,4);
  v_stock_out numeric(14,4);
  v_waste numeric(14,4);
  v_expected numeric(14,4);
  v_ledger numeric(14,4);
  v_cost numeric(14,4);
  v_has_cost boolean;
begin
  if v_user is null or not public.has_permission(v_user, 'recount.perform') then
    raise exception 'Permission denied: recount.perform required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  if p_business_date is null then raise exception 'Business date is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended('recount-open:' || p_idempotency_key, 0));
  select * into v_session from public.recount_sessions
  where open_idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('id', v_session.id, 'reference', v_session.reference,
      'status', v_session.status, 'already_exists', true);
  end if;

  if p_business_date <> v_today then
    raise exception 'Recounts may be opened only for the current Asia/Manila business date';
  end if;
  perform 1 from public.branches
  where id = p_branch_id and active and deleted_at is null;
  if not found then raise exception 'Active branch not found'; end if;
  if not public.has_branch_access(v_user, p_branch_id) then
    raise exception 'Permission denied for branch';
  end if;
  v_reopen_event_id := public.assert_business_day_open(p_branch_id, p_business_date);

  if exists (
    select 1 from public.recount_sessions
    where branch_id = p_branch_id and business_date = p_business_date and type = p_type
      and status in ('draft', 'submitted')
  ) then raise exception 'An open recount of this type already exists for the branch and date'; end if;

  if p_item_ids is null or jsonb_typeof(p_item_ids) <> 'array' then
    raise exception 'Item selection must be an array';
  end if;
  select jsonb_array_length(p_item_ids), count(distinct value)
    into v_requested, v_distinct from jsonb_array_elements_text(p_item_ids);
  if v_requested <> v_distinct then raise exception 'Cycle-count items must be unique'; end if;
  if p_type = 'cycle' and v_requested = 0 then
    raise exception 'Cycle counts require at least one item';
  elsif p_type <> 'cycle' and v_requested <> 0 then
    raise exception 'Full recounts select all eligible items automatically';
  end if;

  if p_type = 'cycle' then
    select count(*)::int into v_eligible
    from public.inventory_items ii
    join public.branches b on b.id = p_branch_id
    where ii.id::text in (select value from jsonb_array_elements_text(p_item_ids))
      and ii.active and ii.trackable and ii.deleted_at is null
      and (ii.item_type <> 'raw_ingredient' or b.holds_raw_ingredients);
    if v_eligible <> v_requested then
      raise exception 'Every cycle-count item must be active, trackable, and allowed at the branch';
    end if;
  end if;

  v_reference := public.next_recount_reference();
  insert into public.recount_sessions (
    reference, branch_id, business_date, type, status, snapshot_at,
    open_idempotency_key, opened_by, day_reopen_event_id
  ) values (
    v_reference, p_branch_id, p_business_date, p_type, 'draft', v_snapshot,
    p_idempotency_key, v_user, v_reopen_event_id
  ) returning * into v_session;

  v_day_start := p_business_date::timestamp at time zone 'Asia/Manila';
  for v_item in
    select ii.id, ii.base_unit_id
    from public.inventory_items ii
    join public.branches b on b.id = p_branch_id
    where ii.active and ii.trackable and ii.deleted_at is null
      and (ii.item_type <> 'raw_ingredient' or b.holds_raw_ingredients)
      and (p_type <> 'cycle' or ii.id::text in (
        select value from jsonb_array_elements_text(p_item_ids)
      ))
      and (
        p_type = 'cycle'
        or exists (
          select 1 from public.inventory_balances ib
          where ib.item_id = ii.id and ib.branch_id = p_branch_id
        )
        or exists (
          select 1 from public.inventory_lots il
          where il.item_id = ii.id and il.branch_id = p_branch_id
        )
        or exists (
          select 1
          from public.stock_transaction_lines branch_stl
          join public.stock_transactions branch_st on branch_st.id = branch_stl.txn_id
          where branch_stl.item_id = ii.id
            and case when branch_stl.qty >= 0 then branch_st.dest_branch_id
                     else branch_st.source_branch_id end = p_branch_id
        )
      )
    order by ii.name, ii.id
  loop
    select
      coalesce(sum(stl.qty) filter (where st.created_at < v_day_start), 0),
      coalesce(sum(stl.qty) filter (where st.created_at >= v_day_start
        and st.type in ('stock_in', 'batch_stock_in', 'purchase_receiving', 'transfer',
                        'manual_adjustment', 'recount_adjustment', 'pos_refund')
        and stl.qty > 0), 0),
      coalesce(sum(stl.qty) filter (where st.created_at >= v_day_start
        and st.type = 'production_output' and stl.qty > 0), 0),
      coalesce(sum(abs(stl.qty)) filter (where st.created_at >= v_day_start
        and st.type = 'transfer' and stl.qty < 0), 0),
      coalesce(sum(abs(stl.qty)) filter (where st.created_at >= v_day_start
        and st.type in ('production_consumption', 'supplier_return', 'pos_sale')
        and stl.qty < 0), 0),
      coalesce(sum(abs(stl.qty)) filter (where st.created_at >= v_day_start
        and st.type in ('stock_out', 'batch_stock_out', 'manual_adjustment',
                        'recount_adjustment') and stl.qty < 0), 0),
      coalesce(sum(abs(stl.qty)) filter (where st.created_at >= v_day_start
        and st.type = 'waste' and stl.qty < 0), 0),
      coalesce(sum(stl.qty), 0)
    into v_opening, v_received, v_output, v_transfers_out, v_usage, v_stock_out, v_waste,
      v_ledger
    from public.stock_transaction_lines stl
    join public.stock_transactions st on st.id = stl.txn_id
    where stl.item_id = v_item.id and st.status = 'posted' and st.created_at <= v_snapshot
      and case when stl.qty >= 0 then st.dest_branch_id else st.source_branch_id end = p_branch_id;

    v_expected := round(v_opening + v_received + v_output - v_transfers_out
      - v_usage - v_stock_out - v_waste, 4);
    if v_expected <> round(v_ledger, 4) then
      raise exception 'Ledger classification does not reconcile for item %', v_item.id;
    end if;

    v_cost := 0;
    select stl.unit_cost_snapshot into v_cost
    from public.stock_transaction_lines stl
    join public.stock_transactions st on st.id = stl.txn_id
    where stl.item_id = v_item.id and st.status = 'posted' and st.created_at <= v_snapshot
      and case when stl.qty >= 0 then st.dest_branch_id else st.source_branch_id end = p_branch_id
    order by st.created_at desc, stl.created_at desc, stl.id desc
    limit 1;
    v_has_cost := found;

    insert into public.recount_lines (
      session_id, item_id, unit_id, opening_qty, received_qty, production_output_qty,
      transfers_out_qty, usage_qty, stock_out_qty, waste_qty, expected_qty,
      unit_cost_snapshot, unusual_signals
    ) values (
      v_session.id, v_item.id, v_item.base_unit_id, round(v_opening, 4), round(v_received, 4),
      round(v_output, 4), round(v_transfers_out, 4), round(v_usage, 4), round(v_stock_out, 4),
      round(v_waste, 4), v_expected, coalesce(v_cost, 0),
      case when v_has_cost then '{}'::text[] else array['missing_cost_snapshot']::text[] end
    );
  end loop;

  if not exists (select 1 from public.recount_lines where session_id = v_session.id) then
    raise exception 'No eligible items are available for this recount';
  end if;
  return jsonb_build_object('id', v_session.id, 'reference', v_reference,
    'status', 'draft', 'already_exists', false);
end;
$$;
revoke all on function public.open_recount(uuid, date, public.recount_session_type, text, jsonb)
  from public;
grant execute on function public.open_recount(uuid, date, public.recount_session_type, text, jsonb)
  to authenticated, service_role;

create or replace function public.submit_recount(
  p_session_id uuid,
  p_idempotency_key text,
  p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_session public.recount_sessions%rowtype;
  v_line jsonb;
  v_recount_line public.recount_lines%rowtype;
  v_physical numeric;
  v_variance numeric(14,4);
  v_value numeric(14,4);
  v_balance numeric(14,4);
  v_count integer;
  v_distinct integer;
  v_expected integer;
  v_has_variance boolean := false;
  v_line_signals text[];
  v_session_signals text[] := '{}'::text[];
  v_signal text;
  v_thresholds jsonb;
  v_percent numeric := 10;
  v_value_threshold numeric := 5000;
  v_repeat_count integer := 3;
  v_repeat_window integer := 7;
  v_prior_adjustments integer := 0;
  v_reopen_event_id uuid;
begin
  if v_user is null or not public.has_permission(v_user, 'recount.perform') then
    raise exception 'Permission denied: recount.perform required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Physical counts must be an array';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('recount-submit:' || p_idempotency_key, 0));
  select * into v_session from public.recount_sessions
  where submit_idempotency_key = p_idempotency_key;
  if found then
    if v_session.id <> p_session_id then
      raise exception 'Idempotency key belongs to another recount';
    end if;
    return jsonb_build_object('id', v_session.id, 'reference', v_session.reference,
      'status', v_session.status, 'is_unusual', v_session.is_unusual,
      'already_exists', true);
  end if;

  select * into v_session from public.recount_sessions where id = p_session_id for update;
  if not found then raise exception 'Recount not found'; end if;
  if v_session.status <> 'draft' then raise exception 'Recount must be draft'; end if;
  if not public.has_branch_access(v_user, v_session.branch_id) then
    raise exception 'Permission denied for branch';
  end if;
  v_reopen_event_id := public.assert_business_day_open(v_session.branch_id, v_session.business_date);

  select count(*)::int into v_expected from public.recount_lines where session_id = p_session_id;
  select count(*)::int, count(distinct value->>'line_id')::int
    into v_count, v_distinct from jsonb_array_elements(p_lines);
  if v_count <> v_expected or v_distinct <> v_expected then
    raise exception 'Every recount line must be submitted exactly once';
  end if;

  -- A movement during physical counting makes the snapshot stale. Movements after submission are
  -- safe because the compensating delta still applies to the then-current balance.
  if exists (
    select 1
    from public.stock_transactions st
    join public.stock_transaction_lines stl on stl.txn_id = st.id
    join public.recount_lines rl on rl.item_id = stl.item_id and rl.session_id = p_session_id
    where st.status = 'posted' and st.created_at > v_session.snapshot_at
      and case when stl.qty >= 0 then st.dest_branch_id else st.source_branch_id end = v_session.branch_id
  ) then raise exception 'Recount snapshot is stale because inventory moved during counting'; end if;

  select value into v_thresholds from public.application_settings where key = 'thresholds';
  begin
    v_percent := coalesce((v_thresholds->>'recount_variance_percent')::numeric, 10);
    v_value_threshold := coalesce((v_thresholds->>'recount_variance_value')::numeric, 5000);
    v_repeat_count := coalesce((v_thresholds->>'recount_repeat_count')::integer, 3);
    v_repeat_window := coalesce((v_thresholds->>'recount_repeat_window_days')::integer, 7);
  exception when others then
    raise exception 'Recount threshold settings are invalid';
  end;
  if v_percent < 0 or v_value_threshold < 0 or v_repeat_count < 1 or v_repeat_window < 1 then
    raise exception 'Recount threshold settings are invalid';
  end if;
  select count(*)::int into v_prior_adjustments
  from public.variance_adjustments
  where posted_by = v_user and posted_at >= now() - make_interval(days => v_repeat_window);

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select * into v_recount_line from public.recount_lines
    where id = (v_line->>'line_id')::uuid and session_id = p_session_id for update;
    if not found then raise exception 'Recount line does not belong to recount'; end if;
    begin
      v_physical := (v_line->>'physical_qty')::numeric;
    exception when others then
      raise exception 'Physical quantities must be valid numbers';
    end;
    if v_physical < 0 or v_physical > 9999999999 then
      raise exception 'Physical quantities must be between zero and 9999999999';
    end if;
    if v_physical <> round(v_physical, 4) then
      raise exception 'Physical quantities support at most four decimal places';
    end if;

    v_variance := round(v_physical - v_recount_line.expected_qty, 4);
    v_value := round(v_variance * v_recount_line.unit_cost_snapshot, 4);
    v_line_signals := v_recount_line.unusual_signals;
    if v_variance <> 0 then
      v_has_variance := true;
      if v_recount_line.expected_qty = 0 then
        if not ('zero_expected' = any(v_line_signals)) then
          v_line_signals := array_append(v_line_signals, 'zero_expected');
        end if;
      elsif abs(v_variance / v_recount_line.expected_qty * 100) >= v_percent then
        if not ('percent_threshold' = any(v_line_signals)) then
          v_line_signals := array_append(v_line_signals, 'percent_threshold');
        end if;
      end if;
      if abs(v_value) >= v_value_threshold and not ('value_threshold' = any(v_line_signals)) then
        v_line_signals := array_append(v_line_signals, 'value_threshold');
      end if;
      select coalesce(qty_on_hand, 0) into v_balance from public.inventory_balances
      where item_id = v_recount_line.item_id and branch_id = v_session.branch_id;
      v_balance := coalesce(v_balance, 0);
      if round(v_balance + v_variance, 4) < 0
         and not ('negative_result' = any(v_line_signals)) then
        v_line_signals := array_append(v_line_signals, 'negative_result');
      end if;
      if coalesce(v_session.day_reopen_event_id, v_reopen_event_id) is not null
         and not ('after_reopen' = any(v_line_signals)) then
        v_line_signals := array_append(v_line_signals, 'after_reopen');
      end if;
      if v_prior_adjustments + 1 >= v_repeat_count
         and not ('repeated_adjustments' = any(v_line_signals)) then
        v_line_signals := array_append(v_line_signals, 'repeated_adjustments');
      end if;
    else
      v_line_signals := '{}'::text[];
    end if;

    update public.recount_lines set
      physical_qty = round(v_physical, 4), variance_qty = v_variance,
      variance_value_snapshot = v_value, unusual_signals = v_line_signals
    where id = v_recount_line.id;

    foreach v_signal in array v_line_signals loop
      if not (v_signal = any(v_session_signals)) then
        v_session_signals := array_append(v_session_signals, v_signal);
      end if;
    end loop;
  end loop;

  update public.recount_sessions set
    status = case when v_has_variance then 'submitted'::public.recount_session_status
                  else 'closed'::public.recount_session_status end,
    submit_idempotency_key = p_idempotency_key,
    submitted_by = v_user, submitted_at = now(),
    is_unusual = cardinality(v_session_signals) > 0,
    unusual_signals = v_session_signals,
    day_reopen_event_id = coalesce(day_reopen_event_id, v_reopen_event_id)
  where id = p_session_id
  returning * into v_session;

  return jsonb_build_object('id', v_session.id, 'reference', v_session.reference,
    'status', v_session.status, 'is_unusual', v_session.is_unusual,
    'unusual_signals', to_jsonb(v_session.unusual_signals), 'already_exists', false);
end;
$$;
revoke all on function public.submit_recount(uuid, text, jsonb) from public;
grant execute on function public.submit_recount(uuid, text, jsonb) to authenticated, service_role;

create or replace function public.post_recount_adjustment(
  p_session_id uuid,
  p_reason_type public.recount_adjustment_reason,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_session public.recount_sessions%rowtype;
  v_adjustment public.variance_adjustments%rowtype;
  v_line public.recount_lines%rowtype;
  v_lot record;
  v_txn_id uuid;
  v_reference text;
  v_reopen_event_id uuid;
  v_remaining numeric(14,4);
  v_take numeric(14,4);
  v_lot_id uuid;
  v_new_balance numeric(14,4);
  v_total_value numeric(14,4) := 0;
  v_is_unusual boolean;
  v_negative_result boolean := false;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Adjustment reason is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('recount-adjust:' || p_idempotency_key, 0));
  select * into v_adjustment from public.variance_adjustments
  where idempotency_key = p_idempotency_key;
  if found then
    if v_adjustment.session_id <> p_session_id then
      raise exception 'Idempotency key belongs to another recount adjustment';
    end if;
    return jsonb_build_object('id', v_adjustment.id, 'reference', v_adjustment.reference,
      'stock_txn_id', v_adjustment.stock_txn_id, 'is_unusual', v_adjustment.is_unusual,
      'already_exists', true);
  end if;

  select * into v_session from public.recount_sessions where id = p_session_id for update;
  if not found then raise exception 'Recount not found'; end if;
  if v_session.status <> 'submitted' then raise exception 'Recount must be submitted'; end if;
  if not public.has_branch_access(v_user, v_session.branch_id) then
    raise exception 'Permission denied for branch';
  end if;
  v_reopen_event_id := public.assert_business_day_open(v_session.branch_id, v_session.business_date);

  -- Lock all existing projections in a deterministic order before the unusual-result preflight.
  perform 1
  from public.inventory_balances ib
  join public.recount_lines rl on rl.item_id = ib.item_id and rl.session_id = p_session_id
  where ib.branch_id = v_session.branch_id and rl.variance_qty <> 0
  order by ib.item_id for update of ib;

  select exists (
    select 1
    from public.recount_lines rl
    left join public.inventory_balances ib
      on ib.item_id = rl.item_id and ib.branch_id = v_session.branch_id
    where rl.session_id = p_session_id and rl.variance_qty <> 0
      and round(coalesce(ib.qty_on_hand, 0) + rl.variance_qty, 4) < 0
  ) into v_negative_result;
  v_is_unusual := v_session.is_unusual or v_negative_result;

  if v_is_unusual then
    if not public.has_permission(v_user, 'recount.confirm_unusual') then
      raise exception 'Permission denied: recount.confirm_unusual required';
    end if;
  elsif not (
    public.has_permission(v_user, 'recount.perform')
    or public.has_permission(v_user, 'recount.confirm')
  ) then
    raise exception 'Permission denied: recount.perform or recount.confirm required';
  end if;

  if not exists (
    select 1 from public.recount_lines
    where session_id = p_session_id and physical_qty is not null and variance_qty <> 0
  ) then raise exception 'Submitted recount has no variance to adjust'; end if;

  insert into public.stock_transactions (
    reference, type, status, source_branch_id, dest_branch_id, reason, notes,
    created_by, approved_by, confirmed_at, idempotency_key, correlation_id
  ) values (
    public.next_stock_txn_reference(), 'recount_adjustment', 'posted',
    v_session.branch_id, v_session.branch_id,
    initcap(replace(p_reason_type::text, '_', ' ')), btrim(p_reason),
    v_session.submitted_by, v_user, now(), p_idempotency_key, gen_random_uuid()
  ) returning id, day_reopen_event_id into v_txn_id, v_reopen_event_id;

  for v_line in
    select * from public.recount_lines
    where session_id = p_session_id and variance_qty <> 0
    order by item_id
  loop
    v_total_value := round(v_total_value + abs(v_line.variance_value_snapshot), 4);
    if v_line.variance_qty > 0 then
      insert into public.inventory_lots (
        item_id, branch_id, lot_number, received_date, expiration_date,
        qty_remaining, unit_cost, status
      ) values (
        v_line.item_id, v_session.branch_id, 'RECOUNT-' || v_session.reference,
        v_session.business_date, null, v_line.variance_qty, v_line.unit_cost_snapshot, 'available'
      ) returning id into v_lot_id;
      insert into public.stock_transaction_lines (
        txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot
      ) values (
        v_txn_id, v_line.item_id, v_line.variance_qty, v_line.unit_id,
        v_lot_id, v_line.unit_cost_snapshot
      );
    else
      v_remaining := abs(v_line.variance_qty);
      for v_lot in
        select id, qty_remaining
        from public.inventory_lots
        where item_id = v_line.item_id and branch_id = v_session.branch_id and qty_remaining > 0
        order by case status when 'available' then 0 when 'expired' then 1 else 2 end,
          expiration_date asc nulls last, received_date asc, created_at asc, id asc
        for update
      loop
        exit when v_remaining <= 0;
        v_take := least(v_remaining, v_lot.qty_remaining);
        update public.inventory_lots set qty_remaining = qty_remaining - v_take where id = v_lot.id;
        insert into public.stock_transaction_lines (
          txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot
        ) values (
          v_txn_id, v_line.item_id, -v_take, v_line.unit_id,
          v_lot.id, v_line.unit_cost_snapshot
        );
        v_remaining := round(v_remaining - v_take, 4);
      end loop;
      if v_remaining > 0 then
        insert into public.stock_transaction_lines (
          txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot
        ) values (
          v_txn_id, v_line.item_id, -v_remaining, v_line.unit_id, null,
          v_line.unit_cost_snapshot
        );
      end if;
    end if;

    insert into public.inventory_balances (item_id, branch_id, qty_on_hand, updated_at)
    values (v_line.item_id, v_session.branch_id, v_line.variance_qty, now())
    on conflict (item_id, branch_id) do update
      set qty_on_hand = public.inventory_balances.qty_on_hand + excluded.qty_on_hand,
          updated_at = now()
    returning qty_on_hand into v_new_balance;

    if v_new_balance < 0 then
      insert into public.inventory_alerts (
        item_id, branch_id, severity, status, qty_on_hand, cause_txn_id, reason, created_by
      ) values (
        v_line.item_id, v_session.branch_id, 'critical', 'active', v_new_balance,
        v_txn_id, btrim(p_reason), v_user
      );
    end if;
  end loop;

  v_reference := public.next_recount_adjustment_reference();
  insert into public.variance_adjustments (
    reference, session_id, reason_type, reason, idempotency_key, stock_txn_id,
    total_variance_value, is_unusual, posted_by, day_reopen_event_id
  ) values (
    v_reference, p_session_id, p_reason_type, btrim(p_reason), p_idempotency_key, v_txn_id,
    v_total_value, v_is_unusual, v_user, coalesce(v_reopen_event_id, v_session.day_reopen_event_id)
  ) returning * into v_adjustment;

  update public.recount_sessions set
    status = 'adjusted', adjusted_by = v_user, adjusted_at = now(),
    is_unusual = v_is_unusual,
    unusual_signals = case
      when v_negative_result and not ('negative_result' = any(unusual_signals))
        then array_append(unusual_signals, 'negative_result')
      else unusual_signals end,
    day_reopen_event_id = coalesce(day_reopen_event_id, v_reopen_event_id)
  where id = p_session_id;

  return jsonb_build_object('id', v_adjustment.id, 'reference', v_reference,
    'stock_txn_id', v_txn_id, 'is_unusual', v_is_unusual, 'already_exists', false);
end;
$$;
revoke all on function public.post_recount_adjustment(
  uuid, public.recount_adjustment_reason, text, text
) from public;
grant execute on function public.post_recount_adjustment(
  uuid, public.recount_adjustment_reason, text, text
) to authenticated, service_role;

create or replace function public.close_day(
  p_branch_id uuid,
  p_business_date date,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_closure public.daily_operational_closures%rowtype;
  v_event_id uuid;
  v_event_reference text;
  v_existing_event_type public.day_close_event_type;
  v_existing_branch uuid;
  v_existing_date date;
  v_audit_id uuid;
  v_reference text;
  v_before jsonb;
begin
  if v_user is null or not public.has_permission(v_user, 'recount.confirm') then
    raise exception 'Permission denied: recount.confirm required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  if p_business_date is null or p_business_date > (now() at time zone 'Asia/Manila')::date then
    raise exception 'Business date must not be in the future';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('day-close:' || p_idempotency_key, 0));
  select e.id, e.reference, e.event_type, dc.branch_id, dc.business_date
    into v_event_id, v_event_reference, v_existing_event_type, v_existing_branch, v_existing_date
  from public.day_close_events e
  join public.daily_operational_closures dc on dc.id = e.closure_id
  where e.idempotency_key = p_idempotency_key;
  if found then
    if v_existing_event_type <> 'close' or v_existing_branch <> p_branch_id
       or v_existing_date <> p_business_date then
      raise exception 'Idempotency key belongs to another day-close command';
    end if;
    return jsonb_build_object('event_id', v_event_id, 'reference', v_event_reference,
      'status', 'closed', 'already_exists', true);
  end if;

  perform 1 from public.branches
  where id = p_branch_id and active and deleted_at is null;
  if not found then raise exception 'Active branch not found'; end if;
  if not public.has_branch_access(v_user, p_branch_id) then
    raise exception 'Permission denied for branch';
  end if;
  if not exists (
    select 1 from public.recount_sessions
    where branch_id = p_branch_id and business_date = p_business_date
      and type = 'start_of_day' and status in ('adjusted', 'closed')
  ) then raise exception 'A completed start-of-day recount is required before closing'; end if;
  if exists (
    select 1 from public.recount_sessions
    where branch_id = p_branch_id and business_date = p_business_date
      and status in ('draft', 'submitted')
  ) then raise exception 'Unresolved recounts or variances block day close'; end if;

  select * into v_closure from public.daily_operational_closures
  where branch_id = p_branch_id and business_date = p_business_date for update;
  if found and v_closure.status = 'closed' then
    raise exception 'Business day is already closed with another idempotency key';
  end if;

  if not found then
    v_reference := public.next_day_close_reference();
    insert into public.daily_operational_closures (
      reference, branch_id, business_date, status, close_count, reopen_count,
      last_closed_by, last_closed_at
    ) values (
      v_reference, p_branch_id, p_business_date, 'closed', 1, 0, v_user, now()
    ) returning * into v_closure;
    v_before := null;
  else
    v_before := jsonb_build_object('status', v_closure.status,
      'close_count', v_closure.close_count, 'reopen_count', v_closure.reopen_count);
    update public.daily_operational_closures set
      status = 'closed', close_count = close_count + 1,
      last_closed_by = v_user, last_closed_at = now()
    where id = v_closure.id returning * into v_closure;
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before, after, branch_id, correlation_id
  ) values (
    v_user, 'day.closed', 'daily_operational_closure', v_closure.id::text, v_before,
    jsonb_build_object('status', 'closed', 'business_date', p_business_date,
      'close_count', v_closure.close_count, 'reopen_count', v_closure.reopen_count),
    p_branch_id, gen_random_uuid()
  ) returning id into v_audit_id;

  v_event_reference := public.next_day_close_event_reference();
  insert into public.day_close_events (
    reference, closure_id, event_type, idempotency_key, reason, actor_id, audit_log_id
  ) values (
    v_event_reference, v_closure.id, 'close', p_idempotency_key, null, v_user, v_audit_id
  ) returning id into v_event_id;
  update public.daily_operational_closures set latest_event_id = v_event_id
  where id = v_closure.id;

  return jsonb_build_object('event_id', v_event_id, 'reference', v_event_reference,
    'closure_reference', v_closure.reference, 'status', 'closed', 'already_exists', false);
end;
$$;
revoke all on function public.close_day(uuid, date, text) from public;
grant execute on function public.close_day(uuid, date, text) to authenticated, service_role;

create or replace function public.reopen_day(
  p_branch_id uuid,
  p_business_date date,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_closure public.daily_operational_closures%rowtype;
  v_event_id uuid;
  v_event_reference text;
  v_existing_event_type public.day_close_event_type;
  v_existing_branch uuid;
  v_existing_date date;
  v_audit_id uuid;
begin
  if v_user is null or not public.has_permission(v_user, 'closure.reopen') then
    raise exception 'Permission denied: closure.reopen required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'A reopen reason is required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  if p_business_date is null or p_business_date > (now() at time zone 'Asia/Manila')::date then
    raise exception 'Business date must not be in the future';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('day-reopen:' || p_idempotency_key, 0));
  select e.id, e.reference, e.event_type, dc.branch_id, dc.business_date
    into v_event_id, v_event_reference, v_existing_event_type, v_existing_branch, v_existing_date
  from public.day_close_events e
  join public.daily_operational_closures dc on dc.id = e.closure_id
  where e.idempotency_key = p_idempotency_key;
  if found then
    if v_existing_event_type <> 'reopen' or v_existing_branch <> p_branch_id
       or v_existing_date <> p_business_date then
      raise exception 'Idempotency key belongs to another day-reopen command';
    end if;
    return jsonb_build_object('event_id', v_event_id, 'reference', v_event_reference,
      'status', 'reopened', 'already_exists', true);
  end if;

  select * into v_closure from public.daily_operational_closures
  where branch_id = p_branch_id and business_date = p_business_date for update;
  if not found then raise exception 'Closed business day not found'; end if;
  if v_closure.status <> 'closed' then raise exception 'Business day must be closed'; end if;
  if not public.has_branch_access(v_user, p_branch_id) then
    raise exception 'Permission denied for branch';
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before, after, reason, branch_id, correlation_id
  ) values (
    v_user, 'day.reopened', 'daily_operational_closure', v_closure.id::text,
    jsonb_build_object('status', v_closure.status, 'business_date', p_business_date),
    jsonb_build_object('status', 'reopened', 'business_date', p_business_date,
      'reopen_count', v_closure.reopen_count + 1),
    btrim(p_reason), p_branch_id, gen_random_uuid()
  ) returning id into v_audit_id;

  v_event_reference := public.next_day_close_event_reference();
  insert into public.day_close_events (
    reference, closure_id, event_type, idempotency_key, reason, actor_id, audit_log_id
  ) values (
    v_event_reference, v_closure.id, 'reopen', p_idempotency_key,
    btrim(p_reason), v_user, v_audit_id
  ) returning id into v_event_id;

  update public.daily_operational_closures set
    status = 'reopened', reopen_count = reopen_count + 1,
    last_reopened_by = v_user, last_reopened_at = now(), latest_event_id = v_event_id
  where id = v_closure.id;

  return jsonb_build_object('event_id', v_event_id, 'reference', v_event_reference,
    'closure_reference', v_closure.reference, 'status', 'reopened',
    'already_exists', false);
end;
$$;
revoke all on function public.reopen_day(uuid, date, text, text) from public;
grant execute on function public.reopen_day(uuid, date, text, text)
  to authenticated, service_role;
