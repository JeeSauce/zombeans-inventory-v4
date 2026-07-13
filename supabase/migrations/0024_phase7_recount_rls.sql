-- 0024_phase7_recount_rls.sql
-- Phase 7 RLS and grants. Authenticated reads omit all cost/variance-value columns; every write is
-- performed by an internally authorized SECURITY DEFINER function.

grant select (
  id, reference, branch_id, business_date, type, status, snapshot_at,
  open_idempotency_key, submit_idempotency_key, is_unusual, unusual_signals,
  opened_by, opened_at, submitted_by, submitted_at, adjusted_by, adjusted_at,
  day_reopen_event_id, created_at, updated_at, version
) on public.recount_sessions to authenticated;

grant select (
  id, session_id, item_id, unit_id, opening_qty, received_qty, production_output_qty,
  transfers_out_qty, usage_qty, stock_out_qty, waste_qty, expected_qty, physical_qty,
  variance_qty, unusual_signals, created_at
) on public.recount_lines to authenticated;

grant select (
  id, reference, session_id, reason_type, reason, idempotency_key, stock_txn_id,
  is_unusual, posted_by, posted_at, day_reopen_event_id, created_at
) on public.variance_adjustments to authenticated;

grant select on public.daily_operational_closures, public.day_close_events to authenticated;

grant select, insert, update, delete on
  public.recount_sessions, public.recount_lines, public.variance_adjustments,
  public.daily_operational_closures, public.day_close_events
  to service_role;

alter table public.recount_sessions enable row level security;
alter table public.recount_lines enable row level security;
alter table public.variance_adjustments enable row level security;
alter table public.daily_operational_closures enable row level security;
alter table public.day_close_events enable row level security;

create or replace function public.has_recount_access(p_uid uuid, p_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null
    and public.has_branch_access(p_uid, p_branch_id)
    and (
      public.has_permission(p_uid, 'recount.perform')
      or public.has_permission(p_uid, 'recount.confirm')
      or public.has_permission(p_uid, 'recount.confirm_unusual')
      or public.has_permission(p_uid, 'closure.reopen')
    )
$$;
revoke all on function public.has_recount_access(uuid, uuid) from public;
grant execute on function public.has_recount_access(uuid, uuid) to authenticated, service_role;

create policy recount_sessions_select on public.recount_sessions
  for select to authenticated
  using (public.has_recount_access(auth.uid(), branch_id));

create policy recount_lines_select on public.recount_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.recount_sessions rs where rs.id = session_id
    )
  );

create policy variance_adjustments_select on public.variance_adjustments
  for select to authenticated
  using (
    exists (
      select 1 from public.recount_sessions rs where rs.id = session_id
    )
  );

create policy daily_closures_select on public.daily_operational_closures
  for select to authenticated
  using (public.has_recount_access(auth.uid(), branch_id));

create policy day_close_events_select on public.day_close_events
  for select to authenticated
  using (
    exists (
      select 1 from public.daily_operational_closures dc where dc.id = closure_id
    )
  );

-- There are intentionally no authenticated INSERT/UPDATE/DELETE grants or policies on any Phase
-- 7 table. RLS is the backstop even if a future caller bypasses the current Server Actions.

