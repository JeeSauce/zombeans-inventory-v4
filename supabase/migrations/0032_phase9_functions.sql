-- 0032_phase9_functions.sql
-- Branch-scoped reports, cost-gated financial reports, recycle-bin lifecycle commands, purge, and
-- backup metadata functions. Every mutation is audited and replay-safe.

create or replace function public.phase9_validate_report_filters(
  p_start_date date,
  p_end_date date,
  p_branch_id uuid
) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_start_date is null or p_end_date is null then
    raise exception 'A report start and end date are required';
  end if;
  if p_start_date > p_end_date then
    raise exception 'Report start date must be on or before end date';
  end if;
  if p_end_date - p_start_date > 366 then
    raise exception 'Report date range cannot exceed 366 days';
  end if;
  if p_branch_id is not null and not public.has_branch_access(auth.uid(), p_branch_id) then
    raise exception 'Permission denied: branch access required';
  end if;
end;
$$;
revoke all on function public.phase9_validate_report_filters(date, date, uuid) from public;

create or replace function public.get_operational_report(
  p_report_type text,
  p_start_date date,
  p_end_date date,
  p_branch_id uuid default null,
  p_category_id uuid default null,
  p_item_type public.item_type default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_title text;
  v_columns jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
  v_note text;
begin
  perform public.phase9_validate_report_filters(p_start_date, p_end_date, p_branch_id);
  if not public.has_permission(auth.uid(), 'catalog.item.read') then
    raise exception 'Permission denied: catalog.item.read required';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories where id = p_category_id and deleted_at is null
  ) then
    raise exception 'Unknown report category';
  end if;

  case p_report_type
    when 'inventory-balances' then
      v_title := 'Inventory balances';
      v_note := 'Current snapshot; the date range is retained for consistent report navigation.';
      v_columns := '[
        {"key":"branch","label":"Branch","type":"text"},
        {"key":"sku","label":"SKU","type":"text"},
        {"key":"item","label":"Item","type":"text"},
        {"key":"itemType","label":"Item type","type":"text"},
        {"key":"category","label":"Category","type":"text"},
        {"key":"quantity","label":"Quantity","type":"quantity"},
        {"key":"unit","label":"Unit","type":"text"},
        {"key":"updatedAt","label":"Updated","type":"datetime"}
      ]'::jsonb;

      select coalesce(jsonb_agg(to_jsonb(q) order by q."branch", q."sku"), '[]'::jsonb)
      into v_rows
      from (
        select b.name as "branch", ii.sku as "sku", ii.name as "item",
          ii.item_type::text as "itemType", coalesce(c.name, 'Uncategorized') as "category",
          ib.qty_on_hand as "quantity", u.code as "unit", ib.updated_at as "updatedAt"
        from public.inventory_balances ib
        join public.branches b on b.id = ib.branch_id
        join public.inventory_items ii on ii.id = ib.item_id
        join public.units u on u.id = ii.base_unit_id
        left join public.categories c on c.id = ii.category_id
        where ii.deleted_at is null and b.deleted_at is null
          and public.has_branch_access(auth.uid(), ib.branch_id)
          and (p_branch_id is null or ib.branch_id = p_branch_id)
          and (p_category_id is null or ii.category_id = p_category_id)
          and (p_item_type is null or ii.item_type = p_item_type)
        order by b.name, ii.sku
        limit 1000
      ) q;

      select jsonb_build_object(
        'rowCount', count(*),
        'negativeCount', count(*) filter (where ib.qty_on_hand < 0),
        'zeroCount', count(*) filter (where ib.qty_on_hand = 0)
      ) into v_summary
      from public.inventory_balances ib
      join public.branches b on b.id = ib.branch_id
      join public.inventory_items ii on ii.id = ib.item_id
      where ii.deleted_at is null and b.deleted_at is null
        and public.has_branch_access(auth.uid(), ib.branch_id)
        and (p_branch_id is null or ib.branch_id = p_branch_id)
        and (p_category_id is null or ii.category_id = p_category_id)
        and (p_item_type is null or ii.item_type = p_item_type);

    when 'stock-movements' then
      v_title := 'Stock movements';
      v_columns := '[
        {"key":"date","label":"Date","type":"datetime"},
        {"key":"reference","label":"Reference","type":"text"},
        {"key":"movementType","label":"Movement","type":"text"},
        {"key":"branchRoute","label":"Branch / route","type":"text"},
        {"key":"sku","label":"SKU","type":"text"},
        {"key":"item","label":"Item","type":"text"},
        {"key":"quantity","label":"Quantity","type":"quantity"},
        {"key":"unit","label":"Unit","type":"text"},
        {"key":"reason","label":"Reason","type":"text"}
      ]'::jsonb;

      select coalesce(jsonb_agg(to_jsonb(q) order by q."date" desc, q."reference"), '[]'::jsonb)
      into v_rows
      from (
        select coalesce(st.confirmed_at, st.created_at) as "date", st.reference as "reference",
          st.type::text as "movementType",
          coalesce(nullif(concat_ws(' → ', sb.name, db.name), ''), 'System') as "branchRoute",
          ii.sku as "sku", ii.name as "item", stl.qty as "quantity", u.code as "unit",
          coalesce(st.reason, '—') as "reason"
        from public.stock_transactions st
        join public.stock_transaction_lines stl on stl.txn_id = st.id
        join public.inventory_items ii on ii.id = stl.item_id
        join public.units u on u.id = stl.unit_id
        left join public.branches sb on sb.id = st.source_branch_id
        left join public.branches db on db.id = st.dest_branch_id
        where st.status = 'posted' and ii.deleted_at is null
          and ((coalesce(st.confirmed_at, st.created_at) at time zone 'Asia/Manila')::date
            between p_start_date and p_end_date)
          and (st.source_branch_id is null
            or public.has_branch_access(auth.uid(), st.source_branch_id))
          and (st.dest_branch_id is null
            or public.has_branch_access(auth.uid(), st.dest_branch_id))
          and (p_branch_id is null
            or st.source_branch_id = p_branch_id or st.dest_branch_id = p_branch_id)
          and (p_category_id is null or ii.category_id = p_category_id)
          and (p_item_type is null or ii.item_type = p_item_type)
        order by coalesce(st.confirmed_at, st.created_at) desc, st.reference
        limit 1000
      ) q;

      select jsonb_build_object(
        'rowCount', count(*),
        'movementCount', count(distinct st.id)
      ) into v_summary
      from public.stock_transactions st
      join public.stock_transaction_lines stl on stl.txn_id = st.id
      join public.inventory_items ii on ii.id = stl.item_id
      where st.status = 'posted' and ii.deleted_at is null
        and ((coalesce(st.confirmed_at, st.created_at) at time zone 'Asia/Manila')::date
          between p_start_date and p_end_date)
        and (st.source_branch_id is null or public.has_branch_access(auth.uid(), st.source_branch_id))
        and (st.dest_branch_id is null or public.has_branch_access(auth.uid(), st.dest_branch_id))
        and (p_branch_id is null
          or st.source_branch_id = p_branch_id or st.dest_branch_id = p_branch_id)
        and (p_category_id is null or ii.category_id = p_category_id)
        and (p_item_type is null or ii.item_type = p_item_type);

    when 'production-output' then
      v_title := 'Production output';
      v_columns := '[
        {"key":"date","label":"Date","type":"datetime"},
        {"key":"reference","label":"Reference","type":"text"},
        {"key":"branch","label":"Branch","type":"text"},
        {"key":"sku","label":"SKU","type":"text"},
        {"key":"item","label":"Output item","type":"text"},
        {"key":"quantity","label":"Actual output","type":"quantity"},
        {"key":"unit","label":"Unit","type":"text"},
        {"key":"lot","label":"Lot","type":"text"}
      ]'::jsonb;

      select coalesce(jsonb_agg(to_jsonb(q) order by q."date" desc, q."reference"), '[]'::jsonb)
      into v_rows
      from (
        select po.confirmed_at as "date", po.reference as "reference", b.name as "branch",
          ii.sku as "sku", ii.name as "item", po.actual_output_qty as "quantity",
          u.code as "unit", coalesce(po.output_lot_number, '—') as "lot"
        from public.production_orders po
        join public.branches b on b.id = po.branch_id
        join public.inventory_items ii on ii.id = po.output_item_id
        join public.units u on u.id = po.output_unit_id
        where po.status = 'completed' and po.confirmed_at is not null and ii.deleted_at is null
          and ((po.confirmed_at at time zone 'Asia/Manila')::date between p_start_date and p_end_date)
          and public.has_branch_access(auth.uid(), po.branch_id)
          and (p_branch_id is null or po.branch_id = p_branch_id)
          and (p_category_id is null or ii.category_id = p_category_id)
          and (p_item_type is null or ii.item_type = p_item_type)
        order by po.confirmed_at desc, po.reference
        limit 1000
      ) q;

      select jsonb_build_object('rowCount', count(*), 'orderCount', count(distinct po.id))
      into v_summary
      from public.production_orders po
      join public.inventory_items ii on ii.id = po.output_item_id
      where po.status = 'completed' and po.confirmed_at is not null and ii.deleted_at is null
        and ((po.confirmed_at at time zone 'Asia/Manila')::date between p_start_date and p_end_date)
        and public.has_branch_access(auth.uid(), po.branch_id)
        and (p_branch_id is null or po.branch_id = p_branch_id)
        and (p_category_id is null or ii.category_id = p_category_id)
        and (p_item_type is null or ii.item_type = p_item_type);

    when 'recount-variances' then
      v_title := 'Recount variances';
      v_columns := '[
        {"key":"businessDate","label":"Business date","type":"date"},
        {"key":"reference","label":"Reference","type":"text"},
        {"key":"branch","label":"Branch","type":"text"},
        {"key":"sessionType","label":"Recount type","type":"text"},
        {"key":"sku","label":"SKU","type":"text"},
        {"key":"item","label":"Item","type":"text"},
        {"key":"expected","label":"Expected","type":"quantity"},
        {"key":"physical","label":"Physical","type":"quantity"},
        {"key":"variance","label":"Variance","type":"quantity"},
        {"key":"unit","label":"Unit","type":"text"},
        {"key":"unusual","label":"Unusual","type":"boolean"}
      ]'::jsonb;

      select coalesce(jsonb_agg(to_jsonb(q) order by q."businessDate" desc, q."reference"), '[]'::jsonb)
      into v_rows
      from (
        select rs.business_date as "businessDate", rs.reference as "reference", b.name as "branch",
          rs.type::text as "sessionType", ii.sku as "sku", ii.name as "item",
          rl.expected_qty as "expected", rl.physical_qty as "physical",
          rl.variance_qty as "variance", u.code as "unit", rs.is_unusual as "unusual"
        from public.recount_sessions rs
        join public.recount_lines rl on rl.session_id = rs.id
        join public.branches b on b.id = rs.branch_id
        join public.inventory_items ii on ii.id = rl.item_id
        join public.units u on u.id = rl.unit_id
        where rs.status in ('submitted', 'adjusted', 'closed') and rl.physical_qty is not null
          and ii.deleted_at is null and rs.business_date between p_start_date and p_end_date
          and public.has_branch_access(auth.uid(), rs.branch_id)
          and (p_branch_id is null or rs.branch_id = p_branch_id)
          and (p_category_id is null or ii.category_id = p_category_id)
          and (p_item_type is null or ii.item_type = p_item_type)
        order by rs.business_date desc, rs.reference, ii.sku
        limit 1000
      ) q;

      select jsonb_build_object(
        'rowCount', count(*),
        'sessionCount', count(distinct rs.id),
        'unusualCount', count(*) filter (where rs.is_unusual)
      ) into v_summary
      from public.recount_sessions rs
      join public.recount_lines rl on rl.session_id = rs.id
      join public.inventory_items ii on ii.id = rl.item_id
      where rs.status in ('submitted', 'adjusted', 'closed') and rl.physical_qty is not null
        and ii.deleted_at is null and rs.business_date between p_start_date and p_end_date
        and public.has_branch_access(auth.uid(), rs.branch_id)
        and (p_branch_id is null or rs.branch_id = p_branch_id)
        and (p_category_id is null or ii.category_id = p_category_id)
        and (p_item_type is null or ii.item_type = p_item_type);

    else
      raise exception 'Unknown operational report type';
  end case;

  return jsonb_build_object(
    'reportType', p_report_type,
    'title', v_title,
    'reportClass', 'operational',
    'generatedAt', now(),
    'filters', jsonb_build_object(
      'startDate', p_start_date,
      'endDate', p_end_date,
      'branchId', p_branch_id,
      'categoryId', p_category_id,
      'itemType', p_item_type
    ),
    'columns', v_columns,
    'rows', v_rows,
    'summary', v_summary,
    'note', v_note
  );
end;
$$;
revoke all on function public.get_operational_report(
  text, date, date, uuid, uuid, public.item_type
) from public;
grant execute on function public.get_operational_report(
  text, date, date, uuid, uuid, public.item_type
) to authenticated, service_role;

create or replace function public.get_financial_report(
  p_report_type text,
  p_start_date date,
  p_end_date date,
  p_branch_id uuid default null,
  p_category_id uuid default null,
  p_item_type public.item_type default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_title text;
  v_columns jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_summary jsonb := '{}'::jsonb;
  v_note text;
begin
  perform public.phase9_validate_report_filters(p_start_date, p_end_date, p_branch_id);
  if not public.has_permission(auth.uid(), 'cost.read') then
    raise exception 'Permission denied: cost.read required';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories where id = p_category_id and deleted_at is null
  ) then
    raise exception 'Unknown report category';
  end if;

  case p_report_type
    when 'inventory-valuation' then
      v_title := 'Inventory valuation';
      v_note := 'Current valuation uses current weighted-average cost.';
      v_columns := '[
        {"key":"branch","label":"Branch","type":"text"},
        {"key":"sku","label":"SKU","type":"text"},
        {"key":"item","label":"Item","type":"text"},
        {"key":"quantity","label":"Quantity","type":"quantity"},
        {"key":"unit","label":"Unit","type":"text"},
        {"key":"unitCost","label":"Unit cost","type":"money"},
        {"key":"totalValue","label":"Total value","type":"money"}
      ]'::jsonb;

      select coalesce(jsonb_agg(to_jsonb(q) order by q."branch", q."sku"), '[]'::jsonb)
      into v_rows
      from (
        select b.name as "branch", ii.sku as "sku", ii.name as "item",
          ib.qty_on_hand as "quantity", u.code as "unit",
          ii.weighted_avg_cost as "unitCost",
          round(ib.qty_on_hand * ii.weighted_avg_cost, 4) as "totalValue"
        from public.inventory_balances ib
        join public.branches b on b.id = ib.branch_id
        join public.inventory_items ii on ii.id = ib.item_id
        join public.units u on u.id = ii.base_unit_id
        where ii.deleted_at is null and b.deleted_at is null
          and public.has_branch_access(auth.uid(), ib.branch_id)
          and (p_branch_id is null or ib.branch_id = p_branch_id)
          and (p_category_id is null or ii.category_id = p_category_id)
          and (p_item_type is null or ii.item_type = p_item_type)
        order by b.name, ii.sku
        limit 1000
      ) q;

      select jsonb_build_object(
        'rowCount', count(*),
        'totalValue', coalesce(round(sum(ib.qty_on_hand * ii.weighted_avg_cost), 4), 0)
      ) into v_summary
      from public.inventory_balances ib
      join public.branches b on b.id = ib.branch_id
      join public.inventory_items ii on ii.id = ib.item_id
      where ii.deleted_at is null and b.deleted_at is null
        and public.has_branch_access(auth.uid(), ib.branch_id)
        and (p_branch_id is null or ib.branch_id = p_branch_id)
        and (p_category_id is null or ii.category_id = p_category_id)
        and (p_item_type is null or ii.item_type = p_item_type);

    when 'movement-costs' then
      v_title := 'Frozen movement costs';
      v_note := 'Historical values use the immutable ledger-line unit-cost snapshot.';
      v_columns := '[
        {"key":"date","label":"Date","type":"datetime"},
        {"key":"reference","label":"Reference","type":"text"},
        {"key":"movementType","label":"Movement","type":"text"},
        {"key":"branchRoute","label":"Branch / route","type":"text"},
        {"key":"sku","label":"SKU","type":"text"},
        {"key":"item","label":"Item","type":"text"},
        {"key":"quantity","label":"Quantity","type":"quantity"},
        {"key":"unitCost","label":"Frozen unit cost","type":"money"},
        {"key":"totalValue","label":"Frozen value","type":"money"}
      ]'::jsonb;

      select coalesce(jsonb_agg(to_jsonb(q) order by q."date" desc, q."reference"), '[]'::jsonb)
      into v_rows
      from (
        select coalesce(st.confirmed_at, st.created_at) as "date", st.reference as "reference",
          st.type::text as "movementType",
          coalesce(nullif(concat_ws(' → ', sb.name, db.name), ''), 'System') as "branchRoute",
          ii.sku as "sku", ii.name as "item", stl.qty as "quantity",
          stl.unit_cost_snapshot as "unitCost",
          round(stl.qty * stl.unit_cost_snapshot, 4) as "totalValue"
        from public.stock_transactions st
        join public.stock_transaction_lines stl on stl.txn_id = st.id
        join public.inventory_items ii on ii.id = stl.item_id
        left join public.branches sb on sb.id = st.source_branch_id
        left join public.branches db on db.id = st.dest_branch_id
        where st.status = 'posted' and ii.deleted_at is null
          and ((coalesce(st.confirmed_at, st.created_at) at time zone 'Asia/Manila')::date
            between p_start_date and p_end_date)
          and (st.source_branch_id is null
            or public.has_branch_access(auth.uid(), st.source_branch_id))
          and (st.dest_branch_id is null
            or public.has_branch_access(auth.uid(), st.dest_branch_id))
          and (p_branch_id is null
            or st.source_branch_id = p_branch_id or st.dest_branch_id = p_branch_id)
          and (p_category_id is null or ii.category_id = p_category_id)
          and (p_item_type is null or ii.item_type = p_item_type)
        order by coalesce(st.confirmed_at, st.created_at) desc, st.reference
        limit 1000
      ) q;

      select jsonb_build_object(
        'rowCount', count(*),
        'totalValue', coalesce(round(sum(stl.qty * stl.unit_cost_snapshot), 4), 0)
      ) into v_summary
      from public.stock_transactions st
      join public.stock_transaction_lines stl on stl.txn_id = st.id
      join public.inventory_items ii on ii.id = stl.item_id
      where st.status = 'posted' and ii.deleted_at is null
        and ((coalesce(st.confirmed_at, st.created_at) at time zone 'Asia/Manila')::date
          between p_start_date and p_end_date)
        and (st.source_branch_id is null or public.has_branch_access(auth.uid(), st.source_branch_id))
        and (st.dest_branch_id is null or public.has_branch_access(auth.uid(), st.dest_branch_id))
        and (p_branch_id is null
          or st.source_branch_id = p_branch_id or st.dest_branch_id = p_branch_id)
        and (p_category_id is null or ii.category_id = p_category_id)
        and (p_item_type is null or ii.item_type = p_item_type);

    else
      raise exception 'Unknown financial report type';
  end case;

  return jsonb_build_object(
    'reportType', p_report_type,
    'title', v_title,
    'reportClass', 'financial',
    'generatedAt', now(),
    'filters', jsonb_build_object(
      'startDate', p_start_date,
      'endDate', p_end_date,
      'branchId', p_branch_id,
      'categoryId', p_category_id,
      'itemType', p_item_type
    ),
    'columns', v_columns,
    'rows', v_rows,
    'summary', v_summary,
    'note', v_note
  );
end;
$$;
revoke all on function public.get_financial_report(
  text, date, date, uuid, uuid, public.item_type
) from public;
grant execute on function public.get_financial_report(
  text, date, date, uuid, uuid, public.item_type
) to authenticated, service_role;

create or replace function public.recycle_dependency_reason(
  p_entity_type public.recycle_entity_type,
  p_entity_id uuid
) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_reason text;
begin
  select string_agg(initcap(dependency_type::text) || ' hold: ' || reason, '; '
    order by dependency_type::text, placed_at)
  into v_reason
  from public.retention_holds
  where entity_type = p_entity_type and entity_id = p_entity_id and released_at is null;
  if v_reason is not null then return v_reason; end if;

  case p_entity_type
    when 'category' then
      if exists (select 1 from public.categories where parent_id = p_entity_id)
        or exists (select 1 from public.inventory_items where category_id = p_entity_id) then
        return 'Protected by dependent catalog records';
      end if;
    when 'inventory_item' then
      if exists (select 1 from public.stock_transaction_lines where item_id = p_entity_id)
        or exists (select 1 from public.inventory_lots where item_id = p_entity_id)
        or exists (select 1 from public.inventory_balances where item_id = p_entity_id)
        or exists (select 1 from public.recount_lines where item_id = p_entity_id)
        or exists (select 1 from public.recipe_lines where input_item_id = p_entity_id)
        or exists (select 1 from public.recipes where output_item_id = p_entity_id)
        or exists (select 1 from public.production_orders where output_item_id = p_entity_id)
        or exists (select 1 from public.products where item_id = p_entity_id)
        or exists (select 1 from public.supplier_items where item_id = p_entity_id) then
        return 'Protected by ledger, accounting, or catalog history';
      end if;
    when 'supplier' then
      if exists (select 1 from public.supplier_items where supplier_id = p_entity_id)
        or exists (select 1 from public.purchase_orders where supplier_id = p_entity_id)
        or exists (select 1 from public.supplier_returns where supplier_id = p_entity_id) then
        return 'Protected by accounting history';
      end if;
    when 'purchase_order' then
      if exists (select 1 from public.purchase_order_lines where po_id = p_entity_id)
        or exists (select 1 from public.purchase_receipts where po_id = p_entity_id) then
        return 'Protected by accounting history';
      end if;
    when 'recipe' then
      if exists (select 1 from public.recipe_versions where recipe_id = p_entity_id)
        or exists (select 1 from public.production_templates where recipe_id = p_entity_id) then
        return 'Protected by recipe, cost, or production history';
      end if;
    when 'production_template' then
      if exists (select 1 from public.production_orders where template_id = p_entity_id) then
        return 'Protected by production and ledger history';
      end if;
  end case;
  return null;
end;
$$;
revoke all on function public.recycle_dependency_reason(public.recycle_entity_type, uuid) from public;
grant execute on function public.recycle_dependency_reason(public.recycle_entity_type, uuid)
  to service_role;

create or replace function public.list_recycle_bin()
returns table (
  entity_type public.recycle_entity_type,
  entity_id uuid,
  label text,
  deleted_at timestamptz,
  deleted_by_name text,
  purge_at timestamptz,
  eligible_for_purge boolean,
  dependency_reason text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.has_permission(auth.uid(), 'recyclebin.restore') then
    raise exception 'Permission denied: recyclebin.restore required';
  end if;

  return query
  with deleted as (
    select 'category'::public.recycle_entity_type as entity_type, c.id as entity_id,
      c.name as label, c.deleted_at, c.deleted_by, c.purge_at
    from public.categories c where c.deleted_at is not null
    union all
    select 'inventory_item', i.id, i.sku || ' — ' || i.name,
      i.deleted_at, i.deleted_by, i.purge_at
    from public.inventory_items i where i.deleted_at is not null
    union all
    select 'supplier', s.id, s.name, s.deleted_at, s.deleted_by, s.purge_at
    from public.suppliers s where s.deleted_at is not null
    union all
    select 'purchase_order', po.id, po.reference, po.deleted_at, po.deleted_by, po.purge_at
    from public.purchase_orders po where po.deleted_at is not null
    union all
    select 'recipe', r.id, r.name, r.deleted_at, r.deleted_by, r.purge_at
    from public.recipes r where r.deleted_at is not null
    union all
    select 'production_template', pt.id, pt.name, pt.deleted_at, pt.deleted_by, pt.purge_at
    from public.production_templates pt where pt.deleted_at is not null
  ), evaluated as (
    select d.*, p.full_name,
      public.recycle_dependency_reason(d.entity_type, d.entity_id) as protected_reason
    from deleted d left join public.profiles p on p.id = d.deleted_by
  )
  select e.entity_type, e.entity_id, e.label, e.deleted_at,
    coalesce(e.full_name, 'System') as deleted_by_name, e.purge_at,
    e.purge_at <= now() and e.protected_reason is null as eligible_for_purge,
    coalesce(
      e.protected_reason,
      case when e.purge_at > now() then '30-day retention window active' end
    ) as dependency_reason
  from evaluated e
  order by e.deleted_at desc, e.label;
end;
$$;
revoke all on function public.list_recycle_bin() from public;
grant execute on function public.list_recycle_bin() to authenticated, service_role;

create or replace function public.phase9_entity_permission(
  p_entity_type public.recycle_entity_type
) returns text
language sql immutable set search_path = public as $$
  select case p_entity_type
    when 'category' then 'catalog.item.write'
    when 'inventory_item' then 'catalog.item.write'
    when 'supplier' then 'supplier.write'
    when 'purchase_order' then 'purchase.create'
    when 'recipe' then 'recipe.write'
    when 'production_template' then 'production.create'
  end
$$;
revoke all on function public.phase9_entity_permission(public.recycle_entity_type) from public;
grant execute on function public.phase9_entity_permission(public.recycle_entity_type)
  to service_role;

-- Safe lifecycle snapshot used for audit and replay. Protected cost/price fields are deliberately
-- absent even though audit.read is Super-Admin-only.
create or replace function public.phase9_entity_snapshot(
  p_entity_type public.recycle_entity_type,
  p_entity_id uuid
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  case p_entity_type
    when 'category' then
      select jsonb_build_object(
        'id', id, 'label', name, 'name', name, 'item_type', item_type,
        'parent_id', parent_id, 'active', active, 'version', version,
        'deleted_at', deleted_at, 'deleted_by', deleted_by, 'purge_at', purge_at
      ) into v_result from public.categories where id = p_entity_id;
    when 'inventory_item' then
      select jsonb_build_object(
        'id', id, 'label', sku || ' — ' || name, 'name', name, 'sku', sku,
        'item_type', item_type, 'category_id', category_id, 'base_unit_id', base_unit_id,
        'purchase_unit_id', purchase_unit_id, 'low_stock_threshold', low_stock_threshold,
        'reorder_level', reorder_level, 'trackable', trackable, 'batch_tracked', batch_tracked,
        'expiry_tracked', expiry_tracked, 'is_consumable', is_consumable, 'active', active,
        'version', version, 'deleted_at', deleted_at, 'deleted_by', deleted_by, 'purge_at', purge_at
      ) into v_result from public.inventory_items where id = p_entity_id;
    when 'supplier' then
      select jsonb_build_object(
        'id', id, 'label', name, 'name', name, 'lead_time_days', lead_time_days,
        'payment_terms', payment_terms, 'active', active, 'version', version,
        'deleted_at', deleted_at, 'deleted_by', deleted_by, 'purge_at', purge_at
      ) into v_result from public.suppliers where id = p_entity_id;
    when 'purchase_order' then
      select jsonb_build_object(
        'id', id, 'label', reference, 'reference', reference, 'supplier_id', supplier_id,
        'status', status, 'payment_status', payment_status, 'expected_date', expected_date,
        'notes', notes, 'version', version, 'deleted_at', deleted_at,
        'deleted_by', deleted_by, 'purge_at', purge_at
      ) into v_result from public.purchase_orders where id = p_entity_id;
    when 'recipe' then
      select jsonb_build_object(
        'id', id, 'label', name, 'name', name, 'kind', kind, 'output_item_id', output_item_id,
        'product_id', product_id, 'variant_id', variant_id,
        'modifier_option_id', modifier_option_id, 'active', active, 'version', version,
        'deleted_at', deleted_at, 'deleted_by', deleted_by, 'purge_at', purge_at
      ) into v_result from public.recipes where id = p_entity_id;
    when 'production_template' then
      select jsonb_build_object(
        'id', id, 'label', name, 'name', name, 'recipe_id', recipe_id,
        'default_batch_multiplier', default_batch_multiplier,
        'default_expiry_days', default_expiry_days, 'instructions', instructions,
        'active', active, 'version', version, 'deleted_at', deleted_at,
        'deleted_by', deleted_by, 'purge_at', purge_at
      ) into v_result from public.production_templates where id = p_entity_id;
  end case;
  return v_result;
end;
$$;
revoke all on function public.phase9_entity_snapshot(public.recycle_entity_type, uuid) from public;
grant execute on function public.phase9_entity_snapshot(public.recycle_entity_type, uuid)
  to service_role;

create or replace function public.soft_delete_record(
  p_entity_type public.recycle_entity_type,
  p_entity_id uuid,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_permission text := public.phase9_entity_permission(p_entity_type);
  v_command public.recycle_bin_commands%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_audit_id uuid;
  v_deleted_at timestamptz := now();
  v_purge_at timestamptz := now() + interval '30 days';
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not public.has_permission(v_user, v_permission) then
    raise exception 'Permission denied: % required', v_permission;
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A deletion reason of at least 3 characters is required';
  end if;
  if length(btrim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'A stable idempotency key is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(btrim(p_idempotency_key), 0));
  select * into v_command from public.recycle_bin_commands
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_command.command_type <> 'soft_delete' or v_command.entity_type <> p_entity_type
      or v_command.entity_id <> p_entity_id then
      raise exception 'Idempotency key already belongs to another lifecycle command';
    end if;
    return v_command.result || jsonb_build_object('replayed', true);
  end if;

  case p_entity_type
    when 'category' then
      perform 1 from public.categories where id = p_entity_id for update;
    when 'inventory_item' then
      perform 1 from public.inventory_items where id = p_entity_id for update;
    when 'supplier' then
      perform 1 from public.suppliers where id = p_entity_id for update;
    when 'purchase_order' then
      perform 1 from public.purchase_orders where id = p_entity_id for update;
    when 'recipe' then
      perform 1 from public.recipes where id = p_entity_id for update;
    when 'production_template' then
      perform 1 from public.production_templates where id = p_entity_id for update;
  end case;
  if not found then raise exception 'Business record not found'; end if;

  v_before := public.phase9_entity_snapshot(p_entity_type, p_entity_id);
  if v_before ->> 'deleted_at' is not null then
    raise exception 'Business record is already in the recycle bin';
  end if;
  if p_entity_type = 'purchase_order'
    and (v_before ->> 'status') not in ('draft', 'cancelled') then
    raise exception 'Only draft or cancelled purchase orders can be recycled';
  end if;

  perform set_config('zombeans.lifecycle_command', 'on', true);
  case p_entity_type
    when 'category' then
      update public.categories set deleted_at = v_deleted_at, deleted_by = v_user,
        purge_at = v_purge_at where id = p_entity_id;
    when 'inventory_item' then
      update public.inventory_items set deleted_at = v_deleted_at, deleted_by = v_user,
        purge_at = v_purge_at where id = p_entity_id;
    when 'supplier' then
      update public.suppliers set deleted_at = v_deleted_at, deleted_by = v_user,
        purge_at = v_purge_at where id = p_entity_id;
    when 'purchase_order' then
      update public.purchase_orders set deleted_at = v_deleted_at, deleted_by = v_user,
        purge_at = v_purge_at where id = p_entity_id;
    when 'recipe' then
      update public.recipes set deleted_at = v_deleted_at, deleted_by = v_user,
        purge_at = v_purge_at where id = p_entity_id;
    when 'production_template' then
      update public.production_templates set deleted_at = v_deleted_at, deleted_by = v_user,
        purge_at = v_purge_at where id = p_entity_id;
  end case;
  v_after := public.phase9_entity_snapshot(p_entity_type, p_entity_id);

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before, after, reason
  ) values (
    v_user, 'recycle.soft_deleted', p_entity_type::text, p_entity_id::text,
    v_before, v_after, btrim(p_reason)
  ) returning id into v_audit_id;

  v_result := jsonb_build_object(
    'entityType', p_entity_type,
    'entityId', p_entity_id,
    'label', v_after ->> 'label',
    'deletedAt', v_deleted_at,
    'purgeAt', v_purge_at,
    'replayed', false
  );
  insert into public.recycle_bin_commands (
    entity_type, entity_id, command_type, idempotency_key, actor_id, audit_log_id,
    previous_deleted_at, result
  ) values (
    p_entity_type, p_entity_id, 'soft_delete', btrim(p_idempotency_key), v_user, v_audit_id,
    null, v_result
  );
  return v_result;
end;
$$;
revoke all on function public.soft_delete_record(
  public.recycle_entity_type, uuid, text, text
) from public;
grant execute on function public.soft_delete_record(
  public.recycle_entity_type, uuid, text, text
) to authenticated, service_role;

create or replace function public.restore_recycle_record(
  p_entity_type public.recycle_entity_type,
  p_entity_id uuid,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_command public.recycle_bin_commands%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_audit_id uuid;
  v_previous_deleted_at timestamptz;
  v_purge_at timestamptz;
begin
  if v_user is null or not public.has_permission(v_user, 'recyclebin.restore') then
    raise exception 'Permission denied: recyclebin.restore required';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A restore reason of at least 3 characters is required';
  end if;
  if length(btrim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'A stable idempotency key is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(btrim(p_idempotency_key), 0));
  select * into v_command from public.recycle_bin_commands
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_command.command_type <> 'restore' or v_command.entity_type <> p_entity_type
      or v_command.entity_id <> p_entity_id then
      raise exception 'Idempotency key already belongs to another lifecycle command';
    end if;
    return v_command.result || jsonb_build_object('replayed', true);
  end if;

  case p_entity_type
    when 'category' then
      perform 1 from public.categories where id = p_entity_id for update;
    when 'inventory_item' then
      perform 1 from public.inventory_items where id = p_entity_id for update;
    when 'supplier' then
      perform 1 from public.suppliers where id = p_entity_id for update;
    when 'purchase_order' then
      perform 1 from public.purchase_orders where id = p_entity_id for update;
    when 'recipe' then
      perform 1 from public.recipes where id = p_entity_id for update;
    when 'production_template' then
      perform 1 from public.production_templates where id = p_entity_id for update;
  end case;
  if not found then raise exception 'Business record was already purged and cannot be restored'; end if;

  v_before := public.phase9_entity_snapshot(p_entity_type, p_entity_id);
  v_previous_deleted_at := (v_before ->> 'deleted_at')::timestamptz;
  v_purge_at := (v_before ->> 'purge_at')::timestamptz;
  if v_previous_deleted_at is null then raise exception 'Business record is not deleted'; end if;
  if v_purge_at <= now() then raise exception 'The 30-day restore window has expired'; end if;

  perform set_config('zombeans.lifecycle_command', 'on', true);
  case p_entity_type
    when 'category' then
      update public.categories set deleted_at = null, deleted_by = null, purge_at = null
      where id = p_entity_id;
    when 'inventory_item' then
      update public.inventory_items set deleted_at = null, deleted_by = null, purge_at = null
      where id = p_entity_id;
    when 'supplier' then
      update public.suppliers set deleted_at = null, deleted_by = null, purge_at = null
      where id = p_entity_id;
    when 'purchase_order' then
      update public.purchase_orders set deleted_at = null, deleted_by = null, purge_at = null
      where id = p_entity_id;
    when 'recipe' then
      update public.recipes set deleted_at = null, deleted_by = null, purge_at = null
      where id = p_entity_id;
    when 'production_template' then
      update public.production_templates set deleted_at = null, deleted_by = null, purge_at = null
      where id = p_entity_id;
  end case;
  v_after := public.phase9_entity_snapshot(p_entity_type, p_entity_id);

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before, after, reason
  ) values (
    v_user, 'recycle.restored', p_entity_type::text, p_entity_id::text,
    v_before, v_after, btrim(p_reason)
  ) returning id into v_audit_id;

  v_result := jsonb_build_object(
    'entityType', p_entity_type,
    'entityId', p_entity_id,
    'label', v_after ->> 'label',
    'restoredAt', now(),
    'replayed', false
  );
  insert into public.recycle_bin_commands (
    entity_type, entity_id, command_type, idempotency_key, actor_id, audit_log_id,
    previous_deleted_at, result
  ) values (
    p_entity_type, p_entity_id, 'restore', btrim(p_idempotency_key), v_user, v_audit_id,
    v_previous_deleted_at, v_result
  );
  return v_result;
end;
$$;
revoke all on function public.restore_recycle_record(
  public.recycle_entity_type, uuid, text, text
) from public;
grant execute on function public.restore_recycle_record(
  public.recycle_entity_type, uuid, text, text
) to authenticated, service_role;

create or replace function public.place_retention_hold(
  p_entity_type public.recycle_entity_type,
  p_entity_id uuid,
  p_dependency_type public.retention_dependency_type,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_hold public.retention_holds%rowtype; v_audit_id uuid;
begin
  if v_user is null or not public.has_permission(v_user, 'recyclebin.restore') then
    raise exception 'Permission denied: recyclebin.restore required';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3
    or length(btrim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'A reason and stable idempotency key are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(btrim(p_idempotency_key), 0));
  select * into v_hold from public.retention_holds
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_hold.entity_type <> p_entity_type or v_hold.entity_id <> p_entity_id
      or v_hold.dependency_type <> p_dependency_type then
      raise exception 'Idempotency key already belongs to another retention hold';
    end if;
    return jsonb_build_object('holdId', v_hold.id, 'replayed', true);
  end if;
  if public.phase9_entity_snapshot(p_entity_type, p_entity_id) is null then
    raise exception 'Business record not found';
  end if;
  insert into public.retention_holds (
    entity_type, entity_id, dependency_type, reason, idempotency_key, placed_by
  ) values (
    p_entity_type, p_entity_id, p_dependency_type, btrim(p_reason),
    btrim(p_idempotency_key), v_user
  ) returning * into v_hold;
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, after, reason
  ) values (
    v_user, 'retention.hold_placed', p_entity_type::text, p_entity_id::text,
    jsonb_build_object('hold_id', v_hold.id, 'dependency_type', p_dependency_type), btrim(p_reason)
  ) returning id into v_audit_id;
  return jsonb_build_object('holdId', v_hold.id, 'auditId', v_audit_id, 'replayed', false);
end;
$$;
revoke all on function public.place_retention_hold(
  public.recycle_entity_type, uuid, public.retention_dependency_type, text, text
) from public;
grant execute on function public.place_retention_hold(
  public.recycle_entity_type, uuid, public.retention_dependency_type, text, text
) to authenticated, service_role;

create or replace function public.release_retention_hold(
  p_hold_id uuid,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_hold public.retention_holds%rowtype; v_audit_id uuid;
begin
  if v_user is null or not public.has_permission(v_user, 'recyclebin.restore') then
    raise exception 'Permission denied: recyclebin.restore required';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3
    or length(btrim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'A reason and stable idempotency key are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(btrim(p_idempotency_key), 0));
  select * into v_hold from public.retention_holds where id = p_hold_id for update;
  if not found then raise exception 'Retention hold not found'; end if;
  if v_hold.released_at is not null then
    if v_hold.release_idempotency_key = btrim(p_idempotency_key) then
      return jsonb_build_object('holdId', v_hold.id, 'replayed', true);
    end if;
    raise exception 'Retention hold is already released';
  end if;
  update public.retention_holds set released_at = now(), released_by = v_user,
    release_reason = btrim(p_reason), release_idempotency_key = btrim(p_idempotency_key)
  where id = p_hold_id returning * into v_hold;
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, after, reason
  ) values (
    v_user, 'retention.hold_released', v_hold.entity_type::text, v_hold.entity_id::text,
    jsonb_build_object('hold_id', v_hold.id, 'dependency_type', v_hold.dependency_type),
    btrim(p_reason)
  ) returning id into v_audit_id;
  return jsonb_build_object('holdId', v_hold.id, 'auditId', v_audit_id, 'replayed', false);
end;
$$;
revoke all on function public.release_retention_hold(uuid, text, text) from public;
grant execute on function public.release_retention_hold(uuid, text, text)
  to authenticated, service_role;

create or replace function public.purge_recycle_bin(
  p_run_key text,
  p_limit integer default 100
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_run public.recycle_purge_runs%rowtype;
  v_candidate record;
  v_snapshot jsonb;
  v_dependency text;
  v_audit_id uuid;
  v_purged jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_purged_count integer := 0;
  v_skipped_count integer := 0;
  v_result jsonb;
  v_command_key text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and (v_actor is null or not public.has_permission(v_actor, 'recyclebin.restore')) then
    raise exception 'Permission denied: recyclebin.restore or service role required';
  end if;
  if length(btrim(coalesce(p_run_key, ''))) < 8 then
    raise exception 'A stable purge run key is required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'Purge limit must be between 1 and 500';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('phase9:recycle-purge-global', 0));
  select * into v_run from public.recycle_purge_runs where run_key = btrim(p_run_key);
  if found then
    if v_run.completed_at is null then raise exception 'Purge run is still in progress'; end if;
    return v_run.result || jsonb_build_object('replayed', true);
  end if;

  insert into public.recycle_purge_runs (run_key, requested_limit, started_by)
  values (btrim(p_run_key), p_limit, v_actor)
  returning * into v_run;
  perform set_config('zombeans.lifecycle_command', 'on', true);

  for v_candidate in
    select candidate.entity_type, candidate.entity_id, candidate.purge_at
    from (
      select 'category'::public.recycle_entity_type as entity_type, id as entity_id, purge_at
      from public.categories where deleted_at is not null and purge_at <= now()
      union all
      select 'inventory_item', id, purge_at from public.inventory_items
      where deleted_at is not null and purge_at <= now()
      union all
      select 'supplier', id, purge_at from public.suppliers
      where deleted_at is not null and purge_at <= now()
      union all
      select 'purchase_order', id, purge_at from public.purchase_orders
      where deleted_at is not null and purge_at <= now()
      union all
      select 'recipe', id, purge_at from public.recipes
      where deleted_at is not null and purge_at <= now()
      union all
      select 'production_template', id, purge_at from public.production_templates
      where deleted_at is not null and purge_at <= now()
    ) candidate
    order by candidate.purge_at, candidate.entity_type, candidate.entity_id
    limit p_limit
  loop
    -- Lock the real root and then recompute every dependency immediately before deletion.
    case v_candidate.entity_type
      when 'category' then
        perform 1 from public.categories where id = v_candidate.entity_id for update;
      when 'inventory_item' then
        perform 1 from public.inventory_items where id = v_candidate.entity_id for update;
      when 'supplier' then
        perform 1 from public.suppliers where id = v_candidate.entity_id for update;
      when 'purchase_order' then
        perform 1 from public.purchase_orders where id = v_candidate.entity_id for update;
      when 'recipe' then
        perform 1 from public.recipes where id = v_candidate.entity_id for update;
      when 'production_template' then
        perform 1 from public.production_templates where id = v_candidate.entity_id for update;
    end case;
    if not found then continue; end if;

    v_snapshot := public.phase9_entity_snapshot(
      v_candidate.entity_type, v_candidate.entity_id
    );
    v_dependency := public.recycle_dependency_reason(
      v_candidate.entity_type, v_candidate.entity_id
    );
    if v_dependency is not null then
      v_skipped_count := v_skipped_count + 1;
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'entityType', v_candidate.entity_type,
        'label', v_snapshot ->> 'label',
        'reason', v_dependency
      ));
      continue;
    end if;

    begin
      insert into public.audit_logs (
        actor_id, action, entity_type, entity_id, before, after, reason
      ) values (
        v_actor, 'recycle.purged', v_candidate.entity_type::text,
        v_candidate.entity_id::text, v_snapshot,
        jsonb_build_object('purged', true, 'purge_run', v_run.id),
        '30-day retention elapsed; no protected dependency'
      ) returning id into v_audit_id;

      case v_candidate.entity_type
        when 'category' then
          delete from public.categories where id = v_candidate.entity_id;
        when 'inventory_item' then
          delete from public.inventory_items where id = v_candidate.entity_id;
        when 'supplier' then
          delete from public.suppliers where id = v_candidate.entity_id;
        when 'purchase_order' then
          delete from public.purchase_orders where id = v_candidate.entity_id;
        when 'recipe' then
          delete from public.recipes where id = v_candidate.entity_id;
        when 'production_template' then
          delete from public.production_templates where id = v_candidate.entity_id;
      end case;

      v_command_key := btrim(p_run_key) || ':' || v_candidate.entity_type::text
        || ':' || v_candidate.entity_id::text;
      insert into public.recycle_bin_commands (
        entity_type, entity_id, command_type, idempotency_key, actor_id, audit_log_id,
        previous_deleted_at, result
      ) values (
        v_candidate.entity_type, v_candidate.entity_id, 'purge', v_command_key,
        v_actor, v_audit_id, (v_snapshot ->> 'deleted_at')::timestamptz,
        jsonb_build_object(
          'entityType', v_candidate.entity_type,
          'label', v_snapshot ->> 'label',
          'purgedAt', now(),
          'replayed', false
        )
      );
      v_purged_count := v_purged_count + 1;
      v_purged := v_purged || jsonb_build_array(jsonb_build_object(
        'entityType', v_candidate.entity_type,
        'label', v_snapshot ->> 'label'
      ));
    exception when foreign_key_violation or restrict_violation then
      v_skipped_count := v_skipped_count + 1;
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'entityType', v_candidate.entity_type,
        'label', v_snapshot ->> 'label',
        'reason', 'Protected by a database relationship'
      ));
    end;
  end loop;

  v_result := jsonb_build_object(
    'runId', v_run.id,
    'purgedCount', v_purged_count,
    'skippedCount', v_skipped_count,
    'purged', v_purged,
    'skipped', v_skipped,
    'completedAt', now(),
    'replayed', false
  );
  update public.recycle_purge_runs set completed_at = now(), purged_count = v_purged_count,
    skipped_count = v_skipped_count, result = v_result where id = v_run.id;
  return v_result;
end;
$$;
revoke all on function public.purge_recycle_bin(text, integer) from public;
grant execute on function public.purge_recycle_bin(text, integer)
  to authenticated, service_role;

create or replace function public.record_backup_run(
  p_run_key text,
  p_reference text,
  p_mechanism public.backup_mechanism,
  p_status public.backup_run_status,
  p_storage_provider text,
  p_encrypted boolean,
  p_started_at timestamptz,
  p_completed_at timestamptz default null,
  p_retention_until date default null,
  p_size_bytes bigint default null,
  p_verified_at timestamptz default null,
  p_safe_failure_summary text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_before public.backup_runs%rowtype;
  v_after public.backup_runs%rowtype;
  v_audit_id uuid;
  v_same boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Permission denied: service role required';
  end if;
  if length(btrim(coalesce(p_run_key, ''))) < 8
    or length(btrim(coalesce(p_reference, ''))) < 3 then
    raise exception 'A stable run key and human reference are required';
  end if;
  if p_started_at is null then raise exception 'Backup start time is required'; end if;
  if p_storage_provider is not null and (
    p_storage_provider ~* '(postgres|://|password|secret|token|\\|/)'
    or length(p_storage_provider) > 80
  ) then
    raise exception 'Storage provider must be a safe provider label, not a path or credential';
  end if;
  if p_safe_failure_summary is not null and length(p_safe_failure_summary) > 500 then
    raise exception 'Backup failure summary is too long';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(btrim(p_run_key), 0));
  select * into v_before from public.backup_runs where run_key = btrim(p_run_key) for update;
  if found then
    if v_before.reference <> btrim(p_reference) or v_before.mechanism <> p_mechanism
      or v_before.started_at <> p_started_at then
      raise exception 'Backup run identity fields are immutable';
    end if;
    v_same := row(
      v_before.status, v_before.storage_provider, v_before.encrypted, v_before.completed_at,
      v_before.retention_until, v_before.size_bytes, v_before.verified_at,
      v_before.safe_failure_summary
    ) is not distinct from row(
      p_status, nullif(btrim(coalesce(p_storage_provider, '')), ''), p_encrypted, p_completed_at,
      p_retention_until, p_size_bytes, p_verified_at,
      nullif(btrim(coalesce(p_safe_failure_summary, '')), '')
    );
    if v_same then
      return jsonb_build_object(
        'backupRunId', v_before.id,
        'reference', v_before.reference,
        'status', v_before.status,
        'replayed', true
      );
    end if;
    update public.backup_runs set status = p_status,
      storage_provider = nullif(btrim(coalesce(p_storage_provider, '')), ''),
      encrypted = p_encrypted, completed_at = p_completed_at,
      retention_until = p_retention_until, size_bytes = p_size_bytes,
      verified_at = p_verified_at,
      safe_failure_summary = nullif(btrim(coalesce(p_safe_failure_summary, '')), '')
    where id = v_before.id returning * into v_after;
  else
    insert into public.backup_runs (
      run_key, reference, mechanism, status, storage_provider, encrypted, started_at,
      completed_at, retention_until, size_bytes, verified_at, safe_failure_summary
    ) values (
      btrim(p_run_key), btrim(p_reference), p_mechanism, p_status,
      nullif(btrim(coalesce(p_storage_provider, '')), ''), p_encrypted, p_started_at,
      p_completed_at, p_retention_until, p_size_bytes, p_verified_at,
      nullif(btrim(coalesce(p_safe_failure_summary, '')), '')
    ) returning * into v_after;
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before, after, reason
  ) values (
    null, 'backup.run_recorded', 'backup_run', v_after.id::text,
    case when v_before.id is null then null else jsonb_build_object(
      'reference', v_before.reference, 'mechanism', v_before.mechanism,
      'status', v_before.status, 'encrypted', v_before.encrypted,
      'started_at', v_before.started_at, 'completed_at', v_before.completed_at,
      'verified_at', v_before.verified_at
    ) end,
    jsonb_build_object(
      'reference', v_after.reference, 'mechanism', v_after.mechanism,
      'status', v_after.status, 'encrypted', v_after.encrypted,
      'started_at', v_after.started_at, 'completed_at', v_after.completed_at,
      'verified_at', v_after.verified_at
    ),
    'Secured backup infrastructure recorded non-secret run metadata'
  ) returning id into v_audit_id;
  return jsonb_build_object(
    'backupRunId', v_after.id,
    'reference', v_after.reference,
    'status', v_after.status,
    'auditId', v_audit_id,
    'replayed', false
  );
end;
$$;
revoke all on function public.record_backup_run(
  text, text, public.backup_mechanism, public.backup_run_status, text, boolean,
  timestamptz, timestamptz, date, bigint, timestamptz, text
) from public;
grant execute on function public.record_backup_run(
  text, text, public.backup_mechanism, public.backup_run_status, text, boolean,
  timestamptz, timestamptz, date, bigint, timestamptz, text
) to service_role;

create or replace function public.get_backup_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_latest jsonb; v_history jsonb;
begin
  if auth.uid() is null or not public.has_permission(auth.uid(), 'backup.manage') then
    raise exception 'Permission denied: backup.manage required';
  end if;
  select to_jsonb(q) into v_latest from (
    select reference, mechanism::text as mechanism, status::text as status,
      storage_provider as "storageProvider", encrypted, started_at as "startedAt",
      completed_at as "completedAt", retention_until as "retentionUntil",
      size_bytes as "sizeBytes", verified_at as "verifiedAt",
      safe_failure_summary as "safeFailureSummary"
    from public.backup_runs order by started_at desc limit 1
  ) q;
  select coalesce(jsonb_agg(to_jsonb(q) order by q."startedAt" desc), '[]'::jsonb)
  into v_history from (
    select reference, mechanism::text as mechanism, status::text as status,
      storage_provider as "storageProvider", encrypted, started_at as "startedAt",
      completed_at as "completedAt", retention_until as "retentionUntil",
      size_bytes as "sizeBytes", verified_at as "verifiedAt",
      safe_failure_summary as "safeFailureSummary"
    from public.backup_runs order by started_at desc limit 50
  ) q;
  return jsonb_build_object(
    'latest', v_latest,
    'history', v_history,
    'policy', jsonb_build_object(
      'managed', 'Continuous/daily per Supabase plan',
      'independent', 'Daily encrypted pg_dump retained 30 days',
      'weekly', 'Weekly export retained 12 weeks',
      'restoreTest', 'Quarterly scratch restore and smoke test',
      'auditRetention', 'At least 7 years',
      'ledgerRetention', 'Effectively permanent'
    )
  );
end;
$$;
revoke all on function public.get_backup_status() from public;
grant execute on function public.get_backup_status() to authenticated, service_role;
