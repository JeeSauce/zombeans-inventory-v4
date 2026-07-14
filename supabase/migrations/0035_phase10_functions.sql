-- 0035_phase10_functions.sql
-- Phase 10 actor-aware barcode, offline synchronization/review, mapping, and staged POS posting.

create or replace function public.next_offline_submission_reference() returns text
language sql volatile security definer set search_path = public as $$
  select 'OFF-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.offline_submission_ref_seq')::text, 6, '0')
$$;

create or replace function public.next_pos_import_reference() returns text
language sql volatile security definer set search_path = public as $$
  select 'POS-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.pos_import_ref_seq')::text, 6, '0')
$$;

revoke all on function public.next_offline_submission_reference() from public;
revoke all on function public.next_pos_import_reference() from public;

-- Read-only barcode lookup. Product variants resolve to their product's unified inventory item.
create or replace function public.lookup_inventory_item_by_barcode(p_barcode text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_code text := btrim(coalesce(p_barcode, ''));
  v_item_count integer;
  v_result jsonb;
begin
  if v_user is null or not public.has_permission(v_user, 'catalog.item.read') then
    raise exception 'Permission denied: catalog.item.read required';
  end if;
  if length(v_code) < 3 or length(v_code) > 128 then
    raise exception 'Barcode must contain 3 to 128 characters';
  end if;

  with matches as (
    select ii.id as item_id, ii.name, ii.sku, u.code as unit_code,
      b.code as barcode, 'Inventory item'::text as source_label, 1 as priority
    from public.barcodes b
    join public.inventory_items ii on ii.id = b.item_id
    join public.units u on u.id = ii.base_unit_id
    where b.code = v_code and ii.active and ii.deleted_at is null
    union all
    select ii.id, ii.name, ii.sku, u.code, pv.barcode,
      'Variant: ' || pv.name, 2
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    join public.inventory_items ii on ii.id = p.item_id
    join public.units u on u.id = ii.base_unit_id
    where pv.barcode = v_code and pv.is_active and pv.deleted_at is null
      and p.is_active and p.deleted_at is null and ii.active and ii.deleted_at is null
  )
  select count(distinct item_id)::int into v_item_count from matches;

  if v_item_count = 0 then
    return jsonb_build_object('found', false, 'barcode', v_code);
  end if;
  if v_item_count > 1 then
    raise exception 'Barcode is ambiguous and must be corrected in the catalog';
  end if;

  with matches as (
    select ii.id as item_id, ii.name, ii.sku, u.code as unit_code,
      b.code as barcode, 'Inventory item'::text as source_label, 1 as priority
    from public.barcodes b
    join public.inventory_items ii on ii.id = b.item_id
    join public.units u on u.id = ii.base_unit_id
    where b.code = v_code and ii.active and ii.deleted_at is null
    union all
    select ii.id, ii.name, ii.sku, u.code, pv.barcode,
      'Variant: ' || pv.name, 2
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    join public.inventory_items ii on ii.id = p.item_id
    join public.units u on u.id = ii.base_unit_id
    where pv.barcode = v_code and pv.is_active and pv.deleted_at is null
      and p.is_active and p.deleted_at is null and ii.active and ii.deleted_at is null
  )
  select jsonb_build_object(
    'found', true,
    'itemId', item_id,
    'name', name,
    'sku', sku,
    'barcode', barcode,
    'sourceLabel', source_label,
    'unitCode', unit_code
  ) into v_result
  from matches order by priority limit 1;

  return v_result;
end;
$$;
revoke all on function public.lookup_inventory_item_by_barcode(text) from public;
grant execute on function public.lookup_inventory_item_by_barcode(text)
  to authenticated, service_role;

-- Issue an unforgeable server-time snapshot receipt for one device draft and normalized scope.
create or replace function public.issue_offline_snapshot(
  p_snapshot_type public.offline_submission_type,
  p_branch_id uuid,
  p_client_draft_id uuid,
  p_item_ids jsonb default '[]'::jsonb,
  p_production_order_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_existing public.offline_snapshots%rowtype;
  v_snapshot_id uuid := gen_random_uuid();
  v_captured_at timestamptz := now();
  v_expires_at timestamptz := now() + interval '30 days';
  v_audit_id uuid;
  v_count integer;
  v_distinct integer;
  v_order public.production_orders%rowtype;
begin
  if v_user is null or not public.has_permission(v_user, 'offline.sync') then
    raise exception 'Permission denied: offline.sync required';
  end if;
  if p_client_draft_id is null then raise exception 'Client draft ID is required'; end if;
  if not public.has_branch_access(v_user, p_branch_id) then
    raise exception 'Permission denied for branch';
  end if;
  perform 1 from public.branches
  where id = p_branch_id and active and deleted_at is null;
  if not found then raise exception 'Active branch not found'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'offline-snapshot:' || v_user::text || ':' || p_client_draft_id::text, 0
  ));
  select * into v_existing from public.offline_snapshots
  where created_by = v_user and client_draft_id = p_client_draft_id;
  if found then
    if v_existing.snapshot_type <> p_snapshot_type
       or v_existing.branch_id <> p_branch_id
       or v_existing.production_order_id is distinct from p_production_order_id then
      raise exception 'Client draft already has a different snapshot scope';
    end if;
    if p_snapshot_type = 'recount' and (
      (select count(*) from public.offline_snapshot_items where snapshot_id = v_existing.id)
        <> jsonb_array_length(p_item_ids)
      or exists (
        select 1 from jsonb_array_elements_text(p_item_ids) input
        where not exists (
          select 1 from public.offline_snapshot_items osi
          where osi.snapshot_id = v_existing.id and osi.item_id = input.value::uuid
        )
      )
    ) then
      raise exception 'Client draft already has a different snapshot scope';
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'capturedAt', v_existing.captured_at,
      'expiresAt', v_existing.expires_at,
      'replayed', true
    );
  end if;

  if p_snapshot_type = 'recount' then
    if not public.has_permission(v_user, 'recount.perform') then
      raise exception 'Permission denied: recount.perform required';
    end if;
    if p_item_ids is null or jsonb_typeof(p_item_ids) <> 'array'
       or jsonb_array_length(p_item_ids) < 1 or jsonb_array_length(p_item_ids) > 100 then
      raise exception 'Offline recount snapshot requires 1 to 100 items';
    end if;
    select count(*)::int, count(distinct value)::int into v_count, v_distinct
    from jsonb_array_elements_text(p_item_ids);
    if v_count <> v_distinct then raise exception 'Snapshot items must be unique'; end if;
    begin
      perform value::uuid from jsonb_array_elements_text(p_item_ids);
    exception when others then
      raise exception 'Snapshot contains an invalid item';
    end;
    if exists (
      select 1 from jsonb_array_elements_text(p_item_ids) input
      where not exists (
        select 1 from public.inventory_items ii
        where ii.id = input.value::uuid and ii.active and ii.trackable
          and ii.deleted_at is null
      )
    ) then raise exception 'Snapshot item is inactive or unavailable'; end if;
    if p_production_order_id is not null then
      raise exception 'Recount snapshot cannot target a production order';
    end if;
  else
    if not public.has_permission(v_user, 'production.record') then
      raise exception 'Permission denied: production.record required';
    end if;
    select * into v_order from public.production_orders
    where id = p_production_order_id and branch_id = p_branch_id;
    if not found then raise exception 'Production order not found'; end if;
    if v_order.status <> 'in_progress' then
      raise exception 'Production order must be in progress';
    end if;
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, after, branch_id, correlation_id
  ) values (
    v_user, 'offline.snapshot.issued', 'offline_snapshot', v_snapshot_id::text,
    jsonb_build_object(
      'snapshot_type', p_snapshot_type,
      'client_draft_id', p_client_draft_id,
      'captured_at', v_captured_at,
      'item_count', case when p_snapshot_type = 'recount' then v_count else null end
    ),
    p_branch_id, p_client_draft_id
  ) returning id into v_audit_id;

  insert into public.offline_snapshots (
    id, snapshot_type, branch_id, client_draft_id, production_order_id,
    captured_at, expires_at, created_by, audit_log_id
  ) values (
    v_snapshot_id, p_snapshot_type, p_branch_id, p_client_draft_id,
    p_production_order_id, v_captured_at, v_expires_at, v_user, v_audit_id
  );
  if p_snapshot_type = 'recount' then
    insert into public.offline_snapshot_items (snapshot_id, item_id)
    select v_snapshot_id, value::uuid from jsonb_array_elements_text(p_item_ids);
  else
    insert into public.offline_snapshot_items (snapshot_id, item_id)
    select v_snapshot_id, item_id from (
      select poi.item_id from public.production_order_inputs poi
      where poi.production_order_id = p_production_order_id
      union
      select v_order.output_item_id
    ) scope;
  end if;

  return jsonb_build_object(
    'id', v_snapshot_id,
    'capturedAt', v_captured_at,
    'expiresAt', v_expires_at,
    'replayed', false
  );
end;
$$;
revoke all on function public.issue_offline_snapshot(
  public.offline_submission_type, uuid, uuid, jsonb, uuid
) from public;
grant execute on function public.issue_offline_snapshot(
  public.offline_submission_type, uuid, uuid, jsonb, uuid
) to authenticated, service_role;

-- Private recount application helper. It composes the Phase 7 primitives and therefore preserves
-- lot handling, cost snapshots, day-close checks, unusual thresholds, alerts, and replay behavior.
create or replace function public.phase10_apply_offline_recount(
  p_branch_id uuid,
  p_business_date date,
  p_idempotency_key uuid,
  p_reason text,
  p_lines jsonb,
  p_require_post boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_open jsonb;
  v_submit jsonb;
  v_adjust jsonb;
  v_session_id uuid;
  v_submit_lines jsonb;
  v_line_count integer;
begin
  if v_user is null
     or not public.has_permission(v_user, 'offline.sync')
     or not public.has_permission(v_user, 'recount.perform') then
    raise exception 'Permission denied: offline.sync and recount.perform required';
  end if;
  if not public.has_branch_access(v_user, p_branch_id) then
    raise exception 'Permission denied for branch';
  end if;

  select public.open_recount(
    p_branch_id,
    p_business_date,
    'cycle'::public.recount_session_type,
    p_idempotency_key::text || ':open',
    coalesce((
      select jsonb_agg(value->>'itemId' order by value->>'itemId')
      from jsonb_array_elements(p_lines)
    ), '[]'::jsonb)
  ) into v_open;
  v_session_id := (v_open->>'id')::uuid;

  select jsonb_agg(
      jsonb_build_object('line_id', rl.id, 'physical_qty', input.value->'physicalQty')
      order by rl.id
    ), count(*)::int
  into v_submit_lines, v_line_count
  from public.recount_lines rl
  join jsonb_array_elements(p_lines) input
    on (input.value->>'itemId')::uuid = rl.item_id
  where rl.session_id = v_session_id;

  if v_line_count <> jsonb_array_length(p_lines) then
    raise exception 'One or more recount items are unavailable';
  end if;

  select public.submit_recount(
    v_session_id,
    p_idempotency_key::text || ':submit',
    v_submit_lines
  ) into v_submit;

  if v_submit->>'status' = 'closed' then
    return jsonb_build_object(
      'status', 'synced',
      'session_id', v_session_id,
      'recount_reference', v_submit->>'reference',
      'stock_txn_id', null,
      'is_unusual', false
    );
  end if;

  if coalesce((v_submit->>'is_unusual')::boolean, false) and not p_require_post then
    return jsonb_build_object(
      'status', 'review_required',
      'session_id', v_session_id,
      'recount_reference', v_submit->>'reference',
      'stock_txn_id', null,
      'is_unusual', true,
      'conflict_reason', 'Unusual recount variance requires authorized review'
    );
  end if;

  select public.post_recount_adjustment(
    v_session_id,
    'other'::public.recount_adjustment_reason,
    p_reason,
    p_idempotency_key::text
  ) into v_adjust;

  return jsonb_build_object(
    'status', 'posted',
    'session_id', v_session_id,
    'recount_reference', v_submit->>'reference',
    'adjustment_reference', v_adjust->>'reference',
    'stock_txn_id', v_adjust->>'stock_txn_id',
    'is_unusual', coalesce((v_adjust->>'is_unusual')::boolean, false)
  );
end;
$$;
revoke all on function public.phase10_apply_offline_recount(
  uuid, date, uuid, text, jsonb, boolean
) from public;

create or replace function public.submit_offline_recount(
  p_branch_id uuid,
  p_business_date date,
  p_client_draft_id uuid,
  p_snapshot_id uuid,
  p_client_created_at timestamptz,
  p_idempotency_key uuid,
  p_reason text,
  p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_existing public.offline_submissions%rowtype;
  v_submission_id uuid := gen_random_uuid();
  v_reference text;
  v_audit_id uuid;
  v_result jsonb;
  v_status public.offline_submission_status;
  v_conflict text;
  v_session_id uuid;
  v_stock_txn_id uuid;
  v_stock_reference text;
  v_count integer;
  v_distinct integer;
  v_line jsonb;
  v_physical numeric;
  v_snapshot public.offline_snapshots%rowtype;
begin
  if v_user is null
     or not public.has_permission(v_user, 'offline.sync')
     or not public.has_permission(v_user, 'recount.perform') then
    raise exception 'Permission denied: offline.sync and recount.perform required';
  end if;
  if p_idempotency_key is null or p_client_draft_id is null then
    raise exception 'Stable draft and idempotency keys are required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Recount reason is required';
  end if;
  if p_business_date is null
     or p_business_date > (now() at time zone 'Asia/Manila')::date then
    raise exception 'Business date must not be in the future';
  end if;
  if p_client_created_at is null or p_client_created_at > now() + interval '5 minutes' then
    raise exception 'Offline recount creation time is invalid';
  end if;
  if not public.has_branch_access(v_user, p_branch_id) then
    raise exception 'Permission denied for branch';
  end if;
  perform 1 from public.branches
  where id = p_branch_id and active and deleted_at is null;
  if not found then raise exception 'Active branch not found'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'offline-recount:' || p_idempotency_key::text, 0
  ));
  select * into v_existing from public.offline_submissions
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.submission_type <> 'recount'
       or v_existing.client_draft_id <> p_client_draft_id
       or v_existing.submitted_by <> v_user then
      raise exception 'Idempotency key belongs to another offline submission';
    end if;
    if v_existing.result_stock_txn_id is not null then
      select reference into v_stock_reference from public.stock_transactions
      where id = v_existing.result_stock_txn_id;
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'reference', v_existing.reference,
      'status', v_existing.status,
      'conflictReason', v_existing.conflict_reason,
      'stockTransactionReference', v_stock_reference,
      'replayed', true
    );
  end if;
  if exists (
    select 1 from public.offline_submissions
    where submitted_by = v_user and client_draft_id = p_client_draft_id
  ) then
    raise exception 'Client draft was already submitted with another key';
  end if;

  select * into v_snapshot from public.offline_snapshots
  where id = p_snapshot_id for update;
  if not found or v_snapshot.snapshot_type <> 'recount'
     or v_snapshot.branch_id <> p_branch_id
     or v_snapshot.client_draft_id <> p_client_draft_id
     or v_snapshot.created_by <> v_user
     or v_snapshot.expires_at <= now() then
    raise exception 'Offline recount snapshot is invalid or expired';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) < 1 or jsonb_array_length(p_lines) > 100 then
    raise exception 'Offline recount requires 1 to 100 lines';
  end if;
  select count(*)::int, count(distinct value->>'itemId')::int
    into v_count, v_distinct from jsonb_array_elements(p_lines);
  if v_count <> v_distinct then raise exception 'Recount items must be unique'; end if;
  if (select count(*) from public.offline_snapshot_items where snapshot_id = v_snapshot.id)
       <> v_count
     or exists (
       select 1 from jsonb_array_elements(p_lines) input
       where not exists (
         select 1 from public.offline_snapshot_items osi
         where osi.snapshot_id = v_snapshot.id
           and osi.item_id = (input.value->>'itemId')::uuid
       )
     ) then
    raise exception 'Offline recount lines do not match the server snapshot scope';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    begin
      perform (v_line->>'itemId')::uuid;
      v_physical := (v_line->>'physicalQty')::numeric;
    exception when others then
      raise exception 'Recount lines contain an invalid item or quantity';
    end;
    if v_physical < 0 or v_physical > 9999999999 or v_physical <> round(v_physical, 4) then
      raise exception 'Physical quantities must be non-negative with at most four decimals';
    end if;
    perform 1 from public.inventory_items
    where id = (v_line->>'itemId')::uuid and active and trackable and deleted_at is null;
    if not found then raise exception 'Recount item is inactive or unavailable'; end if;
  end loop;

  -- Deterministic item-scope locks serialize overlapping offline drafts before conflict detection.
  perform pg_advisory_xact_lock(hashtextextended(
    'offline-scope:' || p_branch_id::text || ':' || scope.item_id, 0
  ))
  from (
    select distinct value->>'itemId' as item_id
    from jsonb_array_elements(p_lines)
    order by value->>'itemId'
  ) scope;

  if exists (
    select 1 from public.recount_sessions
    where branch_id = p_branch_id and business_date = p_business_date
      and type = 'cycle' and status in ('draft', 'submitted')
  ) then
    v_conflict := 'An online or offline cycle recount is already open for this branch and date';
  elsif exists (
    select 1
    from public.stock_transactions st
    join public.stock_transaction_lines stl on stl.txn_id = st.id
    join jsonb_array_elements(p_lines) input
      on (input.value->>'itemId')::uuid = stl.item_id
    where st.status = 'posted' and st.created_at > v_snapshot.captured_at
      and case when stl.qty >= 0 then st.dest_branch_id else st.source_branch_id end = p_branch_id
  ) then
    v_conflict := 'Inventory moved after this draft snapshot; explicit review is required';
  end if;

  if v_conflict is null then
    v_result := public.phase10_apply_offline_recount(
      p_branch_id, p_business_date, p_idempotency_key, btrim(p_reason), p_lines, false
    );
    v_status := (v_result->>'status')::public.offline_submission_status;
    v_conflict := v_result->>'conflict_reason';
    v_session_id := nullif(v_result->>'session_id', '')::uuid;
    v_stock_txn_id := nullif(v_result->>'stock_txn_id', '')::uuid;
  else
    v_status := 'review_required';
  end if;

  v_reference := public.next_offline_submission_reference();
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, after, reason, branch_id, correlation_id
  ) values (
    v_user,
    case when v_status = 'review_required'
      then 'offline.recount.review_required' else 'offline.recount.synced' end,
    'offline_submission', v_submission_id::text,
    jsonb_build_object(
      'reference', v_reference,
      'status', v_status,
      'business_date', p_business_date,
      'client_draft_id', p_client_draft_id,
      'line_count', v_count
    ),
    coalesce(v_conflict, btrim(p_reason)), p_branch_id, p_idempotency_key
  ) returning id into v_audit_id;

  insert into public.offline_submissions (
    id, reference, submission_type, status, branch_id, client_draft_id, snapshot_id,
    client_created_at, snapshot_at, business_date, idempotency_key, payload,
    conflict_reason, submitted_by, result_recount_session_id, result_stock_txn_id,
    audit_log_id
  ) values (
    v_submission_id, v_reference, 'recount', v_status, p_branch_id, p_client_draft_id,
    v_snapshot.id, p_client_created_at, v_snapshot.captured_at, p_business_date, p_idempotency_key,
    jsonb_build_object('reason', btrim(p_reason), 'lines', p_lines),
    v_conflict, v_user, v_session_id, v_stock_txn_id, v_audit_id
  );

  insert into public.offline_submission_items (submission_id, item_id, physical_qty)
  select v_submission_id, (value->>'itemId')::uuid, (value->>'physicalQty')::numeric
  from jsonb_array_elements(p_lines);

  if v_stock_txn_id is not null then
    select reference into v_stock_reference from public.stock_transactions
    where id = v_stock_txn_id;
  end if;
  return jsonb_build_object(
    'id', v_submission_id,
    'reference', v_reference,
    'status', v_status,
    'conflictReason', v_conflict,
    'stockTransactionReference', v_stock_reference,
    'replayed', false
  );
end;
$$;
revoke all on function public.submit_offline_recount(
  uuid, date, uuid, uuid, timestamptz, uuid, text, jsonb
) from public;
grant execute on function public.submit_offline_recount(
  uuid, date, uuid, uuid, timestamptz, uuid, text, jsonb
) to authenticated, service_role;

create or replace function public.submit_offline_production(
  p_production_order_id uuid,
  p_client_draft_id uuid,
  p_snapshot_id uuid,
  p_client_created_at timestamptz,
  p_idempotency_key uuid,
  p_actual_output_qty numeric,
  p_output_lot_number text,
  p_production_date date,
  p_expiration_date date,
  p_notes text,
  p_inputs jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_existing public.offline_submissions%rowtype;
  v_order public.production_orders%rowtype;
  v_submission_id uuid := gen_random_uuid();
  v_reference text;
  v_audit_id uuid;
  v_status public.offline_submission_status;
  v_conflict text;
  v_payload jsonb;
  v_snapshot public.offline_snapshots%rowtype;
begin
  if v_user is null
     or not public.has_permission(v_user, 'offline.sync')
     or not public.has_permission(v_user, 'production.record') then
    raise exception 'Permission denied: offline.sync and production.record required';
  end if;
  if p_idempotency_key is null or p_client_draft_id is null then
    raise exception 'Stable draft and idempotency keys are required';
  end if;
  if p_client_created_at is null or p_client_created_at > now() + interval '5 minutes' then
    raise exception 'Offline production creation time is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'offline-production:' || p_idempotency_key::text, 0
  ));
  select * into v_existing from public.offline_submissions
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.submission_type <> 'production'
       or v_existing.client_draft_id <> p_client_draft_id
       or v_existing.submitted_by <> v_user then
      raise exception 'Idempotency key belongs to another offline submission';
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'reference', v_existing.reference,
      'status', v_existing.status,
      'conflictReason', v_existing.conflict_reason,
      'productionOrderReference', (
        select reference from public.production_orders
        where id = v_existing.result_production_order_id
      ),
      'replayed', true
    );
  end if;
  if exists (
    select 1 from public.offline_submissions
    where submitted_by = v_user and client_draft_id = p_client_draft_id
  ) then
    raise exception 'Client draft was already submitted with another key';
  end if;

  select * into v_snapshot from public.offline_snapshots
  where id = p_snapshot_id for update;
  if not found or v_snapshot.snapshot_type <> 'production'
     or v_snapshot.production_order_id <> p_production_order_id
     or v_snapshot.client_draft_id <> p_client_draft_id
     or v_snapshot.created_by <> v_user
     or v_snapshot.expires_at <= now() then
    raise exception 'Offline production snapshot is invalid or expired';
  end if;

  select * into v_order from public.production_orders
  where id = p_production_order_id for update;
  if not found then raise exception 'Production order not found'; end if;
  if v_snapshot.branch_id <> v_order.branch_id then
    raise exception 'Offline production snapshot has a different branch scope';
  end if;
  if not public.has_branch_access(v_user, v_order.branch_id) then
    raise exception 'Permission denied for branch';
  end if;

  v_payload := jsonb_build_object(
    'productionOrderId', p_production_order_id,
    'actualOutputQty', p_actual_output_qty,
    'outputLotNumber', p_output_lot_number,
    'productionDate', p_production_date,
    'expirationDate', p_expiration_date,
    'notes', p_notes,
    'inputs', p_inputs
  );

  if v_order.status <> 'in_progress' then
    v_conflict := 'Production order is no longer in progress';
    v_status := 'review_required';
  elsif v_order.updated_at > v_snapshot.captured_at then
    v_conflict := 'Production order changed after this draft snapshot';
    v_status := 'review_required';
  else
    perform public.record_production_actuals(
      p_production_order_id, p_actual_output_qty, p_output_lot_number,
      p_production_date, p_expiration_date, p_notes, p_inputs
    );
    v_status := 'synced';
  end if;

  v_reference := public.next_offline_submission_reference();
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, after, reason, branch_id, correlation_id
  ) values (
    v_user,
    case when v_status = 'review_required'
      then 'offline.production.review_required' else 'offline.production.synced' end,
    'offline_submission', v_submission_id::text,
    jsonb_build_object(
      'reference', v_reference,
      'status', v_status,
      'production_reference', v_order.reference,
      'client_draft_id', p_client_draft_id
    ),
    v_conflict, v_order.branch_id, p_idempotency_key
  ) returning id into v_audit_id;

  insert into public.offline_submissions (
    id, reference, submission_type, status, branch_id, client_draft_id, snapshot_id,
    client_created_at, snapshot_at, idempotency_key, payload, conflict_reason,
    submitted_by, result_production_order_id, audit_log_id
  ) values (
    v_submission_id, v_reference, 'production', v_status, v_order.branch_id,
    p_client_draft_id, v_snapshot.id, p_client_created_at, v_snapshot.captured_at, p_idempotency_key,
    v_payload, v_conflict, v_user, p_production_order_id, v_audit_id
  );

  insert into public.offline_submission_items (submission_id, item_id)
  select v_submission_id, item_id
  from (
    select poi.item_id from public.production_order_inputs poi
    where poi.production_order_id = p_production_order_id
    union
    select v_order.output_item_id
  ) scope;

  return jsonb_build_object(
    'id', v_submission_id,
    'reference', v_reference,
    'status', v_status,
    'conflictReason', v_conflict,
    'productionOrderReference', v_order.reference,
    'replayed', false
  );
end;
$$;
revoke all on function public.submit_offline_production(
  uuid, uuid, uuid, timestamptz, uuid, numeric, text, date, date, text, jsonb
) from public;
grant execute on function public.submit_offline_production(
  uuid, uuid, uuid, timestamptz, uuid, numeric, text, date, date, text, jsonb
) to authenticated, service_role;

create or replace function public.list_offline_conflicts()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null or not public.has_permission(v_user, 'offline.review') then
    raise exception 'Permission denied: offline.review required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', os.id,
    'reference', os.reference,
    'submissionType', os.submission_type,
    'branchName', b.name,
    'businessDate', os.business_date,
    'snapshotAt', os.snapshot_at,
    'submittedAt', os.submitted_at,
    'submittedByName', p.full_name,
    'conflictReason', os.conflict_reason,
    'productionOrderReference', po.reference,
    'details', os.payload,
    'items', coalesce(scope.items, '[]'::jsonb)
  ) order by os.submitted_at), '[]'::jsonb)
  into v_result
  from public.offline_submissions os
  join public.branches b on b.id = os.branch_id
  join public.profiles p on p.id = os.submitted_by
  left join public.production_orders po on po.id = os.result_production_order_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'name', ii.name,
      'sku', ii.sku,
      'physicalQty', osi.physical_qty,
      'unitCode', u.code
    ) order by ii.name) as items
    from public.offline_submission_items osi
    join public.inventory_items ii on ii.id = osi.item_id
    join public.units u on u.id = ii.base_unit_id
    where osi.submission_id = os.id
  ) scope on true
  where os.status = 'review_required'
    and public.has_branch_access(v_user, os.branch_id);

  return v_result;
end;
$$;
revoke all on function public.list_offline_conflicts() from public;
grant execute on function public.list_offline_conflicts() to authenticated, service_role;

create or replace function public.resolve_offline_conflict(
  p_submission_id uuid,
  p_decision public.offline_resolution_decision,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_submission public.offline_submissions%rowtype;
  v_existing public.offline_conflict_resolutions%rowtype;
  v_result jsonb;
  v_stock_txn_id uuid;
  v_stock_reference text;
  v_status public.offline_submission_status;
  v_audit_id uuid;
  v_resolution_id uuid := gen_random_uuid();
begin
  if v_user is null or not public.has_permission(v_user, 'offline.review') then
    raise exception 'Permission denied: offline.review required';
  end if;
  if p_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Resolution reason is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'offline-resolution:' || p_idempotency_key::text, 0
  ));
  select * into v_existing from public.offline_conflict_resolutions
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.submission_id <> p_submission_id
       or v_existing.decision <> p_decision then
      raise exception 'Idempotency key belongs to another conflict resolution';
    end if;
    select * into v_submission from public.offline_submissions
    where id = v_existing.submission_id;
    if v_existing.result_stock_txn_id is not null then
      select reference into v_stock_reference from public.stock_transactions
      where id = v_existing.result_stock_txn_id;
    end if;
    return jsonb_build_object(
      'reference', v_submission.reference,
      'status', v_submission.status,
      'decision', v_existing.decision,
      'stockTransactionReference', v_stock_reference,
      'replayed', true
    );
  end if;

  select * into v_submission from public.offline_submissions
  where id = p_submission_id for update;
  if not found then raise exception 'Offline submission not found'; end if;
  if v_submission.status <> 'review_required' then
    raise exception 'Offline submission no longer requires review';
  end if;
  if not public.has_branch_access(v_user, v_submission.branch_id) then
    raise exception 'Permission denied for branch';
  end if;

  if p_decision = 'reject' then
    v_status := 'rejected';
  elsif v_submission.submission_type = 'recount' then
    if v_submission.result_recount_session_id is not null then
      v_result := public.post_recount_adjustment(
        v_submission.result_recount_session_id,
        'other'::public.recount_adjustment_reason,
        btrim(p_reason),
        p_idempotency_key::text
      );
      v_stock_txn_id := nullif(v_result->>'stock_txn_id', '')::uuid;
      v_status := 'posted';
    else
      v_result := public.phase10_apply_offline_recount(
        v_submission.branch_id,
        v_submission.business_date,
        p_idempotency_key,
        btrim(p_reason),
        v_submission.payload->'lines',
        true
      );
      v_stock_txn_id := nullif(v_result->>'stock_txn_id', '')::uuid;
      v_status := (v_result->>'status')::public.offline_submission_status;
    end if;
  else
    perform public.record_production_actuals(
      (v_submission.payload->>'productionOrderId')::uuid,
      (v_submission.payload->>'actualOutputQty')::numeric,
      v_submission.payload->>'outputLotNumber',
      (v_submission.payload->>'productionDate')::date,
      (v_submission.payload->>'expirationDate')::date,
      v_submission.payload->>'notes',
      v_submission.payload->'inputs'
    );
    v_status := 'synced';
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before, after, reason, branch_id,
    correlation_id
  ) values (
    v_user, 'offline.conflict.' || p_decision::text,
    'offline_submission', v_submission.id::text,
    jsonb_build_object('status', v_submission.status, 'reference', v_submission.reference),
    jsonb_build_object('status', v_status, 'decision', p_decision),
    btrim(p_reason), v_submission.branch_id, p_idempotency_key
  ) returning id into v_audit_id;

  insert into public.offline_conflict_resolutions (
    id, submission_id, decision, reason, idempotency_key, actor_id,
    audit_log_id, result_stock_txn_id
  ) values (
    v_resolution_id, v_submission.id, p_decision, btrim(p_reason),
    p_idempotency_key, v_user, v_audit_id, v_stock_txn_id
  );

  update public.offline_submissions set
    status = v_status,
    result_stock_txn_id = coalesce(v_stock_txn_id, result_stock_txn_id),
    resolved_by = v_user,
    resolved_at = now()
  where id = v_submission.id;

  if v_stock_txn_id is not null then
    select reference into v_stock_reference from public.stock_transactions
    where id = v_stock_txn_id;
  end if;
  return jsonb_build_object(
    'reference', v_submission.reference,
    'status', v_status,
    'decision', p_decision,
    'stockTransactionReference', v_stock_reference,
    'replayed', false
  );
end;
$$;
revoke all on function public.resolve_offline_conflict(
  uuid, public.offline_resolution_decision, text, uuid
) from public;
grant execute on function public.resolve_offline_conflict(
  uuid, public.offline_resolution_decision, text, uuid
) to authenticated, service_role;

create or replace function public.upsert_loyverse_mapping(
  p_entity_type public.loyverse_entity_type,
  p_external_id text,
  p_external_name text,
  p_external_sku text,
  p_inventory_item_id uuid,
  p_inventory_qty numeric,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_mapping public.loyverse_mappings%rowtype;
  v_command public.loyverse_mapping_commands%rowtype;
  v_mapping_id uuid;
  v_audit_id uuid;
  v_result jsonb;
begin
  if v_user is null or not public.has_permission(v_user, 'pos.import') then
    raise exception 'Permission denied: pos.import required';
  end if;
  if p_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if p_external_id is null or length(btrim(p_external_id)) < 1
     or length(btrim(p_external_id)) > 200 then
    raise exception 'External ID is required';
  end if;
  if p_inventory_qty is null or p_inventory_qty <= 0
     or p_inventory_qty > 9999999999 or p_inventory_qty <> round(p_inventory_qty, 4) then
    raise exception 'Mapped inventory quantity must be positive with at most four decimals';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Mapping reason is required';
  end if;
  perform 1 from public.inventory_items
  where id = p_inventory_item_id and active and trackable and deleted_at is null;
  if not found then raise exception 'Mapped inventory item is inactive or unavailable'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'loyverse-map-command:' || p_idempotency_key::text, 0
  ));
  select * into v_command from public.loyverse_mapping_commands
  where idempotency_key = p_idempotency_key;
  if found then
    return v_command.result || jsonb_build_object('replayed', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'loyverse-map:' || p_entity_type::text || ':' || btrim(p_external_id), 0
  ));

  select * into v_mapping from public.loyverse_mappings
  where entity_type = p_entity_type and external_id = btrim(p_external_id)
  for update;
  if found then
    update public.loyverse_mappings set
      external_name = nullif(btrim(p_external_name), ''),
      external_sku = nullif(btrim(p_external_sku), ''),
      inventory_item_id = p_inventory_item_id,
      inventory_qty = round(p_inventory_qty, 4),
      active = true,
      updated_by = v_user
    where id = v_mapping.id
    returning * into v_mapping;
  else
    insert into public.loyverse_mappings (
      entity_type, external_id, external_name, external_sku, inventory_item_id,
      inventory_qty, created_by, updated_by
    ) values (
      p_entity_type, btrim(p_external_id), nullif(btrim(p_external_name), ''),
      nullif(btrim(p_external_sku), ''), p_inventory_item_id,
      round(p_inventory_qty, 4), v_user, v_user
    ) returning * into v_mapping;
  end if;

  v_mapping_id := v_mapping.id;
  v_result := jsonb_build_object(
    'id', v_mapping.id,
    'entityType', v_mapping.entity_type,
    'externalId', v_mapping.external_id,
    'active', v_mapping.active
  );
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, after, reason, correlation_id
  ) values (
    v_user, 'loyverse.mapping.upserted', 'loyverse_mapping', v_mapping.id::text,
    v_result - 'id', btrim(p_reason), p_idempotency_key
  ) returning id into v_audit_id;
  insert into public.loyverse_mapping_commands (
    mapping_id, command_type, idempotency_key, reason, actor_id, audit_log_id, result
  ) values (
    v_mapping_id, 'upsert', p_idempotency_key, btrim(p_reason), v_user, v_audit_id,
    v_result
  );
  return v_result || jsonb_build_object('replayed', false);
end;
$$;
revoke all on function public.upsert_loyverse_mapping(
  public.loyverse_entity_type, text, text, text, uuid, numeric, text, uuid
) from public;
grant execute on function public.upsert_loyverse_mapping(
  public.loyverse_entity_type, text, text, text, uuid, numeric, text, uuid
) to authenticated, service_role;

create or replace function public.deactivate_loyverse_mapping(
  p_mapping_id uuid,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_mapping public.loyverse_mappings%rowtype;
  v_command public.loyverse_mapping_commands%rowtype;
  v_audit_id uuid;
  v_result jsonb;
begin
  if v_user is null or not public.has_permission(v_user, 'pos.import') then
    raise exception 'Permission denied: pos.import required';
  end if;
  if p_idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Mapping reason is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'loyverse-map-command:' || p_idempotency_key::text, 0
  ));
  select * into v_command from public.loyverse_mapping_commands
  where idempotency_key = p_idempotency_key;
  if found then return v_command.result || jsonb_build_object('replayed', true); end if;

  select * into v_mapping from public.loyverse_mappings
  where id = p_mapping_id for update;
  if not found then raise exception 'Loyverse mapping not found'; end if;
  update public.loyverse_mappings set active = false, updated_by = v_user
  where id = p_mapping_id returning * into v_mapping;

  v_result := jsonb_build_object(
    'id', v_mapping.id,
    'entityType', v_mapping.entity_type,
    'externalId', v_mapping.external_id,
    'active', false
  );
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, after, reason, correlation_id
  ) values (
    v_user, 'loyverse.mapping.deactivated', 'loyverse_mapping', v_mapping.id::text,
    v_result - 'id', btrim(p_reason), p_idempotency_key
  ) returning id into v_audit_id;
  insert into public.loyverse_mapping_commands (
    mapping_id, command_type, idempotency_key, reason, actor_id, audit_log_id, result
  ) values (
    v_mapping.id, 'deactivate', p_idempotency_key, btrim(p_reason), v_user,
    v_audit_id, v_result
  );
  return v_result || jsonb_build_object('replayed', false);
end;
$$;
revoke all on function public.deactivate_loyverse_mapping(uuid, text, uuid) from public;
grant execute on function public.deactivate_loyverse_mapping(uuid, text, uuid)
  to authenticated, service_role;

create or replace function public.preview_pos_import(
  p_branch_id uuid,
  p_filename text,
  p_idempotency_key uuid,
  p_rows jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_existing public.pos_imports%rowtype;
  v_import_id uuid := gen_random_uuid();
  v_reference text;
  v_payload_hash text;
  v_audit_id uuid;
  v_row jsonb;
  v_row_number integer;
  v_external_reference text;
  v_external_line_id text;
  v_occurred_at timestamptz;
  v_movement_type public.pos_movement_type;
  v_entity_type public.loyverse_entity_type;
  v_external_id text;
  v_quantity numeric;
  v_mapping public.loyverse_mappings%rowtype;
  v_inventory_qty numeric(14,4);
  v_validation_status public.pos_row_status;
  v_validation_error text;
  v_row_count integer;
  v_valid_count integer := 0;
  v_error_count integer := 0;
begin
  if v_user is null or not public.has_permission(v_user, 'pos.import') then
    raise exception 'Permission denied: pos.import required';
  end if;
  if not public.has_branch_access(v_user, p_branch_id) then
    raise exception 'Permission denied for branch';
  end if;
  perform 1 from public.branches
  where id = p_branch_id and active and deleted_at is null;
  if not found then raise exception 'Active branch not found'; end if;
  if p_idempotency_key is null then raise exception 'Preview idempotency key is required'; end if;
  if p_filename is null or length(btrim(p_filename)) < 1 or length(btrim(p_filename)) > 255 then
    raise exception 'CSV filename is required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception 'POS preview requires 1 to 500 rows';
  end if;
  v_payload_hash := encode(extensions.digest(convert_to(p_rows::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'pos-preview:' || p_idempotency_key::text, 0
  ));
  select * into v_existing from public.pos_imports
  where preview_idempotency_key = p_idempotency_key;
  if found then
    if v_existing.branch_id <> p_branch_id or v_existing.payload_hash <> v_payload_hash then
      raise exception 'Preview idempotency key belongs to different import content';
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'reference', v_existing.reference,
      'status', v_existing.status,
      'rowCount', v_existing.row_count,
      'validCount', v_existing.valid_count,
      'errorCount', v_existing.error_count,
      'replayed', true
    );
  end if;

  -- Validate the structural contract before writing even staging rows.
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    begin
      v_row_number := (v_row->>'rowNumber')::integer;
      v_external_reference := btrim(v_row->>'externalReference');
      v_external_line_id := btrim(v_row->>'externalLineId');
      v_occurred_at := (v_row->>'occurredAt')::timestamptz;
      v_movement_type := (v_row->>'movementType')::public.pos_movement_type;
      v_entity_type := (v_row->>'entityType')::public.loyverse_entity_type;
      v_external_id := btrim(v_row->>'externalId');
      v_quantity := (v_row->>'quantity')::numeric;
    exception when others then
      raise exception 'POS row has invalid required fields';
    end;
    if v_row_number < 2
       or length(v_external_reference) not between 1 and 160
       or length(v_external_line_id) not between 1 and 160
       or length(v_external_id) not between 1 and 200 then
      raise exception 'POS row identifiers are missing or too long';
    end if;
    if v_occurred_at > now() + interval '5 minutes'
       or v_occurred_at < now() - interval '366 days' then
      raise exception 'POS occurrence time is outside the allowed range';
    end if;
    if v_quantity <= 0 or v_quantity > 9999999999 or v_quantity <> round(v_quantity, 4) then
      raise exception 'POS quantity must be positive with at most four decimals';
    end if;
  end loop;
  if exists (
    select 1
    from jsonb_array_elements(p_rows) row_value
    group by row_value.value->>'rowNumber'
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(p_rows) row_value
    group by row_value.value->>'externalLineId', row_value.value->>'movementType'
    having count(*) > 1
  ) then
    raise exception 'POS row numbers and external line/type pairs must be unique';
  end if;

  -- Resolve the preview twice: first for frozen counts, then for immutable row inserts.
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_entity_type := (v_row->>'entityType')::public.loyverse_entity_type;
    v_external_id := btrim(v_row->>'externalId');
    v_external_line_id := btrim(v_row->>'externalLineId');
    v_movement_type := (v_row->>'movementType')::public.pos_movement_type;
    v_quantity := (v_row->>'quantity')::numeric;
    select * into v_mapping from public.loyverse_mappings
    where entity_type = v_entity_type and external_id = v_external_id and active;
    if exists (
      select 1 from public.pos_import_postings
      where external_line_id = v_external_line_id and movement_type = v_movement_type
    ) then
      v_error_count := v_error_count + 1;
    elsif v_mapping.id is null then
      v_error_count := v_error_count + 1;
    else
      v_inventory_qty := round(v_quantity * v_mapping.inventory_qty, 4);
      if v_inventory_qty <= 0 then
        v_error_count := v_error_count + 1;
      else
        v_valid_count := v_valid_count + 1;
      end if;
    end if;
  end loop;
  v_row_count := jsonb_array_length(p_rows);

  v_reference := public.next_pos_import_reference();
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, after, branch_id, correlation_id
  ) values (
    v_user, 'pos.import.previewed', 'pos_import', v_import_id::text,
    jsonb_build_object(
      'reference', v_reference,
      'filename', btrim(p_filename),
      'row_count', v_row_count,
      'valid_count', v_valid_count,
      'error_count', v_error_count
    ),
    p_branch_id, p_idempotency_key
  ) returning id into v_audit_id;

  insert into public.pos_imports (
    id, reference, branch_id, filename, preview_idempotency_key, payload_hash,
    row_count, valid_count, error_count, previewed_by, preview_audit_log_id
  ) values (
    v_import_id, v_reference, p_branch_id, btrim(p_filename), p_idempotency_key,
    v_payload_hash, v_row_count, v_valid_count, v_error_count, v_user, v_audit_id
  );

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_row_number := (v_row->>'rowNumber')::integer;
    v_external_reference := btrim(v_row->>'externalReference');
    v_external_line_id := btrim(v_row->>'externalLineId');
    v_occurred_at := (v_row->>'occurredAt')::timestamptz;
    v_movement_type := (v_row->>'movementType')::public.pos_movement_type;
    v_entity_type := (v_row->>'entityType')::public.loyverse_entity_type;
    v_external_id := btrim(v_row->>'externalId');
    v_quantity := (v_row->>'quantity')::numeric;
    v_mapping := null;
    select * into v_mapping from public.loyverse_mappings
    where entity_type = v_entity_type and external_id = v_external_id and active;

    if exists (
      select 1 from public.pos_import_postings
      where external_line_id = v_external_line_id and movement_type = v_movement_type
    ) then
      v_validation_status := 'duplicate';
      v_validation_error := 'External line was already confirmed';
      v_inventory_qty := null;
    elsif v_mapping.id is null then
      v_validation_status := 'unmapped';
      v_validation_error := 'No active Loyverse mapping exists';
      v_inventory_qty := null;
    else
      v_inventory_qty := round(v_quantity * v_mapping.inventory_qty, 4);
      if v_inventory_qty <= 0 then
        v_validation_status := 'invalid';
        v_validation_error := 'Mapped inventory quantity rounds to zero';
        v_inventory_qty := null;
      else
        v_validation_status := 'valid';
        v_validation_error := null;
      end if;
    end if;

    insert into public.pos_import_rows (
      import_id, row_number, external_reference, external_line_id, occurred_at,
      movement_type, entity_type, external_id, quantity, mapping_id,
      inventory_item_id, inventory_qty, validation_status, validation_error
    ) values (
      v_import_id, v_row_number, v_external_reference, v_external_line_id,
      v_occurred_at, v_movement_type, v_entity_type, v_external_id, v_quantity,
      v_mapping.id, v_mapping.inventory_item_id, v_inventory_qty,
      v_validation_status, v_validation_error
    );
  end loop;

  return jsonb_build_object(
    'id', v_import_id,
    'reference', v_reference,
    'status', 'preview',
    'rowCount', v_row_count,
    'validCount', v_valid_count,
    'errorCount', v_error_count,
    'replayed', false
  );
end;
$$;
revoke all on function public.preview_pos_import(uuid, text, uuid, jsonb) from public;
grant execute on function public.preview_pos_import(uuid, text, uuid, jsonb)
  to authenticated, service_role;

create or replace function public.confirm_pos_import(
  p_import_id uuid,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_import public.pos_imports%rowtype;
  v_row record;
  v_item public.inventory_items%rowtype;
  v_mapping public.loyverse_mappings%rowtype;
  v_lot record;
  v_txn_id uuid;
  v_lot_id uuid;
  v_audit_id uuid;
  v_remaining numeric(14,4);
  v_take numeric(14,4);
  v_new_balance numeric(14,4);
  v_cost numeric(14,4);
  v_signed_qty numeric(14,4);
  v_txn_key text;
  v_references jsonb;
begin
  if v_user is null or not public.has_permission(v_user, 'pos.import') then
    raise exception 'Permission denied: pos.import required';
  end if;
  if p_idempotency_key is null then raise exception 'Confirm idempotency key is required'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Confirmation reason is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'pos-confirm:' || p_idempotency_key::text, 0
  ));
  select * into v_import from public.pos_imports
  where confirm_idempotency_key = p_idempotency_key;
  if found then
    if v_import.id <> p_import_id then
      raise exception 'Confirm idempotency key belongs to another import';
    end if;
    select coalesce(jsonb_agg(st.reference order by pir.row_number), '[]'::jsonb)
      into v_references
    from public.pos_import_postings pip
    join public.pos_import_rows pir on pir.id = pip.import_row_id
    join public.stock_transactions st on st.id = pip.stock_txn_id
    where pip.import_id = v_import.id;
    return jsonb_build_object(
      'reference', v_import.reference,
      'status', v_import.status,
      'transactionReferences', v_references,
      'replayed', true
    );
  end if;

  select * into v_import from public.pos_imports where id = p_import_id for update;
  if not found then raise exception 'POS import preview not found'; end if;
  if not public.has_branch_access(v_user, v_import.branch_id) then
    raise exception 'Permission denied for branch';
  end if;
  if v_import.status <> 'preview' then
    raise exception 'POS import is already confirmed with another key';
  end if;
  if v_import.error_count <> 0 or v_import.valid_count <> v_import.row_count then
    raise exception 'Every POS preview row must be valid before confirmation';
  end if;
  if (select count(*) from public.pos_import_rows where import_id = v_import.id)
     <> v_import.row_count then
    raise exception 'POS preview row count changed';
  end if;

  -- Lock all mapped items and balances deterministically before posting any row.
  perform 1 from public.inventory_items ii
  where ii.id in (
    select distinct inventory_item_id from public.pos_import_rows
    where import_id = v_import.id
  )
  order by ii.id for update;
  perform 1 from public.inventory_balances ib
  where ib.branch_id = v_import.branch_id
    and ib.item_id in (
      select distinct inventory_item_id from public.pos_import_rows
      where import_id = v_import.id
    )
  order by ib.item_id for update;

  for v_row in
    select * from public.pos_import_rows
    where import_id = v_import.id order by row_number
  loop
    select * into v_mapping from public.loyverse_mappings
    where id = v_row.mapping_id for update;
    if not found or not v_mapping.active
       or v_mapping.inventory_item_id <> v_row.inventory_item_id
       or round(v_mapping.inventory_qty * v_row.quantity, 4) <> v_row.inventory_qty then
      raise exception 'A Loyverse mapping changed; generate a new preview';
    end if;
    if exists (
      select 1 from public.pos_import_postings
      where external_line_id = v_row.external_line_id
        and movement_type = v_row.movement_type
    ) then
      raise exception 'External POS line was already confirmed';
    end if;
    select * into v_item from public.inventory_items
    where id = v_row.inventory_item_id and active and trackable and deleted_at is null;
    if not found then raise exception 'Mapped inventory item is inactive or unavailable'; end if;

    v_txn_key := 'pos:' || v_import.id::text || ':' || v_row.id::text;
    v_signed_qty := case when v_row.movement_type = 'sale'
      then -v_row.inventory_qty else v_row.inventory_qty end;
    insert into public.stock_transactions (
      reference, type, status, source_branch_id, dest_branch_id, reason, notes,
      created_by, approved_by, confirmed_at, idempotency_key, correlation_id
    ) values (
      public.next_stock_txn_reference(),
      case when v_row.movement_type = 'sale'
        then 'pos_sale'::public.stock_txn_type else 'pos_refund'::public.stock_txn_type end,
      'posted',
      case when v_row.movement_type = 'sale' then v_import.branch_id else null end,
      case when v_row.movement_type = 'refund' then v_import.branch_id else null end,
      'Loyverse ' || initcap(v_row.movement_type::text) || ' ' || v_row.external_reference,
      btrim(p_reason) || ' · occurred ' || v_row.occurred_at::text,
      v_user, v_user, now(), v_txn_key, v_import.id
    ) returning id into v_txn_id;

    if v_row.movement_type = 'sale' then
      v_remaining := v_row.inventory_qty;
      for v_lot in
        select id, qty_remaining, unit_cost
        from public.inventory_lots
        where item_id = v_item.id and branch_id = v_import.branch_id
          and qty_remaining > 0
        order by case status when 'available' then 0 when 'expired' then 1 else 2 end,
          expiration_date asc nulls last, received_date asc, created_at asc, id asc
        for update
      loop
        exit when v_remaining <= 0;
        v_take := least(v_remaining, v_lot.qty_remaining);
        update public.inventory_lots set qty_remaining = qty_remaining - v_take
        where id = v_lot.id;
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
          v_txn_id, v_item.id, -v_remaining, v_item.base_unit_id, null,
          v_item.weighted_avg_cost
        );
      end if;
    else
      v_cost := v_item.weighted_avg_cost;
      insert into public.inventory_lots (
        item_id, branch_id, lot_number, received_date, expiration_date,
        qty_remaining, unit_cost, status
      ) values (
        v_item.id, v_import.branch_id,
        left('POS-REFUND-' || v_row.external_line_id, 160),
        (v_row.occurred_at at time zone 'Asia/Manila')::date,
        null, v_row.inventory_qty, v_cost, 'available'
      ) returning id into v_lot_id;
      insert into public.stock_transaction_lines (
        txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot
      ) values (
        v_txn_id, v_item.id, v_row.inventory_qty, v_item.base_unit_id,
        v_lot_id, v_cost
      );
    end if;

    insert into public.inventory_balances (item_id, branch_id, qty_on_hand, updated_at)
    values (v_item.id, v_import.branch_id, v_signed_qty, now())
    on conflict (item_id, branch_id) do update
      set qty_on_hand = public.inventory_balances.qty_on_hand + excluded.qty_on_hand,
          updated_at = now()
    returning qty_on_hand into v_new_balance;

    if v_new_balance < 0 then
      insert into public.inventory_alerts (
        item_id, branch_id, severity, status, qty_on_hand, cause_txn_id, reason, created_by
      ) values (
        v_item.id, v_import.branch_id, 'critical', 'active', v_new_balance,
        v_txn_id, btrim(p_reason), v_user
      );
    end if;

    insert into public.pos_import_postings (
      import_id, import_row_id, external_line_id, movement_type,
      stock_txn_id, idempotency_key
    ) values (
      v_import.id, v_row.id, v_row.external_line_id, v_row.movement_type,
      v_txn_id, v_txn_key
    );
  end loop;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before, after, reason, branch_id,
    correlation_id
  ) values (
    v_user, 'pos.import.confirmed', 'pos_import', v_import.id::text,
    jsonb_build_object('status', v_import.status, 'reference', v_import.reference),
    jsonb_build_object(
      'status', 'confirmed',
      'reference', v_import.reference,
      'row_count', v_import.row_count
    ),
    btrim(p_reason), v_import.branch_id, p_idempotency_key
  ) returning id into v_audit_id;

  update public.pos_imports set
    status = 'confirmed',
    confirm_idempotency_key = p_idempotency_key,
    confirm_reason = btrim(p_reason),
    confirmed_by = v_user,
    confirmed_at = now(),
    confirm_audit_log_id = v_audit_id
  where id = v_import.id;

  select coalesce(jsonb_agg(st.reference order by pir.row_number), '[]'::jsonb)
    into v_references
  from public.pos_import_postings pip
  join public.pos_import_rows pir on pir.id = pip.import_row_id
  join public.stock_transactions st on st.id = pip.stock_txn_id
  where pip.import_id = v_import.id;
  return jsonb_build_object(
    'reference', v_import.reference,
    'status', 'confirmed',
    'transactionReferences', v_references,
    'replayed', false
  );
end;
$$;
revoke all on function public.confirm_pos_import(uuid, text, uuid) from public;
grant execute on function public.confirm_pos_import(uuid, text, uuid)
  to authenticated, service_role;
