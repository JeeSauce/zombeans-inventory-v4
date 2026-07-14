-- 0027_phase8_rls.sql
-- Phase 8 RLS and grants. Authenticated users receive safe reads only; all mutation paths are
-- internally authorized SECURITY DEFINER functions added in 0028.

create or replace function public.can_view_notification(
  p_uid uuid,
  p_target_role_id uuid,
  p_target_branch_id uuid,
  p_target_user_id uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select p_uid is not null
    and (p_target_user_id is null or p_target_user_id = p_uid)
    and (
      p_target_role_id is null
      or exists (
        select 1 from public.user_roles ur
        where ur.profile_id = p_uid and ur.role_id = p_target_role_id
      )
    )
    and (
      p_target_branch_id is null
      or public.has_branch_access(p_uid, p_target_branch_id)
    )
$$;
revoke all on function public.can_view_notification(uuid, uuid, uuid, uuid) from public;
grant execute on function public.can_view_notification(uuid, uuid, uuid, uuid)
  to authenticated, service_role;

create or replace function public.can_view_calendar_event(p_uid uuid, p_branch_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_uid is not null
    and (p_branch_id is null or public.has_branch_access(p_uid, p_branch_id))
$$;
revoke all on function public.can_view_calendar_event(uuid, uuid) from public;
grant execute on function public.can_view_calendar_event(uuid, uuid)
  to authenticated, service_role;

grant select (
  id, reference, severity, source_type, status, title, message, entity_type, entity_reference,
  target_role_id, target_branch_id, target_user_id, email_required, first_raised_at,
  last_raised_at, raise_count, resolved_at, resolution, created_at, updated_at, version
) on public.notifications to authenticated;

grant select (
  id, notification_id, user_id, read_at, acknowledged_at, updated_at
) on public.notification_receipts to authenticated;

grant select (
  id, notification_id, event_type, actor_id, created_at
) on public.notification_events to authenticated;

-- Delivery addresses, provider IDs, claim tokens, and errors remain server-only.
grant select (
  id, notification_id, channel, recipient_user_id, status, created_at, updated_at
) on public.notification_deliveries to authenticated;

grant select on public.calendar_events to authenticated;

grant select (
  id, reference, calendar_event_id, popup_branch_id, return_branch_id, status, notes,
  started_at, started_by, counted_at, counted_by, completed_at, completed_by,
  created_by, updated_by, created_at, updated_at, version
) on public.popup_event_sessions to authenticated;

grant select on public.popup_event_count_lines, public.popup_event_movements to authenticated;

grant select, insert, update, delete on
  public.notifications,
  public.notification_receipts,
  public.notification_events,
  public.notification_deliveries,
  public.calendar_events,
  public.calendar_event_commands,
  public.popup_event_sessions,
  public.popup_event_count_lines,
  public.popup_event_movements,
  public.popup_event_commands
  to service_role;

alter table public.notifications enable row level security;
alter table public.notification_receipts enable row level security;
alter table public.notification_events enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_event_commands enable row level security;
alter table public.popup_event_sessions enable row level security;
alter table public.popup_event_count_lines enable row level security;
alter table public.popup_event_movements enable row level security;
alter table public.popup_event_commands enable row level security;

create policy notifications_select on public.notifications
  for select to authenticated
  using (
    public.can_view_notification(
      auth.uid(), target_role_id, target_branch_id, target_user_id
    )
  );

create policy notification_receipts_select on public.notification_receipts
  for select to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.notifications n where n.id = notification_id
    )
  );

create policy notification_events_select on public.notification_events
  for select to authenticated
  using (
    exists (
      select 1 from public.notifications n where n.id = notification_id
    )
  );

create policy notification_deliveries_select on public.notification_deliveries
  for select to authenticated
  using (
    recipient_user_id = auth.uid()
    and exists (
      select 1 from public.notifications n where n.id = notification_id
    )
  );

create policy calendar_events_select on public.calendar_events
  for select to authenticated
  using (public.can_view_calendar_event(auth.uid(), branch_id));

create policy popup_event_sessions_select on public.popup_event_sessions
  for select to authenticated
  using (
    public.can_view_calendar_event(auth.uid(), popup_branch_id)
    and public.can_view_calendar_event(auth.uid(), return_branch_id)
    and exists (
      select 1 from public.calendar_events ce where ce.id = calendar_event_id
    )
  );

create policy popup_event_count_lines_select on public.popup_event_count_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.popup_event_sessions pe where pe.id = popup_event_id
    )
  );

create policy popup_event_movements_select on public.popup_event_movements
  for select to authenticated
  using (
    exists (
      select 1 from public.popup_event_sessions pe where pe.id = popup_event_id
    )
  );

-- Calendar/popup command rows contain internal audit and idempotency data, so authenticated users
-- have neither a SELECT grant nor a policy. There are intentionally no authenticated write grants
-- or policies on any Phase 8 table. RLS remains the backstop if a caller bypasses Server Actions.
