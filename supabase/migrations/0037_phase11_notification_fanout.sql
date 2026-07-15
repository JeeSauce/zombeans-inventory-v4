-- 0037_phase11_notification_fanout.sql
-- Restore branch-targeted notification recipient expansion without reopening cross-user probes.

-- This predicate deliberately has no auth.uid() binding because raise_notification evaluates
-- every active recipient. It is owner-internal only: browser and service API roles cannot use it
-- to ask about another user's branch scope.
create or replace function public._branch_scope_internal(p_uid uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
    and (
      exists (
        select 1
        from public.user_roles ur
        join public.roles r on r.id = ur.role_id
        where ur.profile_id = p_uid and r.key = 'super_admin'
      )
      or (
        exists (
          select 1
          from public.user_roles ur
          join public.roles r on r.id = ur.role_id
          where ur.profile_id = p_uid and r.key = 'branch_manager'
        )
        and not exists (
          select 1
          from public.user_branch_assignments uba
          where uba.profile_id = p_uid
        )
      )
      or exists (
        select 1
        from public.user_branch_assignments uba
        where uba.profile_id = p_uid and uba.branch_id = p_branch_id
      )
    );
$$;
revoke all on function public._branch_scope_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Keep notification projection, deduplication, append-only events, receipts, deliveries, and
-- idempotency unchanged. Only recipient branch evaluation uses the private cross-user predicate.
create or replace function public.raise_notification(
  p_source_type public.notification_source_type,
  p_title text,
  p_message text,
  p_entity_type text,
  p_entity_id uuid,
  p_entity_reference text,
  p_dedup_key text,
  p_target_role_id uuid default null,
  p_target_branch_id uuid default null,
  p_target_user_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_notification public.notifications%rowtype;
  v_reference text;
  v_severity public.notification_severity;
  v_event_type public.notification_event_type;
  v_recipient record;
  v_delivery_id uuid;
begin
  if p_source_type is null then raise exception 'Notification source is required'; end if;
  if p_title is null or length(btrim(p_title)) = 0 then
    raise exception 'Notification title is required';
  end if;
  if p_message is null or length(btrim(p_message)) = 0 then
    raise exception 'Notification message is required';
  end if;
  if p_entity_type is null or length(btrim(p_entity_type)) = 0 then
    raise exception 'Notification entity type is required';
  end if;
  if p_dedup_key is null or length(btrim(p_dedup_key)) = 0 then
    raise exception 'Notification dedup key is required';
  end if;

  v_severity := public.notification_severity_for_source(p_source_type);
  perform pg_advisory_xact_lock(hashtextextended('notification:' || btrim(p_dedup_key), 0));

  select * into v_notification
  from public.notifications
  where dedup_key = btrim(p_dedup_key) and status = 'active'
  for update;

  if found then
    update public.notifications set
      severity = v_severity,
      source_type = p_source_type,
      title = btrim(p_title),
      message = btrim(p_message),
      entity_type = btrim(p_entity_type),
      entity_id = p_entity_id,
      entity_reference = nullif(btrim(p_entity_reference), ''),
      target_role_id = p_target_role_id,
      target_branch_id = p_target_branch_id,
      target_user_id = p_target_user_id,
      email_required = v_severity = 'critical',
      last_raised_at = now(),
      raise_count = raise_count + 1
    where id = v_notification.id
    returning * into v_notification;
    v_event_type := 'reraised';
  else
    v_reference := public.next_notification_reference();
    insert into public.notifications (
      reference, severity, source_type, title, message, entity_type, entity_id,
      entity_reference, target_role_id, target_branch_id, target_user_id, dedup_key,
      email_required
    ) values (
      v_reference, v_severity, p_source_type, btrim(p_title), btrim(p_message),
      btrim(p_entity_type), p_entity_id, nullif(btrim(p_entity_reference), ''),
      p_target_role_id, p_target_branch_id, p_target_user_id, btrim(p_dedup_key),
      v_severity = 'critical'
    ) returning * into v_notification;
    v_event_type := 'raised';
  end if;

  insert into public.notification_events (
    notification_id, event_type, actor_id, metadata, idempotency_key
  ) values (
    v_notification.id, v_event_type, auth.uid(),
    jsonb_build_object(
      'source_type', p_source_type,
      'severity', v_severity,
      'raise_count', v_notification.raise_count
    ),
    'raise:' || v_notification.id::text || ':' || v_notification.raise_count::text
  );

  -- Expand current active recipients. Unique delivery indexes make a re-raise delivery-idempotent.
  for v_recipient in
    select p.id, p.email::text as email
    from public.profiles p
    where p.status = 'active'
      and (p_target_user_id is null or p_target_user_id = p.id)
      and (
        p_target_role_id is null
        or exists (
          select 1
          from public.user_roles ur
          where ur.profile_id = p.id and ur.role_id = p_target_role_id
        )
      )
      and (
        p_target_branch_id is null
        or public._branch_scope_internal(p.id, p_target_branch_id)
      )
    order by p.id
    for key share of p
  loop
    insert into public.notification_receipts (notification_id, user_id)
    values (v_notification.id, v_recipient.id)
    on conflict (notification_id, user_id) do nothing;

    v_delivery_id := null;
    insert into public.notification_deliveries (
      notification_id, channel, recipient_user_id, status, idempotency_key, delivered_at
    ) values (
      v_notification.id, 'in_app', v_recipient.id, 'delivered',
      'notification:' || v_notification.id::text || ':in-app:' || v_recipient.id::text,
      now()
    ) on conflict do nothing returning id into v_delivery_id;
    if v_delivery_id is not null then
      insert into public.notification_events (
        notification_id, event_type, metadata, idempotency_key
      ) values (
        v_notification.id, 'delivery_delivered',
        jsonb_build_object('channel', 'in_app', 'recipient_user_id', v_recipient.id),
        'delivery:' || v_delivery_id::text || ':delivered'
      );
    end if;

    if v_severity = 'critical' then
      v_delivery_id := null;
      insert into public.notification_deliveries (
        notification_id, channel, recipient_user_id, recipient_address, status, idempotency_key
      ) values (
        v_notification.id, 'email', v_recipient.id, v_recipient.email, 'queued',
        'notification:' || v_notification.id::text || ':email:' || v_recipient.id::text
      ) on conflict do nothing returning id into v_delivery_id;
      if v_delivery_id is not null then
        insert into public.notification_events (
          notification_id, event_type, metadata, idempotency_key
        ) values (
          v_notification.id, 'delivery_queued',
          jsonb_build_object('channel', 'email', 'delivery_id', v_delivery_id),
          'delivery:' || v_delivery_id::text || ':queued'
        );
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'notification_id', v_notification.id,
    'reference', v_notification.reference,
    'severity', v_notification.severity,
    'replayed', v_event_type = 'reraised',
    'raise_count', v_notification.raise_count
  );
end;
$$;
revoke all on function public.raise_notification(
  public.notification_source_type, text, text, text, uuid, text, text, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.raise_notification(
  public.notification_source_type, text, text, text, uuid, text, text, uuid, uuid, uuid
) to service_role;
