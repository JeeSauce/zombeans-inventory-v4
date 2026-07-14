-- 0036_phase11_hardening.sql
-- Phase 11 permission, query, and index hardening only. No new business workflow or entity.

-- Supabase/Postgres grants EXECUTE on new functions to PUBLIC by default. Remove that ambient
-- browser-callable surface for every existing and future function in public; the explicit grants
-- from migrations 0001-0035 remain authoritative.
revoke execute on all functions in schema public from public, anon;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

-- Identity helpers are browser-callable because RLS and the app need them, but a caller may only
-- ask about their own JWT identity. This closes the older arbitrary-user role/permission probe.
create or replace function public.has_permission(uid uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null
    and uid = auth.uid()
    and exists (
      select 1
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.permissions pm on pm.id = rp.permission_id
      where ur.profile_id = uid and pm.slug = perm
    );
$$;
revoke all on function public.has_permission(uuid, text) from public, anon;
grant execute on function public.has_permission(uuid, text) to authenticated, service_role;

create or replace function public.is_super_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null
    and uid = auth.uid()
    and exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.profile_id = uid and r.key = 'super_admin'
    );
$$;
revoke all on function public.is_super_admin(uuid) from public, anon;
grant execute on function public.is_super_admin(uuid) to authenticated, service_role;

-- The four reference generators called directly by Server Actions now validate the actor before
-- consuming a sequence value. All other generators are internal to already-authorized definer
-- commands and are no longer executable by authenticated clients.
create or replace function public.next_item_sku()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not public.has_permission(auth.uid(), 'catalog.item.write') then
    raise exception 'Permission denied: catalog.item.write required';
  end if;
  return 'ITM-' || lpad(nextval('public.item_sku_seq')::text, 6, '0');
end;
$$;

create or replace function public.next_po_reference()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not public.has_permission(auth.uid(), 'purchase.create') then
    raise exception 'Permission denied: purchase.create required';
  end if;
  return 'PO-' || to_char(now(), 'YYYY') || '-'
    || lpad(nextval('public.po_ref_seq')::text, 6, '0');
end;
$$;

create or replace function public.next_receipt_reference()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not public.has_permission(auth.uid(), 'purchase.receive') then
    raise exception 'Permission denied: purchase.receive required';
  end if;
  return 'RCV-' || to_char(now(), 'YYYY') || '-'
    || lpad(nextval('public.receipt_ref_seq')::text, 6, '0');
end;
$$;

create or replace function public.next_return_reference()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not public.has_permission(auth.uid(), 'purchase.receive') then
    raise exception 'Permission denied: purchase.receive required';
  end if;
  return 'RET-' || to_char(now(), 'YYYY') || '-'
    || lpad(nextval('public.return_ref_seq')::text, 6, '0');
end;
$$;

revoke all on function public.next_item_sku() from public, anon;
revoke all on function public.next_po_reference() from public, anon;
revoke all on function public.next_receipt_reference() from public, anon;
revoke all on function public.next_return_reference() from public, anon;
grant execute on function public.next_item_sku() to authenticated, service_role;
grant execute on function public.next_po_reference() to authenticated, service_role;
grant execute on function public.next_receipt_reference() to authenticated, service_role;
grant execute on function public.next_return_reference() to authenticated, service_role;

revoke execute on function public.next_variant_sku() from authenticated;
revoke execute on function public.next_stock_txn_reference() from authenticated;
revoke execute on function public.next_production_reference() from authenticated;
revoke execute on function public.next_stock_request_reference() from authenticated;
revoke execute on function public.next_transfer_reference() from authenticated;
revoke execute on function public.next_recount_reference() from authenticated;
revoke execute on function public.next_recount_adjustment_reference() from authenticated;
revoke execute on function public.next_day_close_reference() from authenticated;
revoke execute on function public.next_day_close_event_reference() from authenticated;
revoke execute on function public.next_notification_reference() from authenticated;
revoke execute on function public.next_calendar_event_reference() from authenticated;
revoke execute on function public.next_popup_event_reference() from authenticated;
revoke execute on function public.next_offline_submission_reference() from authenticated;
revoke execute on function public.next_pos_import_reference() from authenticated;

-- Collapse the costing dashboard's one-RPC-per-active-recipe fan-out into one protected call.
-- Individual recipe failures remain isolated so one malformed legacy recipe cannot hide every
-- other costing row from the authorized Super Admin.
create or replace function public.calculate_recipe_cost_batch(p_recipe_version_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_version_id uuid;
  v_recipe_id uuid;
  v_cost jsonb;
  v_rows jsonb := '[]'::jsonb;
begin
  if v_user is null then
    raise exception 'Authentication required';
  end if;
  if not public.has_permission(v_user, 'cost.read') then
    raise exception 'Permission denied: cost.read required';
  end if;
  if p_recipe_version_ids is null
     or cardinality(p_recipe_version_ids) = 0
     or cardinality(p_recipe_version_ids) > 500 then
    raise exception 'Recipe version list must contain between 1 and 500 entries';
  end if;

  foreach v_version_id in array p_recipe_version_ids
  loop
    begin
      select rv.recipe_id into v_recipe_id
      from public.recipe_versions rv
      where rv.id = v_version_id;
      if v_recipe_id is null then
        raise exception 'Recipe version not found';
      end if;
      v_cost := public._calculate_recipe_cost_internal(
        v_version_id, array[]::uuid[], 0, v_recipe_id, v_version_id
      );
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'recipe_version_id', v_version_id,
        'cost', v_cost,
        'error', null
      ));
    exception when others then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'recipe_version_id', v_version_id,
        'cost', null,
        'error', sqlerrm
      ));
    end;
  end loop;

  return v_rows;
end;
$$;
revoke all on function public.calculate_recipe_cost_batch(uuid[]) from public, anon;
grant execute on function public.calculate_recipe_cost_batch(uuid[]) to authenticated, service_role;

-- Dashboard/report hot paths. These reverse or extend existing primary/index order to match the
-- branch-first and time-first filters used by operational pages and protected report RPCs.
create index inventory_balances_branch_item_idx
  on public.inventory_balances(branch_id, item_id)
  include (qty_on_hand, updated_at);

create index stock_transaction_lines_item_txn_idx
  on public.stock_transaction_lines(item_id, txn_id)
  include (qty, unit_id, created_at);

create index stock_transactions_posted_created_idx
  on public.stock_transactions(created_at desc, id)
  include (source_branch_id, dest_branch_id, type, confirmed_at)
  where status = 'posted';

create index stock_transactions_posted_business_date_idx
  on public.stock_transactions(
    ((coalesce(confirmed_at, created_at) at time zone 'Asia/Manila')::date),
    id
  )
  include (source_branch_id, dest_branch_id, type)
  where status = 'posted';

create index production_orders_completed_confirmed_idx
  on public.production_orders(confirmed_at desc, branch_id)
  include (output_item_id, actual_output_qty)
  where status = 'completed' and confirmed_at is not null;

create index recount_sessions_report_date_idx
  on public.recount_sessions(business_date desc, branch_id)
  include (status, type, is_unusual, submitted_at)
  where status in ('submitted', 'adjusted', 'closed');
