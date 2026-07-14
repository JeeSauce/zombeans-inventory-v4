-- 0031_phase9_rls.sql
-- Phase 9 admin metadata is Super-Admin-only. Lifecycle changes and backup metadata writes have no
-- authenticated DML path; they are exposed through narrowly authorized functions in 0032.

grant select (
  id, entity_type, entity_id, dependency_type, reason, placed_at,
  released_at, release_reason, created_at, updated_at, version
) on public.retention_holds to authenticated;

-- Command idempotency keys, actor UUIDs, audit UUIDs, and JSON results stay definer-only.
grant select (id, entity_type, command_type, created_at)
  on public.recycle_bin_commands to authenticated;

grant select (
  id, requested_limit, started_at, completed_at, purged_count, skipped_count
) on public.recycle_purge_runs to authenticated;

grant select (
  id, reference, mechanism, status, storage_provider, encrypted, started_at, completed_at,
  retention_until, size_bytes, verified_at, safe_failure_summary, created_at, updated_at, version
) on public.backup_runs to authenticated;

revoke insert, update, delete on
  public.retention_holds,
  public.recycle_bin_commands,
  public.recycle_purge_runs,
  public.backup_runs
  from authenticated;

-- Legacy phase grants included hard delete for these roots. Phase 9 makes deletion reversible and
-- function-only; lifecycle guard triggers also backstop direct changes to deleted_at/purge_at.
revoke delete on
  public.categories,
  public.inventory_items,
  public.suppliers,
  public.purchase_orders,
  public.recipes,
  public.production_templates
  from authenticated;

alter table public.retention_holds enable row level security;
alter table public.recycle_bin_commands enable row level security;
alter table public.recycle_purge_runs enable row level security;
alter table public.backup_runs enable row level security;

create policy retention_holds_super_read on public.retention_holds
  for select to authenticated
  using (public.has_permission(auth.uid(), 'recyclebin.restore'));

create policy recycle_commands_super_read on public.recycle_bin_commands
  for select to authenticated
  using (public.has_permission(auth.uid(), 'recyclebin.restore'));

create policy recycle_purge_runs_super_read on public.recycle_purge_runs
  for select to authenticated
  using (public.has_permission(auth.uid(), 'recyclebin.restore'));

create policy backup_runs_super_read on public.backup_runs
  for select to authenticated
  using (public.has_permission(auth.uid(), 'backup.manage'));

-- Intentionally no authenticated insert/update/delete policies. SECURITY DEFINER functions own
-- lifecycle/hold commands; secured CI uses the service-role-only backup metadata RPC.
