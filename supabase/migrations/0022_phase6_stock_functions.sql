-- 0022_phase6_stock_functions.sql
-- Phase 6 atomic/idempotent stock operations, requests, transfers, and discrepancies.

alter table public.stock_requests add column idempotency_key text unique;
alter table public.transfer_lines add column version integer not null default 1;

create or replace function public.next_stock_request_reference() returns text
language sql security definer set search_path = public as $$
  select 'REQ-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.stock_request_ref_seq')::text, 5, '0')
$$;
create or replace function public.next_transfer_reference() returns text
language sql security definer set search_path = public as $$
  select 'TRF-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.transfer_ref_seq')::text, 5, '0')
$$;
revoke all on function public.next_stock_request_reference() from public;
revoke all on function public.next_transfer_reference() from public;
grant execute on function public.next_stock_request_reference(), public.next_transfer_reference()
  to authenticated, service_role;

create or replace function public.post_stock_in(
  p_branch_id uuid,
  p_reason text,
  p_notes text,
  p_idempotency_key text,
  p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_txn_id uuid;
  v_existing_type public.stock_txn_type;
  v_txn_type public.stock_txn_type := 'stock_in';
  v_line jsonb;
  v_item public.inventory_items%rowtype;
  v_qty numeric(14,4);
  v_lot_number text;
  v_expiration date;
  v_lot_id uuid;
  v_branch_holds_raw boolean;
  v_count integer;
  v_distinct integer;
  v_business_date date := (now() at time zone 'Asia/Manila')::date;
begin
  if v_user is null or not public.has_permission(v_user, 'stock.in') then
    raise exception 'Permission denied: stock.in required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Stock-in reason is required';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one stock-in line is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('stock-in:' || p_idempotency_key, 0));
  select id, type into v_txn_id, v_existing_type from public.stock_transactions
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing_type not in ('stock_in', 'batch_stock_in') then
      raise exception 'Idempotency key belongs to another stock operation';
    end if;
    return v_txn_id;
  end if;

  select holds_raw_ingredients into v_branch_holds_raw from public.branches
  where id = p_branch_id and active and deleted_at is null;
  if not found then raise exception 'Active branch not found'; end if;
  if not public.has_branch_access(v_user, p_branch_id) then
    raise exception 'Permission denied for branch';
  end if;

  select count(*)::int, count(distinct value->>'item_id')::int
    into v_count, v_distinct from jsonb_array_elements(p_lines);
  if v_count <> v_distinct then raise exception 'Stock-in items must be unique'; end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_qty := round((v_line->>'qty')::numeric, 4);
    exception when invalid_text_representation then
      raise exception 'Stock-in quantities must be numeric';
    end;
    if v_qty <= 0 then raise exception 'Stock-in quantities must be positive'; end if;
    select * into v_item from public.inventory_items
    where id = (v_line->>'item_id')::uuid and active and trackable and deleted_at is null;
    if not found then raise exception 'Active trackable item not found'; end if;
    if v_item.item_type = 'raw_ingredient' and not v_branch_holds_raw then
      raise exception 'Raw ingredients may be stocked only at Main';
    end if;
    v_lot_number := nullif(btrim(v_line->>'lot_number'), '');
    v_expiration := nullif(v_line->>'expiration_date', '')::date;
    if v_item.batch_tracked and v_lot_number is null then
      raise exception 'Batch or lot number is required for %', v_item.name;
    end if;
    if v_item.expiry_tracked and v_expiration is null then
      raise exception 'Expiration date is required for %', v_item.name;
    end if;
    if v_expiration is not null and v_expiration < v_business_date then
      raise exception 'Cannot stock in an expired lot for %', v_item.name;
    end if;
    if v_item.batch_tracked or v_item.expiry_tracked then v_txn_type := 'batch_stock_in'; end if;
  end loop;

  insert into public.stock_transactions (
    reference, type, status, dest_branch_id, reason, notes, created_by, confirmed_at,
    idempotency_key, correlation_id
  ) values (
    public.next_stock_txn_reference(), v_txn_type, 'posted', p_branch_id, btrim(p_reason),
    nullif(btrim(p_notes), ''), v_user, now(), p_idempotency_key, gen_random_uuid()
  ) returning id into v_txn_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := round((v_line->>'qty')::numeric, 4);
    select * into v_item from public.inventory_items where id = (v_line->>'item_id')::uuid for update;
    v_lot_number := nullif(btrim(v_line->>'lot_number'), '');
    v_expiration := nullif(v_line->>'expiration_date', '')::date;

    insert into public.inventory_lots (
      item_id, branch_id, lot_number, received_date, expiration_date,
      qty_remaining, unit_cost, status
    ) values (
      v_item.id, p_branch_id, v_lot_number, v_business_date, v_expiration,
      v_qty, v_item.weighted_avg_cost, 'available'
    ) returning id into v_lot_id;

    insert into public.stock_transaction_lines (
      txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot
    ) values (
      v_txn_id, v_item.id, v_qty, v_item.base_unit_id, v_lot_id, v_item.weighted_avg_cost
    );

    insert into public.inventory_balances (item_id, branch_id, qty_on_hand, updated_at)
    values (v_item.id, p_branch_id, v_qty, now())
    on conflict (item_id, branch_id) do update
      set qty_on_hand = public.inventory_balances.qty_on_hand + excluded.qty_on_hand,
          updated_at = now();
  end loop;
  return v_txn_id;
end $$;
revoke all on function public.post_stock_in(uuid, text, text, text, jsonb) from public;
grant execute on function public.post_stock_in(uuid, text, text, text, jsonb)
  to authenticated, service_role;

create or replace function public.post_stock_out(
  p_branch_id uuid,
  p_reason text,
  p_notes text,
  p_idempotency_key text,
  p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_txn_id uuid;
  v_existing_type public.stock_txn_type;
  v_txn_type public.stock_txn_type := 'stock_out';
  v_line jsonb;
  v_item public.inventory_items%rowtype;
  v_lot record;
  v_qty numeric(14,4);
  v_remaining numeric(14,4);
  v_take numeric(14,4);
  v_new_balance numeric(14,4);
  v_branch_holds_raw boolean;
  v_count integer;
  v_distinct integer;
  v_business_date date := (now() at time zone 'Asia/Manila')::date;
begin
  if v_user is null or not public.has_permission(v_user, 'stock.out') then
    raise exception 'Permission denied: stock.out required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Stock-out cause is required';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one stock-out line is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('stock-out:' || p_idempotency_key, 0));
  select id, type into v_txn_id, v_existing_type from public.stock_transactions
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing_type not in ('stock_out', 'batch_stock_out') then
      raise exception 'Idempotency key belongs to another stock operation';
    end if;
    return v_txn_id;
  end if;

  select holds_raw_ingredients into v_branch_holds_raw from public.branches
  where id = p_branch_id and active and deleted_at is null;
  if not found then raise exception 'Active branch not found'; end if;
  if not public.has_branch_access(v_user, p_branch_id) then
    raise exception 'Permission denied for branch';
  end if;

  select count(*)::int, count(distinct value->>'item_id')::int
    into v_count, v_distinct from jsonb_array_elements(p_lines);
  if v_count <> v_distinct then raise exception 'Stock-out items must be unique'; end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    begin
      v_qty := round((v_line->>'qty')::numeric, 4);
    exception when invalid_text_representation then
      raise exception 'Stock-out quantities must be numeric';
    end;
    if v_qty <= 0 then raise exception 'Stock-out quantities must be positive'; end if;
    select * into v_item from public.inventory_items
    where id = (v_line->>'item_id')::uuid and active and trackable and deleted_at is null;
    if not found then raise exception 'Active trackable item not found'; end if;
    if v_item.item_type = 'raw_ingredient' and not v_branch_holds_raw then
      raise exception 'Raw ingredients may be held only at Main';
    end if;
    if v_item.batch_tracked or v_item.expiry_tracked then v_txn_type := 'batch_stock_out'; end if;
  end loop;

  insert into public.stock_transactions (
    reference, type, status, source_branch_id, reason, notes, created_by, confirmed_at,
    idempotency_key, correlation_id
  ) values (
    public.next_stock_txn_reference(), v_txn_type, 'posted', p_branch_id, btrim(p_reason),
    nullif(btrim(p_notes), ''), v_user, now(), p_idempotency_key, gen_random_uuid()
  ) returning id into v_txn_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := round((v_line->>'qty')::numeric, 4);
    select * into v_item from public.inventory_items where id = (v_line->>'item_id')::uuid for update;
    v_remaining := v_qty;

    for v_lot in
      select id, qty_remaining, unit_cost
      from public.inventory_lots
      where item_id = v_item.id and branch_id = p_branch_id
        and status = 'available' and qty_remaining > 0
        and (expiration_date is null or expiration_date >= v_business_date)
      order by expiration_date asc nulls last, received_date asc, created_at asc, id asc
      for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_lot.qty_remaining);
      update public.inventory_lots set qty_remaining = qty_remaining - v_take where id = v_lot.id;
      insert into public.stock_transaction_lines (
        txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot
      ) values (
        v_txn_id, v_item.id, -v_take, v_item.base_unit_id, v_lot.id, v_lot.unit_cost
      );
      v_remaining := round(v_remaining - v_take, 4);
    end loop;

    if v_remaining > 0 then
      insert into public.stock_transaction_lines (
        txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot
      ) values (
        v_txn_id, v_item.id, -v_remaining, v_item.base_unit_id, null, v_item.weighted_avg_cost
      );
    end if;

    insert into public.inventory_balances (item_id, branch_id, qty_on_hand, updated_at)
    values (v_item.id, p_branch_id, -v_qty, now())
    on conflict (item_id, branch_id) do update
      set qty_on_hand = public.inventory_balances.qty_on_hand + excluded.qty_on_hand,
          updated_at = now()
    returning qty_on_hand into v_new_balance;

    if v_new_balance < 0 then
      insert into public.inventory_alerts (
        item_id, branch_id, severity, status, qty_on_hand, cause_txn_id, reason, created_by
      ) values (
        v_item.id, p_branch_id, 'critical', 'active', v_new_balance,
        v_txn_id, btrim(p_reason), v_user
      );
    end if;
  end loop;
  return v_txn_id;
end $$;
revoke all on function public.post_stock_out(uuid, text, text, text, jsonb) from public;
grant execute on function public.post_stock_out(uuid, text, text, text, jsonb)
  to authenticated, service_role;

create or replace function public.create_stock_request(
  p_requesting_branch_id uuid,
  p_notes text,
  p_idempotency_key text,
  p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_request public.stock_requests%rowtype;
  v_reference text;
  v_line jsonb;
  v_item public.inventory_items%rowtype;
  v_qty numeric(14,4);
  v_holds_raw boolean;
  v_count integer;
  v_distinct integer;
begin
  if v_user is null or not public.has_permission(v_user, 'stock.transfer.prepare') then
    raise exception 'Permission denied: stock.transfer.prepare required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one request line is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stock-request:' || p_idempotency_key, 0));
  select * into v_request from public.stock_requests where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('id', v_request.id, 'reference', v_request.reference,
      'already_exists', true);
  end if;

  select holds_raw_ingredients into v_holds_raw from public.branches
  where id = p_requesting_branch_id and active and deleted_at is null;
  if not found then raise exception 'Active requesting branch not found'; end if;
  if not public.has_branch_access(v_user, p_requesting_branch_id) then
    raise exception 'Permission denied for branch';
  end if;
  select count(*)::int, count(distinct value->>'item_id')::int
    into v_count, v_distinct from jsonb_array_elements(p_lines);
  if v_count <> v_distinct then raise exception 'Requested items must be unique'; end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := round((v_line->>'qty')::numeric, 4);
    if v_qty <= 0 then raise exception 'Requested quantities must be positive'; end if;
    select * into v_item from public.inventory_items
    where id = (v_line->>'item_id')::uuid and active and trackable and deleted_at is null;
    if not found then raise exception 'Active trackable item not found'; end if;
    if v_item.item_type = 'raw_ingredient' and not v_holds_raw then
      raise exception 'Raw ingredients may be requested only for Main';
    end if;
  end loop;

  v_reference := public.next_stock_request_reference();
  insert into public.stock_requests (
    reference, requesting_branch_id, notes, requested_by, idempotency_key,
    created_by, updated_by
  ) values (
    v_reference, p_requesting_branch_id, nullif(btrim(p_notes), ''), v_user,
    p_idempotency_key, v_user, v_user
  ) returning * into v_request;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select * into v_item from public.inventory_items where id = (v_line->>'item_id')::uuid;
    insert into public.stock_request_lines (request_id, item_id, unit_id, requested_qty)
    values (v_request.id, v_item.id, v_item.base_unit_id, round((v_line->>'qty')::numeric, 4));
  end loop;
  return jsonb_build_object('id', v_request.id, 'reference', v_reference, 'already_exists', false);
end $$;
revoke all on function public.create_stock_request(uuid, text, text, jsonb) from public;
grant execute on function public.create_stock_request(uuid, text, text, jsonb)
  to authenticated, service_role;

create or replace function public.review_stock_request(
  p_request_id uuid,
  p_decision text,
  p_review_notes text,
  p_lines jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_request public.stock_requests%rowtype;
  v_line jsonb;
  v_request_line public.stock_request_lines%rowtype;
  v_qty numeric(14,4);
  v_expected integer;
  v_distinct integer;
begin
  if v_user is null or not public.has_permission(v_user, 'stock.transfer.approve') then
    raise exception 'Permission denied: stock.transfer.approve required';
  end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Invalid review decision'; end if;
  select * into v_request from public.stock_requests where id = p_request_id for update;
  if not found then raise exception 'Stock request not found'; end if;
  if v_request.status <> 'requested' then raise exception 'Stock request must be requested'; end if;
  if not public.has_branch_access(v_user, v_request.requesting_branch_id) then
    raise exception 'Permission denied for branch';
  end if;

  if p_decision = 'approve' then
    if jsonb_typeof(p_lines) <> 'array' then raise exception 'Approved lines are required'; end if;
    select count(*)::int into v_expected from public.stock_request_lines where request_id = p_request_id;
    select count(distinct value->>'line_id')::int into v_distinct from jsonb_array_elements(p_lines);
    if jsonb_array_length(p_lines) <> v_expected or v_distinct <> v_expected then
      raise exception 'Every request line must be reviewed exactly once';
    end if;
    for v_line in select value from jsonb_array_elements(p_lines)
    loop
      v_qty := round((v_line->>'approved_qty')::numeric, 4);
      select * into v_request_line from public.stock_request_lines
      where id = (v_line->>'line_id')::uuid and request_id = p_request_id for update;
      if not found then raise exception 'Request line does not belong to request'; end if;
      if v_qty < 0 or v_qty > v_request_line.requested_qty then
        raise exception 'Approved quantity is outside the requested range';
      end if;
      update public.stock_request_lines set approved_qty = v_qty where id = v_request_line.id;
    end loop;
    if not exists (
      select 1 from public.stock_request_lines where request_id = p_request_id and approved_qty > 0
    ) then raise exception 'At least one approved quantity is required'; end if;
    update public.stock_requests set
      status = 'approved', reviewed_by = v_user, reviewed_at = now(),
      review_notes = nullif(btrim(p_review_notes), ''), updated_by = v_user
    where id = p_request_id;
  else
    update public.stock_request_lines set approved_qty = 0 where request_id = p_request_id;
    update public.stock_requests set
      status = 'rejected', reviewed_by = v_user, reviewed_at = now(),
      review_notes = nullif(btrim(p_review_notes), ''), updated_by = v_user
    where id = p_request_id;
  end if;
end $$;
revoke all on function public.review_stock_request(uuid, text, text, jsonb) from public;
grant execute on function public.review_stock_request(uuid, text, text, jsonb)
  to authenticated, service_role;

create or replace function public.prepare_transfer(
  p_source_branch_id uuid,
  p_dest_branch_id uuid,
  p_stock_request_id uuid,
  p_notes text,
  p_idempotency_key text,
  p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_transfer public.transfers%rowtype;
  v_request public.stock_requests%rowtype;
  v_line jsonb;
  v_item public.inventory_items%rowtype;
  v_qty numeric(14,4);
  v_dest_holds_raw boolean;
  v_reference text;
  v_count integer;
  v_distinct integer;
  v_expected integer;
begin
  if v_user is null or not public.has_permission(v_user, 'stock.transfer.prepare') then
    raise exception 'Permission denied: stock.transfer.prepare required';
  end if;
  if p_source_branch_id = p_dest_branch_id then raise exception 'Transfer branches must differ'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one transfer line is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('transfer-prepare:' || p_idempotency_key, 0));
  select * into v_transfer from public.transfers where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('id', v_transfer.id, 'reference', v_transfer.reference,
      'already_exists', true);
  end if;

  perform 1 from public.branches where id = p_source_branch_id and active and deleted_at is null;
  if not found then raise exception 'Active source branch not found'; end if;
  select holds_raw_ingredients into v_dest_holds_raw from public.branches
  where id = p_dest_branch_id and active and deleted_at is null;
  if not found then raise exception 'Active destination branch not found'; end if;
  if not public.has_branch_access(v_user, p_source_branch_id)
     and not public.has_branch_access(v_user, p_dest_branch_id) then
    raise exception 'Permission denied for transfer branches';
  end if;

  if p_stock_request_id is not null then
    select * into v_request from public.stock_requests
    where id = p_stock_request_id for update;
    if not found or v_request.status <> 'approved' then
      raise exception 'Linked stock request must be approved';
    end if;
    if v_request.requesting_branch_id <> p_dest_branch_id then
      raise exception 'Transfer destination must match the stock request';
    end if;
    if not exists (
      select 1 from public.branches where id = p_source_branch_id and is_main and active
    ) then raise exception 'Stock requests must be fulfilled from Main'; end if;
  end if;

  select count(*)::int, count(distinct value->>'item_id')::int
    into v_count, v_distinct from jsonb_array_elements(p_lines);
  if v_count <> v_distinct then raise exception 'Transfer items must be unique'; end if;

  if p_stock_request_id is not null then
    select count(*)::int into v_expected from public.stock_request_lines
    where request_id = p_stock_request_id and approved_qty > 0;
    if v_expected <> v_count then raise exception 'Transfer must include every approved request line'; end if;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_qty := round((v_line->>'qty')::numeric, 4);
    if v_qty <= 0 then raise exception 'Transfer quantities must be positive'; end if;
    select * into v_item from public.inventory_items
    where id = (v_line->>'item_id')::uuid and active and trackable and deleted_at is null;
    if not found then raise exception 'Active trackable item not found'; end if;
    if v_item.item_type = 'raw_ingredient' and not v_dest_holds_raw then
      raise exception 'Raw ingredients may be transferred only to Main';
    end if;
    if p_stock_request_id is not null and not exists (
      select 1 from public.stock_request_lines srl
      where srl.request_id = p_stock_request_id and srl.item_id = v_item.id
        and srl.approved_qty = v_qty and srl.approved_qty > 0
    ) then raise exception 'Transfer quantities must match approved request quantities'; end if;
  end loop;

  v_reference := public.next_transfer_reference();
  insert into public.transfers (
    reference, stock_request_id, source_branch_id, dest_branch_id, notes,
    idempotency_key, prepared_by
  ) values (
    v_reference, p_stock_request_id, p_source_branch_id, p_dest_branch_id,
    nullif(btrim(p_notes), ''), p_idempotency_key, v_user
  ) returning * into v_transfer;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select * into v_item from public.inventory_items where id = (v_line->>'item_id')::uuid;
    insert into public.transfer_lines (transfer_id, item_id, unit_id, prepared_qty)
    values (v_transfer.id, v_item.id, v_item.base_unit_id, round((v_line->>'qty')::numeric, 4));
  end loop;
  return jsonb_build_object('id', v_transfer.id, 'reference', v_reference, 'already_exists', false);
end $$;
revoke all on function public.prepare_transfer(uuid, uuid, uuid, text, text, jsonb) from public;
grant execute on function public.prepare_transfer(uuid, uuid, uuid, text, text, jsonb)
  to authenticated, service_role;

create or replace function public.approve_transfer(p_transfer_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_transfer public.transfers%rowtype;
  v_line record;
  v_lot record;
  v_remaining numeric(14,4);
  v_take numeric(14,4);
  v_txn_id uuid;
  v_balance_rows integer;
  v_business_date date := (now() at time zone 'Asia/Manila')::date;
begin
  if v_user is null or not public.has_permission(v_user, 'stock.transfer.approve') then
    raise exception 'Permission denied: stock.transfer.approve required';
  end if;
  select * into v_transfer from public.transfers where id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if v_transfer.status in ('in_transit', 'received') and v_transfer.source_txn_id is not null then
    return v_transfer.source_txn_id;
  end if;
  if v_transfer.status <> 'prepared' then raise exception 'Transfer must be prepared'; end if;
  if not public.has_branch_access(v_user, v_transfer.source_branch_id)
     and not public.has_branch_access(v_user, v_transfer.dest_branch_id) then
    raise exception 'Permission denied for transfer branches';
  end if;

  insert into public.stock_transactions (
    reference, type, status, source_branch_id, dest_branch_id, reason, transfer_id,
    created_by, approved_by, confirmed_at, idempotency_key, correlation_id
  ) values (
    public.next_stock_txn_reference(), 'transfer', 'posted', v_transfer.source_branch_id,
    v_transfer.dest_branch_id, 'Transfer dispatch ' || v_transfer.reference, v_transfer.id,
    v_transfer.prepared_by, v_user, now(), v_transfer.idempotency_key || ':source',
    v_transfer.correlation_id
  ) returning id into v_txn_id;

  for v_line in
    select tl.*, ii.name as item_name
    from public.transfer_lines tl join public.inventory_items ii on ii.id = tl.item_id
    where tl.transfer_id = v_transfer.id order by tl.created_at, tl.id
  loop
    v_remaining := v_line.prepared_qty;
    for v_lot in
      select id, lot_number, received_date, expiration_date, qty_remaining, unit_cost
      from public.inventory_lots
      where item_id = v_line.item_id and branch_id = v_transfer.source_branch_id
        and status = 'available' and qty_remaining > 0
        and (expiration_date is null or expiration_date >= v_business_date)
      order by expiration_date asc nulls last, received_date asc, created_at asc, id asc
      for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_lot.qty_remaining);
      update public.inventory_lots set qty_remaining = qty_remaining - v_take where id = v_lot.id;
      insert into public.transfer_lot_allocations (
        transfer_line_id, source_lot_id, allocated_qty, unit_cost_snapshot,
        lot_number, received_date, expiration_date
      ) values (
        v_line.id, v_lot.id, v_take, v_lot.unit_cost,
        v_lot.lot_number, v_lot.received_date, v_lot.expiration_date
      );
      insert into public.stock_transaction_lines (
        txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot
      ) values (
        v_txn_id, v_line.item_id, -v_take, v_line.unit_id, v_lot.id, v_lot.unit_cost
      );
      v_remaining := round(v_remaining - v_take, 4);
    end loop;
    if v_remaining > 0 then
      raise exception 'Insufficient unexpired available stock for %', v_line.item_name;
    end if;

    update public.inventory_balances set
      qty_on_hand = qty_on_hand - v_line.prepared_qty, updated_at = now()
    where item_id = v_line.item_id and branch_id = v_transfer.source_branch_id;
    get diagnostics v_balance_rows = row_count;
    if v_balance_rows <> 1 then raise exception 'Inventory balance missing for %', v_line.item_name; end if;
    update public.transfer_lines set shipped_qty = prepared_qty where id = v_line.id;
  end loop;

  update public.transfers set
    status = 'in_transit', approved_by = v_user, approved_at = now(), source_txn_id = v_txn_id
  where id = v_transfer.id;
  return v_txn_id;
end $$;
revoke all on function public.approve_transfer(uuid) from public;
grant execute on function public.approve_transfer(uuid) to authenticated, service_role;

create or replace function public.receive_transfer(
  p_transfer_id uuid,
  p_idempotency_key text,
  p_discrepancy_reason text,
  p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_transfer public.transfers%rowtype;
  v_existing_transfer_id uuid;
  v_txn_id uuid;
  v_line jsonb;
  v_transfer_line public.transfer_lines%rowtype;
  v_allocation record;
  v_received numeric(14,4);
  v_rejected numeric(14,4);
  v_damaged numeric(14,4);
  v_missing numeric(14,4);
  v_accounted numeric(14,4);
  v_remaining numeric(14,4);
  v_take numeric(14,4);
  v_destination_lot_id uuid;
  v_count integer;
  v_distinct integer;
  v_expected integer;
  v_has_discrepancy boolean := false;
  v_business_date date := (now() at time zone 'Asia/Manila')::date;
  v_lot_status public.lot_status;
begin
  if v_user is null or not public.has_permission(v_user, 'stock.transfer.receive') then
    raise exception 'Permission denied: stock.transfer.receive required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Receiving counts are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('transfer-receive:' || p_idempotency_key, 0));
  select id, transfer_id into v_txn_id, v_existing_transfer_id from public.stock_transactions
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing_transfer_id is distinct from p_transfer_id then
      raise exception 'Idempotency key belongs to another transfer';
    end if;
    return v_txn_id;
  end if;

  select * into v_transfer from public.transfers where id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if v_transfer.status = 'received' then
    if v_transfer.receive_idempotency_key = p_idempotency_key then return v_transfer.receive_txn_id; end if;
    raise exception 'Transfer was already received with another idempotency key';
  end if;
  if v_transfer.status <> 'in_transit' then raise exception 'Transfer must be in transit'; end if;
  if not public.has_branch_access(v_user, v_transfer.dest_branch_id) then
    raise exception 'Permission denied for destination branch';
  end if;

  select count(*)::int into v_expected from public.transfer_lines where transfer_id = p_transfer_id;
  select count(*)::int, count(distinct value->>'line_id')::int
    into v_count, v_distinct from jsonb_array_elements(p_lines);
  if v_count <> v_expected or v_distinct <> v_expected then
    raise exception 'Every transfer line must be received exactly once';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select * into v_transfer_line from public.transfer_lines
    where id = (v_line->>'line_id')::uuid and transfer_id = p_transfer_id;
    if not found then raise exception 'Transfer line does not belong to transfer'; end if;
    begin
      v_received := round((v_line->>'received_qty')::numeric, 4);
      v_rejected := round((v_line->>'rejected_qty')::numeric, 4);
      v_damaged := round((v_line->>'damaged_qty')::numeric, 4);
      v_missing := round((v_line->>'missing_qty')::numeric, 4);
    exception when invalid_text_representation then
      raise exception 'Receiving quantities must be numeric';
    end;
    if least(v_received, v_rejected, v_damaged, v_missing) < 0 then
      raise exception 'Receiving quantities cannot be negative';
    end if;
    v_accounted := round(v_received + v_rejected + v_damaged + v_missing, 4);
    if v_accounted <> v_transfer_line.shipped_qty then
      raise exception 'Receiving counts must equal shipped quantity';
    end if;
    if v_rejected > 0 or v_damaged > 0 or v_missing > 0 then v_has_discrepancy := true; end if;
  end loop;
  if v_has_discrepancy and (p_discrepancy_reason is null or length(btrim(p_discrepancy_reason)) < 3) then
    raise exception 'A discrepancy reason is required';
  end if;

  insert into public.stock_transactions (
    reference, type, status, source_branch_id, dest_branch_id, reason, transfer_id,
    created_by, confirmed_at, idempotency_key, correlation_id
  ) values (
    public.next_stock_txn_reference(), 'transfer', 'posted', v_transfer.source_branch_id,
    v_transfer.dest_branch_id, 'Transfer receipt ' || v_transfer.reference, v_transfer.id,
    v_user, now(), p_idempotency_key, v_transfer.correlation_id
  ) returning id into v_txn_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select * into v_transfer_line from public.transfer_lines
    where id = (v_line->>'line_id')::uuid and transfer_id = p_transfer_id for update;
    v_received := round((v_line->>'received_qty')::numeric, 4);
    v_rejected := round((v_line->>'rejected_qty')::numeric, 4);
    v_damaged := round((v_line->>'damaged_qty')::numeric, 4);
    v_missing := round((v_line->>'missing_qty')::numeric, 4);
    v_remaining := v_received;

    for v_allocation in
      select * from public.transfer_lot_allocations
      where transfer_line_id = v_transfer_line.id
      order by expiration_date asc nulls last, received_date asc, created_at asc, id asc
      for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_allocation.allocated_qty);
      v_lot_status := case
        when v_allocation.expiration_date is not null and v_allocation.expiration_date < v_business_date
          then 'expired'::public.lot_status
        else 'available'::public.lot_status
      end;
      insert into public.inventory_lots (
        item_id, branch_id, lot_number, received_date, expiration_date,
        qty_remaining, unit_cost, status
      ) values (
        v_transfer_line.item_id, v_transfer.dest_branch_id, v_allocation.lot_number,
        v_business_date, v_allocation.expiration_date, v_take,
        v_allocation.unit_cost_snapshot, v_lot_status
      ) returning id into v_destination_lot_id;
      update public.transfer_lot_allocations set
        received_qty = v_take, destination_lot_id = v_destination_lot_id
      where id = v_allocation.id;
      insert into public.stock_transaction_lines (
        txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot
      ) values (
        v_txn_id, v_transfer_line.item_id, v_take, v_transfer_line.unit_id,
        v_destination_lot_id, v_allocation.unit_cost_snapshot
      );
      v_remaining := round(v_remaining - v_take, 4);
    end loop;
    if v_remaining > 0 then raise exception 'Received quantity exceeds allocated lots'; end if;

    if v_received > 0 then
      insert into public.inventory_balances (item_id, branch_id, qty_on_hand, updated_at)
      values (v_transfer_line.item_id, v_transfer.dest_branch_id, v_received, now())
      on conflict (item_id, branch_id) do update
        set qty_on_hand = public.inventory_balances.qty_on_hand + excluded.qty_on_hand,
            updated_at = now();
    end if;
    update public.transfer_lines set
      received_qty = v_received, rejected_qty = v_rejected,
      damaged_qty = v_damaged, missing_qty = v_missing
    where id = v_transfer_line.id;

    if v_rejected > 0 then
      insert into public.transfer_discrepancies
        (transfer_id, transfer_line_id, type, qty, reason, created_by)
      values (p_transfer_id, v_transfer_line.id, 'rejected', v_rejected, btrim(p_discrepancy_reason), v_user);
    end if;
    if v_damaged > 0 then
      insert into public.transfer_discrepancies
        (transfer_id, transfer_line_id, type, qty, reason, created_by)
      values (p_transfer_id, v_transfer_line.id, 'damaged', v_damaged, btrim(p_discrepancy_reason), v_user);
    end if;
    if v_missing > 0 then
      insert into public.transfer_discrepancies
        (transfer_id, transfer_line_id, type, qty, reason, created_by)
      values (p_transfer_id, v_transfer_line.id, 'missing', v_missing, btrim(p_discrepancy_reason), v_user);
    end if;
  end loop;

  update public.transfers set
    status = 'received', receive_idempotency_key = p_idempotency_key,
    received_by = v_user, received_at = now(), receive_txn_id = v_txn_id
  where id = p_transfer_id;
  if v_transfer.stock_request_id is not null then
    update public.stock_requests set status = 'fulfilled', updated_by = v_user
    where id = v_transfer.stock_request_id and status = 'approved';
  end if;
  return v_txn_id;
end $$;
revoke all on function public.receive_transfer(uuid, text, text, jsonb) from public;
grant execute on function public.receive_transfer(uuid, text, text, jsonb)
  to authenticated, service_role;

create or replace function public.resolve_transfer_discrepancy(
  p_discrepancy_id uuid,
  p_resolution text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_discrepancy public.transfer_discrepancies%rowtype;
begin
  if v_user is null or not public.has_permission(v_user, 'stock.transfer.approve') then
    raise exception 'Permission denied: stock.transfer.approve required';
  end if;
  if p_resolution is null or length(btrim(p_resolution)) < 3 then
    raise exception 'Resolution is required';
  end if;
  select * into v_discrepancy from public.transfer_discrepancies
  where id = p_discrepancy_id for update;
  if not found then raise exception 'Transfer discrepancy not found'; end if;
  if v_discrepancy.status <> 'open' then raise exception 'Transfer discrepancy is already resolved'; end if;
  update public.transfer_discrepancies set
    status = 'resolved', resolution = btrim(p_resolution),
    resolved_by = v_user, resolved_at = now()
  where id = p_discrepancy_id;
end $$;
revoke all on function public.resolve_transfer_discrepancy(uuid, text) from public;
grant execute on function public.resolve_transfer_discrepancy(uuid, text)
  to authenticated, service_role;
