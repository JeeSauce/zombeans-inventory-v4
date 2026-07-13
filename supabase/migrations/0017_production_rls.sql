-- 0017_production_rls.sql
-- Production composition is visible to production operators/confirmers. Inventory writes and
-- cost snapshot data remain available only inside SECURITY DEFINER functions.

-- Templates contain no cost-bearing data.
grant select on public.production_templates to authenticated;
grant insert (
  name, recipe_id, default_batch_multiplier, default_expiry_days, instructions,
  active, created_by, updated_by
) on public.production_templates to authenticated;
grant update (
  name, default_batch_multiplier, default_expiry_days, instructions, active,
  updated_by, version, deleted_at, deleted_by, purge_at
) on public.production_templates to authenticated;

-- Deliberately omit cost_snapshot_id and every direct insert privilege. Orders are planned only
-- through create_production_order(), which attaches the protected activation snapshot.
grant select (
  id, reference, template_id, recipe_version_id, branch_id, output_item_id, output_unit_id,
  status, batch_multiplier, planned_output_qty, actual_output_qty, output_lot_number,
  production_date, expiration_date, notes, idempotency_key, correlation_id,
  started_at, started_by, recorded_at, recorded_by, submitted_at, submitted_by,
  confirmed_at, confirmed_by, production_output_txn_id, created_at, updated_at,
  created_by, updated_by, version
) on public.production_orders to authenticated;
grant update (
  status, actual_output_qty, output_lot_number, production_date, expiration_date, notes,
  started_at, started_by, recorded_at, recorded_by, submitted_at, submitted_by,
  updated_by, version
) on public.production_orders to authenticated;

grant select on public.production_order_inputs to authenticated;
grant update (
  actual_consumed_qty, waste_qty, notes, updated_at, version
) on public.production_order_inputs to authenticated;

grant select, insert, update, delete on
  public.production_templates, public.production_orders, public.production_order_inputs
  to service_role;

alter table public.production_templates enable row level security;
alter table public.production_orders enable row level security;
alter table public.production_order_inputs enable row level security;

create policy production_templates_select on public.production_templates
  for select to authenticated
  using (
    deleted_at is null and (
      public.has_permission(auth.uid(), 'production.create')
      or public.has_permission(auth.uid(), 'production.record')
      or public.has_permission(auth.uid(), 'production.confirm')
    )
  );
create policy production_templates_create on public.production_templates
  for insert to authenticated
  with check (public.has_permission(auth.uid(), 'production.create'));
create policy production_templates_update on public.production_templates
  for update to authenticated
  using (public.has_permission(auth.uid(), 'production.create'))
  with check (public.has_permission(auth.uid(), 'production.create'));

create policy production_orders_select on public.production_orders
  for select to authenticated
  using (
    public.has_permission(auth.uid(), 'production.create')
    or public.has_permission(auth.uid(), 'production.record')
    or public.has_permission(auth.uid(), 'production.confirm')
  );

create policy production_orders_start_record on public.production_orders
  for update to authenticated
  using (
    public.has_permission(auth.uid(), 'production.record')
    and status in ('draft', 'in_progress')
  )
  with check (
    public.has_permission(auth.uid(), 'production.record')
    and status in ('in_progress', 'awaiting_confirmation')
  );

create policy production_orders_cancel on public.production_orders
  for update to authenticated
  using (
    public.has_permission(auth.uid(), 'production.create')
    and status in ('draft', 'in_progress', 'awaiting_confirmation')
  )
  with check (
    public.has_permission(auth.uid(), 'production.create')
    and status = 'cancelled'
  );

create policy production_inputs_select on public.production_order_inputs
  for select to authenticated
  using (
    exists (
      select 1 from public.production_orders po
      where po.id = production_order_id
    )
  );
create policy production_inputs_record on public.production_order_inputs
  for update to authenticated
  using (
    public.has_permission(auth.uid(), 'production.record')
    and exists (
      select 1 from public.production_orders po
      where po.id = production_order_id and po.status = 'in_progress'
    )
  )
  with check (
    public.has_permission(auth.uid(), 'production.record')
    and exists (
      select 1 from public.production_orders po
      where po.id = production_order_id and po.status = 'in_progress'
    )
  );
