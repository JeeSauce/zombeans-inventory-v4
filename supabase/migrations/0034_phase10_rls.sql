-- 0034_phase10_rls.sql
-- Phase 10 safe reads and RLS. Authenticated users have no direct mutating DML path.

revoke all on
  public.offline_submissions,
  public.offline_submission_items,
  public.offline_conflict_resolutions,
  public.loyverse_mappings,
  public.loyverse_mapping_commands,
  public.pos_imports,
  public.pos_import_rows,
  public.pos_import_postings
from authenticated;

grant select (
  id, reference, submission_type, status, branch_id, client_draft_id,
  client_created_at, snapshot_at, business_date, conflict_reason, submitted_by,
  submitted_at, resolved_by, resolved_at, created_at, updated_at, version
) on public.offline_submissions to authenticated;

grant select (
  id, submission_id, item_id, physical_qty, created_at
) on public.offline_submission_items to authenticated;

grant select (
  id, submission_id, decision, reason, actor_id, created_at
) on public.offline_conflict_resolutions to authenticated;

grant select (
  id, entity_type, external_id, external_name, external_sku, inventory_item_id,
  inventory_qty, active, created_by, updated_by, created_at, updated_at, version
) on public.loyverse_mappings to authenticated;

grant select (
  id, mapping_id, command_type, reason, actor_id, created_at
) on public.loyverse_mapping_commands to authenticated;

grant select (
  id, reference, branch_id, source, filename, status, row_count, valid_count,
  error_count, previewed_by, previewed_at, confirm_reason, confirmed_by, confirmed_at,
  created_at, updated_at, version
) on public.pos_imports to authenticated;

grant select (
  id, import_id, row_number, external_reference, external_line_id, occurred_at,
  movement_type, entity_type, external_id, quantity, mapping_id, inventory_item_id,
  inventory_qty, validation_status, validation_error, created_at
) on public.pos_import_rows to authenticated;

grant select (
  id, import_id, import_row_id, external_line_id, movement_type, stock_txn_id, created_at
) on public.pos_import_postings to authenticated;

grant select, insert, update, delete on
  public.offline_submissions,
  public.offline_submission_items,
  public.offline_conflict_resolutions,
  public.loyverse_mappings,
  public.loyverse_mapping_commands,
  public.pos_imports,
  public.pos_import_rows,
  public.pos_import_postings
to service_role;

alter table public.offline_submissions enable row level security;
alter table public.offline_submission_items enable row level security;
alter table public.offline_conflict_resolutions enable row level security;
alter table public.loyverse_mappings enable row level security;
alter table public.loyverse_mapping_commands enable row level security;
alter table public.pos_imports enable row level security;
alter table public.pos_import_rows enable row level security;
alter table public.pos_import_postings enable row level security;

create or replace function public.has_offline_submission_access(
  p_uid uuid,
  p_branch_id uuid,
  p_submitted_by uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select p_uid is not null
    and public.has_branch_access(p_uid, p_branch_id)
    and (
      (p_uid = p_submitted_by and public.has_permission(p_uid, 'offline.sync'))
      or public.has_permission(p_uid, 'offline.review')
    )
$$;
revoke all on function public.has_offline_submission_access(uuid, uuid, uuid) from public;
grant execute on function public.has_offline_submission_access(uuid, uuid, uuid)
  to authenticated, service_role;

create or replace function public.has_pos_import_access(p_uid uuid, p_branch_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_uid is not null
    and public.has_permission(p_uid, 'pos.import')
    and public.has_branch_access(p_uid, p_branch_id)
$$;
revoke all on function public.has_pos_import_access(uuid, uuid) from public;
grant execute on function public.has_pos_import_access(uuid, uuid) to authenticated, service_role;

create policy offline_submissions_select on public.offline_submissions
  for select to authenticated
  using (public.has_offline_submission_access(auth.uid(), branch_id, submitted_by));

create policy offline_submission_items_select on public.offline_submission_items
  for select to authenticated
  using (
    exists (
      select 1 from public.offline_submissions os where os.id = submission_id
    )
  );

create policy offline_conflict_resolutions_select on public.offline_conflict_resolutions
  for select to authenticated
  using (
    exists (
      select 1 from public.offline_submissions os where os.id = submission_id
    )
  );

create policy loyverse_mappings_select on public.loyverse_mappings
  for select to authenticated
  using (public.has_permission(auth.uid(), 'pos.import'));

create policy loyverse_mapping_commands_select on public.loyverse_mapping_commands
  for select to authenticated
  using (public.has_permission(auth.uid(), 'pos.import'));

create policy pos_imports_select on public.pos_imports
  for select to authenticated
  using (public.has_pos_import_access(auth.uid(), branch_id));

create policy pos_import_rows_select on public.pos_import_rows
  for select to authenticated
  using (
    exists (select 1 from public.pos_imports pi where pi.id = import_id)
  );

create policy pos_import_postings_select on public.pos_import_postings
  for select to authenticated
  using (
    exists (select 1 from public.pos_imports pi where pi.id = import_id)
  );

-- Mutations are intentionally absent for authenticated. Definer RPCs in 0035 are the only write
-- surface, while RLS remains the backstop for accidental future browser queries.
revoke all on function public.tg_phase10_append_only() from public;

