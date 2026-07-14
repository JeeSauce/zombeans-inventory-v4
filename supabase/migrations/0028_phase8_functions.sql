-- 0028_phase8_functions.sql
-- Phase 8 internally authorized functions: notification producers/delivery, dashboard analytics,
-- calendar commands, and popup engagement lifecycle. All timestamps are stored in UTC.

alter table public.notification_events
  add column idempotency_key text unique,
  add constraint notification_events_key_nonblank check (
    idempotency_key is null or length(btrim(idempotency_key)) > 0
  );

-- Hard deletes are reserved for test cleanup/privacy erasure. Operational branches and roles use
-- soft deletion, so normal alert history remains intact. User-specific delivery state must not
-- retain a deleted account or its address.
alter table public.notifications
  drop constraint notifications_target_role_id_fkey,
  add constraint notifications_target_role_id_fkey
    foreign key (target_role_id) references public.roles(id) on delete cascade,
  drop constraint notifications_target_branch_id_fkey,
  add constraint notifications_target_branch_id_fkey
    foreign key (target_branch_id) references public.branches(id) on delete cascade,
  drop constraint notifications_target_user_id_fkey,
  add constraint notifications_target_user_id_fkey
    foreign key (target_user_id) references public.profiles(id) on delete cascade,
  drop constraint notifications_resolved_by_fkey,
  add constraint notifications_resolved_by_fkey
    foreign key (resolved_by) references public.profiles(id) on delete set null;
alter table public.notification_receipts
  drop constraint notification_receipts_notification_id_fkey,
  add constraint notification_receipts_notification_id_fkey
    foreign key (notification_id) references public.notifications(id) on delete cascade,
  drop constraint notification_receipts_user_id_fkey,
  add constraint notification_receipts_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade;
alter table public.notification_events
  drop constraint notification_events_notification_id_fkey,
  add constraint notification_events_notification_id_fkey
    foreign key (notification_id) references public.notifications(id) on delete cascade,
  drop constraint notification_events_actor_id_fkey,
  add constraint notification_events_actor_id_fkey
    foreign key (actor_id) references public.profiles(id) on delete set null;
alter table public.notification_deliveries
  drop constraint notification_deliveries_notification_id_fkey,
  add constraint notification_deliveries_notification_id_fkey
    foreign key (notification_id) references public.notifications(id) on delete cascade,
  drop constraint notification_deliveries_recipient_user_id_fkey,
  add constraint notification_deliveries_recipient_user_id_fkey
    foreign key (recipient_user_id) references public.profiles(id) on delete cascade;

create or replace function public.tg_phase8_append_only()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Permit only an FK cascade caused by an owner-level hard delete of the parent record. Direct
  -- update/delete attempts still fail; application roles have no parent delete path.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception '% is append-only', tg_table_name;
end;
$$;

-- The permanent Popup stock-holding branch. It is an operating location; engagements are modeled
-- separately in popup_event_sessions.
insert into public.branches (key, name, is_main, holds_raw_ingredients, active)
values ('popup', 'Zombeans Popup', false, false, true)
on conflict (key) do update set
  name = excluded.name,
  active = true,
  holds_raw_ingredients = false;

create or replace function public.next_notification_reference() returns text
language sql security definer set search_path = public as $$
  select 'NTF-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.notification_ref_seq')::text, 6, '0')
$$;
create or replace function public.next_calendar_event_reference() returns text
language sql security definer set search_path = public as $$
  select 'CAL-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.calendar_event_ref_seq')::text, 5, '0')
$$;
create or replace function public.next_popup_event_reference() returns text
language sql security definer set search_path = public as $$
  select 'POP-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
         lpad(nextval('public.popup_event_ref_seq')::text, 5, '0')
$$;
revoke all on function public.next_notification_reference() from public;
revoke all on function public.next_calendar_event_reference() from public;
revoke all on function public.next_popup_event_reference() from public;

create or replace function public.notification_severity_for_source(
  p_source public.notification_source_type
) returns public.notification_severity
language sql immutable set search_path = public as $$
  select case
    when p_source in ('negative_inventory', 'expired_lot', 'failed_production')
      then 'critical'::public.notification_severity
    when p_source in (
      'overdue_recount', 'unusual_recount', 'out_of_stock', 'pending_stock_request'
    ) then 'warning'::public.notification_severity
    else 'info'::public.notification_severity
  end
$$;
revoke all on function public.notification_severity_for_source(public.notification_source_type)
  from public;
grant execute on function public.notification_severity_for_source(public.notification_source_type)
  to authenticated, service_role;

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
      and public.can_view_notification(
        p.id, p_target_role_id, p_target_branch_id, p_target_user_id
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
) from public;
grant execute on function public.raise_notification(
  public.notification_source_type, text, text, text, uuid, text, text, uuid, uuid, uuid
) to service_role;

create or replace function public.resolve_notification(
  p_dedup_key text,
  p_resolution text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_notification public.notifications%rowtype;
  v_existing public.notification_events%rowtype;
begin
  if p_dedup_key is null or length(btrim(p_dedup_key)) = 0 then
    raise exception 'Notification dedup key is required';
  end if;
  if p_resolution is null or length(btrim(p_resolution)) < 3 then
    raise exception 'Resolution must be at least 3 characters';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('notification-resolve:' || p_idempotency_key, 0));

  select * into v_existing from public.notification_events
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.event_type <> 'resolved' then
      raise exception 'Idempotency key belongs to another notification command';
    end if;
    select * into v_notification from public.notifications where id = v_existing.notification_id;
    return jsonb_build_object('notification_id', v_notification.id,
      'reference', v_notification.reference, 'replayed', true);
  end if;

  select * into v_notification from public.notifications
  where dedup_key = btrim(p_dedup_key) and status = 'active' for update;
  if not found then
    return jsonb_build_object('notification_id', null, 'replayed', false, 'not_found', true);
  end if;

  update public.notifications set
    status = 'resolved', resolved_at = now(), resolved_by = auth.uid(),
    resolution = btrim(p_resolution)
  where id = v_notification.id
  returning * into v_notification;
  insert into public.notification_events (
    notification_id, event_type, actor_id, metadata, idempotency_key
  ) values (
    v_notification.id, 'resolved', auth.uid(),
    jsonb_build_object('resolution', btrim(p_resolution)), btrim(p_idempotency_key)
  );
  return jsonb_build_object('notification_id', v_notification.id,
    'reference', v_notification.reference, 'replayed', false);
end;
$$;
revoke all on function public.resolve_notification(text, text, text) from public;
grant execute on function public.resolve_notification(text, text, text) to service_role;

create or replace function public.set_notification_receipt_state(
  p_notification_id uuid,
  p_acknowledge boolean,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_notification public.notifications%rowtype;
  v_event public.notification_events%rowtype;
  v_receipt public.notification_receipts%rowtype;
  v_event_type public.notification_event_type;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_notification_id is null then raise exception 'Notification is required'; end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  v_event_type := case when p_acknowledge then 'acknowledged' else 'read' end;
  perform pg_advisory_xact_lock(hashtextextended('notification-receipt:' || p_idempotency_key, 0));

  select * into v_event from public.notification_events
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_event.notification_id <> p_notification_id or v_event.actor_id <> v_user
       or v_event.event_type <> v_event_type then
      raise exception 'Idempotency key belongs to another notification command';
    end if;
    select * into v_receipt from public.notification_receipts
    where notification_id = p_notification_id and user_id = v_user;
    return jsonb_build_object('notification_id', p_notification_id,
      'read_at', v_receipt.read_at, 'acknowledged_at', v_receipt.acknowledged_at,
      'replayed', true);
  end if;

  select * into v_notification from public.notifications where id = p_notification_id;
  if not found or not public.can_view_notification(
    v_user, v_notification.target_role_id, v_notification.target_branch_id,
    v_notification.target_user_id
  ) then
    raise exception 'Notification not found or access denied';
  end if;

  insert into public.notification_receipts (
    notification_id, user_id, read_at, acknowledged_at
  ) values (
    p_notification_id, v_user, now(), case when p_acknowledge then now() else null end
  ) on conflict (notification_id, user_id) do update set
    read_at = coalesce(public.notification_receipts.read_at, excluded.read_at),
    acknowledged_at = case
      when p_acknowledge then coalesce(
        public.notification_receipts.acknowledged_at, excluded.acknowledged_at
      ) else public.notification_receipts.acknowledged_at
    end
  returning * into v_receipt;

  insert into public.notification_events (
    notification_id, event_type, actor_id, idempotency_key
  ) values (p_notification_id, v_event_type, v_user, btrim(p_idempotency_key));
  return jsonb_build_object('notification_id', p_notification_id,
    'read_at', v_receipt.read_at, 'acknowledged_at', v_receipt.acknowledged_at,
    'replayed', false);
end;
$$;
revoke all on function public.set_notification_receipt_state(uuid, boolean, text) from public;
grant execute on function public.set_notification_receipt_state(uuid, boolean, text)
  to authenticated, service_role;

create or replace function public.claim_notification_email_deliveries(
  p_claim_token uuid,
  p_limit integer default 20
) returns table (
  delivery_id uuid,
  notification_id uuid,
  recipient_address text,
  subject text,
  body text
)
language plpgsql security definer set search_path = public as $$
begin
  if p_claim_token is null then raise exception 'Claim token is required'; end if;
  if p_limit < 1 or p_limit > 100 then raise exception 'Claim limit must be between 1 and 100'; end if;

  return query
  with candidates as (
    select d.id
    from public.notification_deliveries d
    where d.channel = 'email' and d.status in ('queued', 'failed')
      and d.attempt_count < 3
    order by d.created_at, d.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.notification_deliveries d set
      status = 'processing', claim_token = p_claim_token, claimed_at = now(),
      attempt_count = d.attempt_count + 1, failed_at = null, last_error = null
    from candidates c
    where d.id = c.id
    returning d.id, d.notification_id, d.recipient_address
  ), events as (
    insert into public.notification_events (
      notification_id, event_type, metadata, idempotency_key
    )
    select c.notification_id, 'delivery_claimed',
      jsonb_build_object('delivery_id', c.id, 'claim_token', p_claim_token),
      'delivery:' || c.id::text || ':claim:' || p_claim_token::text
    from claimed c
    on conflict (idempotency_key) do nothing
    returning public.notification_events.notification_id
  )
  select c.id, c.notification_id, c.recipient_address, n.title, n.message
  from claimed c
  join public.notifications n on n.id = c.notification_id
  order by c.id;
end;
$$;
revoke all on function public.claim_notification_email_deliveries(uuid, integer) from public;
grant execute on function public.claim_notification_email_deliveries(uuid, integer)
  to service_role;

create or replace function public.finalize_notification_email_delivery(
  p_delivery_id uuid,
  p_claim_token uuid,
  p_succeeded boolean,
  p_provider_message_id text default null,
  p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_delivery public.notification_deliveries%rowtype;
begin
  select * into v_delivery from public.notification_deliveries
  where id = p_delivery_id for update;
  if not found then raise exception 'Email delivery not found'; end if;
  if v_delivery.status = 'delivered' and p_succeeded then return; end if;
  if v_delivery.status <> 'processing' or v_delivery.claim_token <> p_claim_token then
    raise exception 'Email delivery claim is stale';
  end if;
  if not p_succeeded and (p_error is null or length(btrim(p_error)) = 0) then
    raise exception 'Delivery error is required';
  end if;

  update public.notification_deliveries set
    status = case
      when p_succeeded then 'delivered'::public.notification_delivery_status
      else 'failed'::public.notification_delivery_status
    end,
    delivered_at = case when p_succeeded then now() else null end,
    failed_at = case when p_succeeded then null else now() end,
    provider_message_id = nullif(btrim(p_provider_message_id), ''),
    last_error = case when p_succeeded then null else left(btrim(p_error), 500) end
  where id = p_delivery_id;

  insert into public.notification_events (
    notification_id, event_type, metadata, idempotency_key
  ) values (
    v_delivery.notification_id,
    case
      when p_succeeded then 'delivery_delivered'::public.notification_event_type
      else 'delivery_failed'::public.notification_event_type
    end,
    jsonb_build_object('channel', 'email', 'delivery_id', p_delivery_id),
    'delivery:' || p_delivery_id::text || ':attempt:' || v_delivery.attempt_count::text ||
      case when p_succeeded then ':delivered' else ':failed' end
  ) on conflict (idempotency_key) do nothing;
end;
$$;
revoke all on function public.finalize_notification_email_delivery(
  uuid, uuid, boolean, text, text
) from public;
grant execute on function public.finalize_notification_email_delivery(
  uuid, uuid, boolean, text, text
) to service_role;

create or replace function public.refresh_operational_notifications()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_role_id uuid;
  v_business_date date := (now() at time zone 'Asia/Manila')::date;
  v_local_time time := (now() at time zone 'Asia/Manila')::time;
  v_count integer := 0;
begin
  if auth.uid() is null
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Authentication required';
  end if;

  select id into v_role_id from public.roles where key = 'super_admin';

  for v_row in
    select ia.id, ia.branch_id, ia.item_id, ia.qty_on_hand, ii.name as item_name, ii.sku,
      b.name as branch_name
    from public.inventory_alerts ia
    join public.inventory_items ii on ii.id = ia.item_id
    join public.branches b on b.id = ia.branch_id
    where ia.status = 'active'
  loop
    perform public.raise_notification(
      'negative_inventory', 'Negative inventory · ' || v_row.sku,
      v_row.item_name || ' at ' || v_row.branch_name ||
        ' is below zero and requires immediate investigation.',
      'inventory_alert', v_row.id, v_row.sku,
      'negative-inventory:' || v_row.branch_id::text || ':' || v_row.item_id::text,
      null, v_row.branch_id, null
    );
    v_count := v_count + 1;
  end loop;

  for v_row in
    select il.id, il.branch_id, il.item_id, il.expiration_date,
      coalesce(il.lot_number, 'Unnumbered lot') as lot_number,
      ii.name as item_name, ii.sku, b.name as branch_name
    from public.inventory_lots il
    join public.inventory_items ii on ii.id = il.item_id
    join public.branches b on b.id = il.branch_id
    where il.qty_remaining > 0 and il.expiration_date < v_business_date
  loop
    perform public.raise_notification(
      'expired_lot', 'Expired lot · ' || v_row.sku,
      v_row.item_name || ' lot ' || v_row.lot_number || ' at ' || v_row.branch_name ||
        ' is expired and must be quarantined for disposal review.',
      'inventory_lot', v_row.id, v_row.lot_number,
      'expired-lot:' || v_row.id::text, null, v_row.branch_id, null
    );
    v_count := v_count + 1;
  end loop;

  if v_local_time >= time '10:00' then
    for v_row in
      select b.id, b.name
      from public.branches b
      where b.active and b.deleted_at is null
        and not exists (
          select 1 from public.recount_sessions rs
          where rs.branch_id = b.id and rs.business_date = v_business_date
            and rs.type = 'start_of_day' and rs.status in ('adjusted', 'closed')
        )
    loop
      perform public.raise_notification(
        'overdue_recount', 'Start-of-day recount overdue',
        v_row.name || ' has not completed today''s required start-of-day recount.',
        'branch', v_row.id, v_row.name,
        'overdue-recount:' || v_row.id::text || ':' || v_business_date::text,
        null, v_row.id, null
      );
      v_count := v_count + 1;
    end loop;
  end if;

  for v_row in
    select rs.id, rs.reference, rs.branch_id, b.name as branch_name
    from public.recount_sessions rs
    join public.branches b on b.id = rs.branch_id
    where rs.status = 'submitted' and rs.is_unusual
  loop
    perform public.raise_notification(
      'unusual_recount', 'Unusual recount variance · ' || v_row.reference,
      v_row.branch_name || ' has a submitted recount variance requiring Super Admin review.',
      'recount_session', v_row.id, v_row.reference,
      'unusual-recount:' || v_row.id::text, v_role_id, null, null
    );
    v_count := v_count + 1;
  end loop;

  for v_row in
    select po.id, po.reference, po.branch_id, b.name as branch_name
    from public.production_orders po
    join public.branches b on b.id = po.branch_id
    where po.failed_at is not null
  loop
    perform public.raise_notification(
      'failed_production', 'Failed production · ' || v_row.reference,
      'Production at ' || v_row.branch_name || ' failed and requires investigation.',
      'production_order', v_row.id, v_row.reference,
      'failed-production:' || v_row.id::text, null, v_row.branch_id, null
    );
    v_count := v_count + 1;
  end loop;

  for v_row in
    select ib.item_id, ib.branch_id, ib.qty_on_hand, ii.name as item_name, ii.sku,
      ii.low_stock_threshold, ii.reorder_level, b.name as branch_name
    from public.inventory_balances ib
    join public.inventory_items ii on ii.id = ib.item_id
    join public.branches b on b.id = ib.branch_id
    where ii.active and ii.trackable and ii.deleted_at is null
      and (
        ib.qty_on_hand = 0
        or (ib.qty_on_hand > 0 and coalesce(ii.low_stock_threshold, ii.reorder_level) is not null
          and ib.qty_on_hand <= coalesce(ii.low_stock_threshold, ii.reorder_level))
      )
  loop
    if v_row.qty_on_hand = 0 then
      perform public.raise_notification(
        'out_of_stock', 'Out of stock · ' || v_row.sku,
        v_row.item_name || ' is out of stock at ' || v_row.branch_name || '.',
        'inventory_item', v_row.item_id, v_row.sku,
        'out-of-stock:' || v_row.branch_id::text || ':' || v_row.item_id::text,
        null, v_row.branch_id, null
      );
    else
      perform public.raise_notification(
        'low_stock', 'Low stock · ' || v_row.sku,
        v_row.item_name || ' is below its operating stock level at ' || v_row.branch_name || '.',
        'inventory_item', v_row.item_id, v_row.sku,
        'low-stock:' || v_row.branch_id::text || ':' || v_row.item_id::text,
        null, v_row.branch_id, null
      );
    end if;
    v_count := v_count + 1;
  end loop;

  for v_row in
    select sr.id, sr.reference, sr.requesting_branch_id, b.name as branch_name
    from public.stock_requests sr
    join public.branches b on b.id = sr.requesting_branch_id
    where sr.status in ('requested', 'approved')
  loop
    perform public.raise_notification(
      'pending_stock_request', 'Pending stock request · ' || v_row.reference,
      v_row.branch_name || ' has a stock request awaiting fulfillment.',
      'stock_request', v_row.id, v_row.reference,
      'pending-stock-request:' || v_row.id::text,
      null, v_row.requesting_branch_id, null
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('conditions_raised', v_count, 'business_date', v_business_date);
end;
$$;
revoke all on function public.refresh_operational_notifications() from public;
grant execute on function public.refresh_operational_notifications() to authenticated, service_role;

create or replace function public.tg_inventory_alert_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_item record;
  v_branch_name text;
  v_key text;
begin
  select name, sku into v_item from public.inventory_items where id = new.item_id;
  select name into v_branch_name from public.branches where id = new.branch_id;
  v_key := 'negative-inventory:' || new.branch_id::text || ':' || new.item_id::text;
  if new.status = 'active' then
    perform public.raise_notification(
      'negative_inventory', 'Negative inventory · ' || v_item.sku,
      v_item.name || ' at ' || v_branch_name ||
        ' is below zero and requires immediate investigation.',
      'inventory_alert', new.id, v_item.sku, v_key, null, new.branch_id, null
    );
  elsif old.status = 'active' and new.status = 'resolved' then
    perform public.resolve_notification(
      v_key, coalesce(new.resolution, 'Inventory alert resolved'),
      'inventory-alert-resolved:' || new.id::text
    );
  end if;
  return new;
end;
$$;
create trigger inventory_alert_notification
  after insert or update of status, qty_on_hand on public.inventory_alerts
  for each row execute function public.tg_inventory_alert_notification();

create or replace function public.get_dashboard_operational(
  p_start_date date default null,
  p_end_date date default null,
  p_branch_id uuid default null,
  p_category_id uuid default null,
  p_item_type public.item_type default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_start_date date := coalesce(p_start_date, (now() at time zone 'Asia/Manila')::date - 6);
  v_end_date date := coalesce(p_end_date, (now() at time zone 'Asia/Manila')::date);
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_today_start timestamptz;
  v_today_end timestamptz;
  v_branch_levels jsonb;
  v_most_used jsonb;
  v_recent jsonb;
  v_negative jsonb;
  v_failed jsonb;
  v_recounts jsonb;
  v_upcoming jsonb;
  v_summary jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if v_end_date < v_start_date then raise exception 'End date must not precede start date'; end if;
  if v_end_date - v_start_date > 366 then raise exception 'Date range cannot exceed 366 days'; end if;
  if p_branch_id is not null and not public.has_branch_access(v_user, p_branch_id) then
    raise exception 'Branch access denied';
  end if;

  v_start_at := v_start_date::timestamp at time zone 'Asia/Manila';
  v_end_at := (v_end_date + 1)::timestamp at time zone 'Asia/Manila';
  v_today_start := ((now() at time zone 'Asia/Manila')::date)::timestamp
    at time zone 'Asia/Manila';
  v_today_end := v_today_start + interval '1 day';

  select coalesce(jsonb_agg(row_value order by row_value->>'branch_name'), '[]'::jsonb)
    into v_branch_levels
  from (
    select jsonb_build_object(
      'branch_name', b.name,
      'tracked_items', count(*)::integer,
      'out_of_stock_items', count(*) filter (where ib.qty_on_hand = 0)::integer,
      'negative_items', count(*) filter (where ib.qty_on_hand < 0)::integer
    ) as row_value
    from public.inventory_balances ib
    join public.inventory_items ii on ii.id = ib.item_id
    join public.branches b on b.id = ib.branch_id
    where public.has_branch_access(v_user, ib.branch_id)
      and (p_branch_id is null or ib.branch_id = p_branch_id)
      and (p_category_id is null or ii.category_id = p_category_id)
      and (p_item_type is null or ii.item_type = p_item_type)
      and ii.active and ii.trackable and ii.deleted_at is null
    group by b.id, b.name
  ) rows;

  select coalesce(jsonb_agg(row_value order by (row_value->>'total_used')::numeric desc), '[]'::jsonb)
    into v_most_used
  from (
    select jsonb_build_object(
      'item_name', ii.name,
      'sku', ii.sku,
      'unit_code', u.code,
      'total_used', round(sum(abs(stl.qty)), 4)
    ) as row_value
    from public.stock_transaction_lines stl
    join public.stock_transactions st on st.id = stl.txn_id
    join public.inventory_items ii on ii.id = stl.item_id
    join public.units u on u.id = stl.unit_id
    where st.status = 'posted' and stl.qty < 0
      and st.created_at >= v_start_at and st.created_at < v_end_at
      and ii.item_type = 'raw_ingredient'
      and public.has_branch_access(v_user, coalesce(st.source_branch_id, st.dest_branch_id))
      and (p_branch_id is null
        or coalesce(st.source_branch_id, st.dest_branch_id) = p_branch_id)
      and (p_category_id is null or ii.category_id = p_category_id)
      and (p_item_type is null or ii.item_type = p_item_type)
    group by ii.id, ii.name, ii.sku, u.id, u.code
    order by sum(abs(stl.qty)) desc, ii.name
    limit 5
  ) rows;

  select coalesce(jsonb_agg(row_value order by row_value->>'created_at' desc), '[]'::jsonb)
    into v_recent
  from (
    select jsonb_build_object(
      'reference', st.reference,
      'type', st.type,
      'branch_name', coalesce(sb.name, db.name, 'Unassigned'),
      'item_name', ii.name,
      'sku', ii.sku,
      'quantity', stl.qty,
      'unit_code', u.code,
      'created_at', st.created_at
    ) as row_value
    from public.stock_transactions st
    join public.stock_transaction_lines stl on stl.txn_id = st.id
    join public.inventory_items ii on ii.id = stl.item_id
    join public.units u on u.id = stl.unit_id
    left join public.branches sb on sb.id = st.source_branch_id
    left join public.branches db on db.id = st.dest_branch_id
    where st.status = 'posted'
      and st.created_at >= v_start_at and st.created_at < v_end_at
      and public.has_branch_access(v_user, coalesce(st.source_branch_id, st.dest_branch_id))
      and (p_branch_id is null
        or coalesce(st.source_branch_id, st.dest_branch_id) = p_branch_id)
      and (p_category_id is null or ii.category_id = p_category_id)
      and (p_item_type is null or ii.item_type = p_item_type)
    order by st.created_at desc, st.id desc, stl.id
    limit 10
  ) rows;

  select coalesce(jsonb_agg(row_value order by row_value->>'created_at' desc), '[]'::jsonb)
    into v_negative
  from (
    select jsonb_build_object(
      'item_name', ii.name,
      'sku', ii.sku,
      'branch_name', b.name,
      'quantity', ia.qty_on_hand,
      'reason', ia.reason,
      'created_at', ia.created_at
    ) as row_value
    from public.inventory_alerts ia
    join public.inventory_items ii on ii.id = ia.item_id
    join public.branches b on b.id = ia.branch_id
    where ia.status = 'active'
      and public.has_branch_access(v_user, ia.branch_id)
      and (p_branch_id is null or ia.branch_id = p_branch_id)
      and (p_category_id is null or ii.category_id = p_category_id)
      and (p_item_type is null or ii.item_type = p_item_type)
    order by ia.created_at desc
    limit 10
  ) rows;

  select coalesce(jsonb_agg(row_value order by row_value->>'failed_at' desc), '[]'::jsonb)
    into v_failed
  from (
    select jsonb_build_object(
      'reference', po.reference,
      'branch_name', b.name,
      'output_name', ii.name,
      'output_sku', ii.sku,
      'failed_at', po.failed_at
    ) as row_value
    from public.production_orders po
    join public.inventory_items ii on ii.id = po.output_item_id
    join public.branches b on b.id = po.branch_id
    where po.failed_at is not null
      and po.failed_at >= v_start_at and po.failed_at < v_end_at
      and public.has_branch_access(v_user, po.branch_id)
      and (p_branch_id is null or po.branch_id = p_branch_id)
      and (p_category_id is null or ii.category_id = p_category_id)
      and (p_item_type is null or ii.item_type = p_item_type)
    order by po.failed_at desc
    limit 10
  ) rows;

  select coalesce(jsonb_agg(row_value order by row_value->>'submitted_at' desc), '[]'::jsonb)
    into v_recounts
  from (
    select jsonb_build_object(
      'reference', rs.reference,
      'branch_name', b.name,
      'type', rs.type,
      'is_unusual', rs.is_unusual,
      'submitted_at', rs.submitted_at
    ) as row_value
    from public.recount_sessions rs
    join public.branches b on b.id = rs.branch_id
    where rs.status = 'submitted'
      and rs.submitted_at >= v_start_at and rs.submitted_at < v_end_at
      and public.has_branch_access(v_user, rs.branch_id)
      and (p_branch_id is null or rs.branch_id = p_branch_id)
      and (
        (p_category_id is null and p_item_type is null)
        or exists (
          select 1 from public.recount_lines rl
          join public.inventory_items ii on ii.id = rl.item_id
          where rl.session_id = rs.id
            and (p_category_id is null or ii.category_id = p_category_id)
            and (p_item_type is null or ii.item_type = p_item_type)
        )
      )
    order by rs.submitted_at desc
    limit 10
  ) rows;

  select coalesce(jsonb_agg(row_value order by row_value->>'starts_at'), '[]'::jsonb)
    into v_upcoming
  from (
    select jsonb_build_object(
      'reference', ce.reference,
      'title', ce.title,
      'event_type', ce.event_type,
      'branch_name', b.name,
      'location', ce.location,
      'starts_at', ce.starts_at,
      'ends_at', ce.ends_at
    ) as row_value
    from public.calendar_events ce
    left join public.branches b on b.id = ce.branch_id
    where ce.status in ('scheduled', 'in_progress')
      and ce.ends_at >= now() and ce.starts_at < now() + interval '30 days'
      and public.can_view_calendar_event(v_user, ce.branch_id)
      and (p_branch_id is null or ce.branch_id = p_branch_id)
    order by ce.starts_at
    limit 10
  ) rows;

  select jsonb_build_object(
    'low_stock_count', count(*) filter (
      where ib.qty_on_hand > 0
        and coalesce(ii.low_stock_threshold, ii.reorder_level) is not null
        and ib.qty_on_hand <= coalesce(ii.low_stock_threshold, ii.reorder_level)
    )::integer,
    'out_of_stock_count', count(*) filter (where ib.qty_on_hand = 0)::integer,
    'negative_inventory_count', count(*) filter (where ib.qty_on_hand < 0)::integer,
    'todays_production_count', (
      select count(*)::integer from public.production_orders po
      join public.inventory_items poi on poi.id = po.output_item_id
      where po.status = 'completed'
        and po.confirmed_at >= v_today_start and po.confirmed_at < v_today_end
        and public.has_branch_access(v_user, po.branch_id)
        and (p_branch_id is null or po.branch_id = p_branch_id)
        and (p_category_id is null or poi.category_id = p_category_id)
        and (p_item_type is null or poi.item_type = p_item_type)
    ),
    'pending_request_count', (
      select count(*)::integer from public.stock_requests sr
      where sr.status in ('requested', 'approved')
        and public.has_branch_access(v_user, sr.requesting_branch_id)
        and (p_branch_id is null or sr.requesting_branch_id = p_branch_id)
    ),
    'failed_production_count', jsonb_array_length(v_failed),
    'recount_variance_count', jsonb_array_length(v_recounts),
    'upcoming_event_count', jsonb_array_length(v_upcoming)
  ) into v_summary
  from public.inventory_balances ib
  join public.inventory_items ii on ii.id = ib.item_id
  where public.has_branch_access(v_user, ib.branch_id)
    and (p_branch_id is null or ib.branch_id = p_branch_id)
    and (p_category_id is null or ii.category_id = p_category_id)
    and (p_item_type is null or ii.item_type = p_item_type)
    and ii.active and ii.trackable and ii.deleted_at is null;

  return jsonb_build_object(
    'filters', jsonb_build_object(
      'start_date', v_start_date, 'end_date', v_end_date,
      'branch_id', p_branch_id, 'category_id', p_category_id, 'item_type', p_item_type
    ),
    'summary', v_summary,
    'branch_stock_levels', v_branch_levels,
    'most_used_ingredients', v_most_used,
    'recent_movements', v_recent,
    'negative_inventory', v_negative,
    'failed_production', v_failed,
    'recount_variances', v_recounts,
    'upcoming_events', v_upcoming
  );
end;
$$;
revoke all on function public.get_dashboard_operational(
  date, date, uuid, uuid, public.item_type
) from public;
grant execute on function public.get_dashboard_operational(
  date, date, uuid, uuid, public.item_type
) to authenticated, service_role;

create or replace function public.get_dashboard_financials(
  p_branch_id uuid default null,
  p_category_id uuid default null,
  p_item_type public.item_type default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_value numeric(18,2);
  v_count integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not public.has_permission(v_user, 'cost.read') then
    raise exception 'Permission denied: cost.read required';
  end if;
  if p_branch_id is not null and not public.has_branch_access(v_user, p_branch_id) then
    raise exception 'Branch access denied';
  end if;

  select round(coalesce(sum(ib.qty_on_hand * ii.weighted_avg_cost), 0), 2), count(*)::integer
    into v_value, v_count
  from public.inventory_balances ib
  join public.inventory_items ii on ii.id = ib.item_id
  where public.has_branch_access(v_user, ib.branch_id)
    and (p_branch_id is null or ib.branch_id = p_branch_id)
    and (p_category_id is null or ii.category_id = p_category_id)
    and (p_item_type is null or ii.item_type = p_item_type)
    and ii.active and ii.trackable and ii.deleted_at is null;

  return jsonb_build_object('inventory_value', v_value, 'valued_item_count', v_count);
end;
$$;
revoke all on function public.get_dashboard_financials(
  uuid, uuid, public.item_type
) from public;
grant execute on function public.get_dashboard_financials(
  uuid, uuid, public.item_type
) to authenticated, service_role;

create or replace function public.create_calendar_event(
  p_title text,
  p_description text,
  p_location text,
  p_event_type public.calendar_event_type,
  p_branch_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_event public.calendar_events%rowtype;
  v_command public.calendar_event_commands%rowtype;
  v_audit_id uuid;
begin
  if v_user is null or not public.has_permission(v_user, 'calendar.manage') then
    raise exception 'Permission denied: calendar.manage required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  if p_title is null or length(btrim(p_title)) < 2 then
    raise exception 'Event title must be at least 2 characters';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Event end must be after its start';
  end if;
  if p_branch_id is not null and not public.has_branch_access(v_user, p_branch_id) then
    raise exception 'Branch access denied';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('calendar-create:' || p_idempotency_key, 0));
  select * into v_command from public.calendar_event_commands
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_command.command_type <> 'create' then
      raise exception 'Idempotency key belongs to another calendar command';
    end if;
    select * into v_event from public.calendar_events where id = v_command.event_id;
    return jsonb_build_object('event_id', v_event.id, 'reference', v_event.reference,
      'version', v_event.version, 'replayed', true);
  end if;

  insert into public.calendar_events (
    reference, title, description, location, event_type, branch_id, starts_at, ends_at,
    create_idempotency_key, created_by, updated_by
  ) values (
    public.next_calendar_event_reference(), btrim(p_title), nullif(btrim(p_description), ''),
    nullif(btrim(p_location), ''), p_event_type, p_branch_id, p_starts_at, p_ends_at,
    btrim(p_idempotency_key), v_user, v_user
  ) returning * into v_event;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, after, branch_id, correlation_id
  ) values (
    v_user, 'calendar.event_created', 'calendar_event', v_event.id::text,
    jsonb_build_object('reference', v_event.reference, 'title', v_event.title,
      'event_type', v_event.event_type, 'starts_at', v_event.starts_at,
      'ends_at', v_event.ends_at),
    v_event.branch_id, gen_random_uuid()
  ) returning id into v_audit_id;
  insert into public.calendar_event_commands (
    event_id, command_type, idempotency_key, resulting_version, actor_id, audit_log_id
  ) values (
    v_event.id, 'create', btrim(p_idempotency_key), v_event.version, v_user, v_audit_id
  );
  return jsonb_build_object('event_id', v_event.id, 'reference', v_event.reference,
    'version', v_event.version, 'replayed', false);
end;
$$;
revoke all on function public.create_calendar_event(
  text, text, text, public.calendar_event_type, uuid, timestamptz, timestamptz, text
) from public;
grant execute on function public.create_calendar_event(
  text, text, text, public.calendar_event_type, uuid, timestamptz, timestamptz, text
) to authenticated, service_role;

create or replace function public.update_calendar_event(
  p_event_id uuid,
  p_expected_version integer,
  p_title text,
  p_description text,
  p_location text,
  p_event_type public.calendar_event_type,
  p_status public.calendar_event_status,
  p_branch_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_event public.calendar_events%rowtype;
  v_command public.calendar_event_commands%rowtype;
  v_audit_id uuid;
  v_before jsonb;
  v_command_type public.calendar_command_type;
begin
  if v_user is null or not public.has_permission(v_user, 'calendar.manage') then
    raise exception 'Permission denied: calendar.manage required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  if p_title is null or length(btrim(p_title)) < 2 then
    raise exception 'Event title must be at least 2 characters';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Event end must be after its start';
  end if;
  if p_branch_id is not null and not public.has_branch_access(v_user, p_branch_id) then
    raise exception 'Branch access denied';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('calendar-update:' || p_idempotency_key, 0));
  select * into v_command from public.calendar_event_commands
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_command.command_type not in ('update', 'cancel') or v_command.event_id <> p_event_id then
      raise exception 'Idempotency key belongs to another calendar command';
    end if;
    select * into v_event from public.calendar_events where id = p_event_id;
    return jsonb_build_object('event_id', v_event.id, 'reference', v_event.reference,
      'version', v_event.version, 'replayed', true);
  end if;

  select * into v_event from public.calendar_events where id = p_event_id for update;
  if not found then raise exception 'Calendar event not found'; end if;
  if not public.can_view_calendar_event(v_user, v_event.branch_id) then
    raise exception 'Calendar event access denied';
  end if;
  if v_event.version <> p_expected_version then
    raise exception 'Calendar event changed; refresh before editing';
  end if;
  if v_event.status in ('completed', 'cancelled') then
    raise exception 'Completed or cancelled calendar events are immutable';
  end if;
  if exists (
    select 1 from public.popup_event_sessions pe where pe.calendar_event_id = p_event_id
  ) and (p_event_type <> 'popup' or p_status <> v_event.status) then
    raise exception 'Popup status and type must use the popup lifecycle';
  end if;
  if v_event.status = 'in_progress' and p_status = 'scheduled' then
    raise exception 'An in-progress event cannot return to scheduled';
  end if;

  v_before := jsonb_build_object('title', v_event.title, 'status', v_event.status,
    'starts_at', v_event.starts_at, 'ends_at', v_event.ends_at,
    'branch_id', v_event.branch_id, 'version', v_event.version);
  update public.calendar_events set
    title = btrim(p_title), description = nullif(btrim(p_description), ''),
    location = nullif(btrim(p_location), ''), event_type = p_event_type,
    status = p_status, branch_id = p_branch_id, starts_at = p_starts_at,
    ends_at = p_ends_at, updated_by = v_user
  where id = p_event_id
  returning * into v_event;
  v_command_type := case when p_status = 'cancelled' then 'cancel' else 'update' end;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before, after, branch_id, correlation_id
  ) values (
    v_user,
    case when v_command_type = 'cancel' then 'calendar.event_cancelled'
      else 'calendar.event_updated' end,
    'calendar_event', v_event.id::text, v_before,
    jsonb_build_object('title', v_event.title, 'status', v_event.status,
      'starts_at', v_event.starts_at, 'ends_at', v_event.ends_at,
      'branch_id', v_event.branch_id, 'version', v_event.version),
    v_event.branch_id, gen_random_uuid()
  ) returning id into v_audit_id;
  insert into public.calendar_event_commands (
    event_id, command_type, idempotency_key, resulting_version, actor_id, audit_log_id
  ) values (
    v_event.id, v_command_type, btrim(p_idempotency_key), v_event.version, v_user, v_audit_id
  );
  return jsonb_build_object('event_id', v_event.id, 'reference', v_event.reference,
    'version', v_event.version, 'replayed', false);
end;
$$;
revoke all on function public.update_calendar_event(
  uuid, integer, text, text, text, public.calendar_event_type,
  public.calendar_event_status, uuid, timestamptz, timestamptz, text
) from public;
grant execute on function public.update_calendar_event(
  uuid, integer, text, text, text, public.calendar_event_type,
  public.calendar_event_status, uuid, timestamptz, timestamptz, text
) to authenticated, service_role;

create or replace function public.create_popup_event(
  p_title text,
  p_description text,
  p_location text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_popup_branch_id uuid,
  p_return_branch_id uuid,
  p_notes text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_popup_branch public.branches%rowtype;
  v_return_branch public.branches%rowtype;
  v_popup public.popup_event_sessions%rowtype;
  v_command public.popup_event_commands%rowtype;
  v_calendar jsonb;
  v_calendar_id uuid;
  v_audit_id uuid;
begin
  if v_user is null or not public.has_permission(v_user, 'calendar.manage') then
    raise exception 'Permission denied: calendar.manage required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('popup-create:' || p_idempotency_key, 0));
  select * into v_command from public.popup_event_commands
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_command.command_type <> 'create' then
      raise exception 'Idempotency key belongs to another popup command';
    end if;
    select * into v_popup from public.popup_event_sessions
    where id = v_command.popup_event_id;
    return jsonb_build_object('popup_event_id', v_popup.id, 'reference', v_popup.reference,
      'calendar_event_id', v_popup.calendar_event_id, 'version', v_popup.version,
      'replayed', true);
  end if;

  select * into v_popup_branch from public.branches
  where id = p_popup_branch_id and active and deleted_at is null;
  if not found or v_popup_branch.key <> 'popup' then
    raise exception 'The permanent Zombeans Popup branch is required';
  end if;
  select * into v_return_branch from public.branches
  where id = p_return_branch_id and active and deleted_at is null;
  if not found or not v_return_branch.is_main then
    raise exception 'The active Main branch is required for popup returns';
  end if;
  if not public.has_branch_access(v_user, p_popup_branch_id)
     or not public.has_branch_access(v_user, p_return_branch_id) then
    raise exception 'Branch access denied';
  end if;

  v_calendar := public.create_calendar_event(
    p_title, p_description, p_location, 'popup', p_popup_branch_id,
    p_starts_at, p_ends_at, btrim(p_idempotency_key) || ':calendar'
  );
  v_calendar_id := (v_calendar->>'event_id')::uuid;
  insert into public.popup_event_sessions (
    reference, calendar_event_id, popup_branch_id, return_branch_id, notes,
    create_idempotency_key, created_by, updated_by
  ) values (
    public.next_popup_event_reference(), v_calendar_id, p_popup_branch_id, p_return_branch_id,
    nullif(btrim(p_notes), ''), btrim(p_idempotency_key), v_user, v_user
  ) returning * into v_popup;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, after, branch_id, correlation_id
  ) values (
    v_user, 'popup.event_created', 'popup_event', v_popup.id::text,
    jsonb_build_object('reference', v_popup.reference,
      'calendar_reference', v_calendar->>'reference', 'status', v_popup.status),
    v_popup.popup_branch_id, gen_random_uuid()
  ) returning id into v_audit_id;
  insert into public.popup_event_commands (
    popup_event_id, command_type, idempotency_key, resulting_version, actor_id, audit_log_id
  ) values (
    v_popup.id, 'create', btrim(p_idempotency_key), v_popup.version, v_user, v_audit_id
  );
  return jsonb_build_object('popup_event_id', v_popup.id, 'reference', v_popup.reference,
    'calendar_event_id', v_popup.calendar_event_id, 'version', v_popup.version,
    'replayed', false);
end;
$$;
revoke all on function public.create_popup_event(
  text, text, text, timestamptz, timestamptz, uuid, uuid, text, text
) from public;
grant execute on function public.create_popup_event(
  text, text, text, timestamptz, timestamptz, uuid, uuid, text, text
) to authenticated, service_role;

create or replace function public.start_popup_event(
  p_popup_event_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_popup public.popup_event_sessions%rowtype;
  v_command public.popup_event_commands%rowtype;
  v_audit_id uuid;
begin
  if v_user is null or not public.has_permission(v_user, 'calendar.manage') then
    raise exception 'Permission denied: calendar.manage required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('popup-start:' || p_idempotency_key, 0));
  select * into v_command from public.popup_event_commands
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_command.command_type <> 'start' or v_command.popup_event_id <> p_popup_event_id then
      raise exception 'Idempotency key belongs to another popup command';
    end if;
    select * into v_popup from public.popup_event_sessions where id = p_popup_event_id;
    return jsonb_build_object('popup_event_id', v_popup.id, 'reference', v_popup.reference,
      'status', v_popup.status, 'version', v_popup.version, 'replayed', true);
  end if;

  select * into v_popup from public.popup_event_sessions
  where id = p_popup_event_id for update;
  if not found then raise exception 'Popup event not found'; end if;
  if v_popup.status <> 'planned' then raise exception 'Popup event must be planned'; end if;
  if not public.has_branch_access(v_user, v_popup.popup_branch_id)
     or not public.has_branch_access(v_user, v_popup.return_branch_id) then
    raise exception 'Branch access denied';
  end if;

  update public.popup_event_sessions set
    status = 'in_progress', started_at = now(), started_by = v_user, updated_by = v_user
  where id = p_popup_event_id returning * into v_popup;
  update public.calendar_events set status = 'in_progress', updated_by = v_user
  where id = v_popup.calendar_event_id;
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before, after, branch_id, correlation_id
  ) values (
    v_user, 'popup.event_started', 'popup_event', v_popup.id::text,
    jsonb_build_object('status', 'planned'),
    jsonb_build_object('reference', v_popup.reference, 'status', v_popup.status),
    v_popup.popup_branch_id, gen_random_uuid()
  ) returning id into v_audit_id;
  insert into public.popup_event_commands (
    popup_event_id, command_type, idempotency_key, resulting_version, actor_id, audit_log_id
  ) values (
    v_popup.id, 'start', btrim(p_idempotency_key), v_popup.version, v_user, v_audit_id
  );
  return jsonb_build_object('popup_event_id', v_popup.id, 'reference', v_popup.reference,
    'status', v_popup.status, 'version', v_popup.version, 'replayed', false);
end;
$$;
revoke all on function public.start_popup_event(uuid, text) from public;
grant execute on function public.start_popup_event(uuid, text) to authenticated, service_role;

create or replace function public.cancel_popup_event(
  p_popup_event_id uuid,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_popup public.popup_event_sessions%rowtype;
  v_command public.popup_event_commands%rowtype;
  v_audit_id uuid;
  v_old_status public.popup_event_status;
begin
  if v_user is null or not public.has_permission(v_user, 'calendar.manage') then
    raise exception 'Permission denied: calendar.manage required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Cancellation reason must be at least 3 characters';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('popup-cancel:' || p_idempotency_key, 0));
  select * into v_command from public.popup_event_commands
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_command.command_type <> 'cancel' or v_command.popup_event_id <> p_popup_event_id then
      raise exception 'Idempotency key belongs to another popup command';
    end if;
    select * into v_popup from public.popup_event_sessions where id = p_popup_event_id;
    return jsonb_build_object('popup_event_id', v_popup.id, 'reference', v_popup.reference,
      'status', v_popup.status, 'version', v_popup.version, 'replayed', true);
  end if;

  select * into v_popup from public.popup_event_sessions
  where id = p_popup_event_id for update;
  if not found then raise exception 'Popup event not found'; end if;
  if v_popup.status in ('completed', 'cancelled') then
    raise exception 'Completed or cancelled popup events are immutable';
  end if;
  v_old_status := v_popup.status;
  update public.popup_event_sessions set
    status = 'cancelled', updated_by = v_user
  where id = p_popup_event_id returning * into v_popup;
  update public.calendar_events set status = 'cancelled', updated_by = v_user
  where id = v_popup.calendar_event_id;
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before, after, reason, branch_id, correlation_id
  ) values (
    v_user, 'popup.event_cancelled', 'popup_event', v_popup.id::text,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('reference', v_popup.reference, 'status', v_popup.status),
    btrim(p_reason), v_popup.popup_branch_id, gen_random_uuid()
  ) returning id into v_audit_id;
  insert into public.popup_event_commands (
    popup_event_id, command_type, idempotency_key, resulting_version, actor_id, audit_log_id
  ) values (
    v_popup.id, 'cancel', btrim(p_idempotency_key), v_popup.version, v_user, v_audit_id
  );
  return jsonb_build_object('popup_event_id', v_popup.id, 'reference', v_popup.reference,
    'status', v_popup.status, 'version', v_popup.version, 'replayed', false);
end;
$$;
revoke all on function public.cancel_popup_event(uuid, text, text) from public;
grant execute on function public.cancel_popup_event(uuid, text, text)
  to authenticated, service_role;

create or replace function public.link_popup_transfer(
  p_popup_event_id uuid,
  p_transfer_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_popup public.popup_event_sessions%rowtype;
  v_transfer public.transfers%rowtype;
  v_command public.popup_event_commands%rowtype;
  v_audit_action text;
  v_audit_id uuid;
  v_movement_type public.popup_movement_type;
begin
  if v_user is null or not public.has_permission(v_user, 'calendar.manage') then
    raise exception 'Permission denied: calendar.manage required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('popup-transfer:' || p_idempotency_key, 0));
  select * into v_command from public.popup_event_commands
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    select action into v_audit_action from public.audit_logs where id = v_command.audit_log_id;
    if v_command.command_type <> 'link_movement'
       or v_command.popup_event_id <> p_popup_event_id
       or v_audit_action <> 'popup.transfer_linked' then
      raise exception 'Idempotency key belongs to another popup command';
    end if;
    return jsonb_build_object('popup_event_id', p_popup_event_id,
      'transfer_id', p_transfer_id, 'replayed', true);
  end if;

  select * into v_popup from public.popup_event_sessions
  where id = p_popup_event_id for update;
  if not found then raise exception 'Popup event not found'; end if;
  if v_popup.status in ('completed', 'cancelled') then
    raise exception 'Completed or cancelled popup events are immutable';
  end if;
  select * into v_transfer from public.transfers where id = p_transfer_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if v_transfer.popup_event_id is not null and v_transfer.popup_event_id <> p_popup_event_id then
    raise exception 'Transfer is linked to another popup event';
  end if;
  if v_transfer.source_branch_id = v_popup.return_branch_id
     and v_transfer.dest_branch_id = v_popup.popup_branch_id then
    v_movement_type := 'outbound_transfer';
  elsif v_transfer.source_branch_id = v_popup.popup_branch_id
        and v_transfer.dest_branch_id = v_popup.return_branch_id then
    v_movement_type := 'return_transfer';
  else
    raise exception 'Popup transfer must move between Main and the Popup branch';
  end if;
  if not public.has_branch_access(v_user, v_transfer.source_branch_id)
     or not public.has_branch_access(v_user, v_transfer.dest_branch_id) then
    raise exception 'Branch access denied';
  end if;

  update public.transfers set popup_event_id = p_popup_event_id where id = p_transfer_id;
  if v_transfer.status = 'received' then
    insert into public.popup_event_movements (
      popup_event_id, item_id, movement_type, quantity, transfer_id, created_by
    )
    select p_popup_event_id, tl.item_id, v_movement_type, tl.received_qty, p_transfer_id, v_user
    from public.transfer_lines tl
    where tl.transfer_id = p_transfer_id and tl.received_qty > 0
    on conflict do nothing;
  end if;
  update public.popup_event_sessions set updated_by = v_user
  where id = p_popup_event_id returning * into v_popup;
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, after, branch_id, correlation_id
  ) values (
    v_user, 'popup.transfer_linked', 'popup_event', v_popup.id::text,
    jsonb_build_object('reference', v_popup.reference,
      'transfer_reference', v_transfer.reference, 'movement_type', v_movement_type),
    v_popup.popup_branch_id, gen_random_uuid()
  ) returning id into v_audit_id;
  insert into public.popup_event_commands (
    popup_event_id, command_type, idempotency_key, resulting_version, actor_id, audit_log_id
  ) values (
    v_popup.id, 'link_movement', btrim(p_idempotency_key), v_popup.version,
    v_user, v_audit_id
  );
  return jsonb_build_object('popup_event_id', v_popup.id,
    'transfer_id', p_transfer_id, 'movement_type', v_movement_type,
    'version', v_popup.version, 'replayed', false);
end;
$$;
revoke all on function public.link_popup_transfer(uuid, uuid, text) from public;
grant execute on function public.link_popup_transfer(uuid, uuid, text)
  to authenticated, service_role;

create or replace function public.link_popup_stock_movement(
  p_popup_event_id uuid,
  p_stock_txn_id uuid,
  p_movement_type public.popup_movement_type,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_popup public.popup_event_sessions%rowtype;
  v_txn public.stock_transactions%rowtype;
  v_command public.popup_event_commands%rowtype;
  v_audit_action text;
  v_audit_id uuid;
  v_line_count integer;
begin
  if v_user is null or not public.has_permission(v_user, 'calendar.manage') then
    raise exception 'Permission denied: calendar.manage required';
  end if;
  if p_movement_type not in ('consumed', 'waste', 'loss', 'gain') then
    raise exception 'A popup stock movement must be consumed, waste, loss, or gain';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('popup-stock-link:' || p_idempotency_key, 0));
  select * into v_command from public.popup_event_commands
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    select action into v_audit_action from public.audit_logs where id = v_command.audit_log_id;
    if v_command.command_type <> 'link_movement'
       or v_command.popup_event_id <> p_popup_event_id
       or v_audit_action <> 'popup.stock_movement_linked' then
      raise exception 'Idempotency key belongs to another popup command';
    end if;
    return jsonb_build_object('popup_event_id', p_popup_event_id,
      'stock_txn_id', p_stock_txn_id, 'replayed', true);
  end if;

  select * into v_popup from public.popup_event_sessions
  where id = p_popup_event_id for update;
  if not found then raise exception 'Popup event not found'; end if;
  if v_popup.status not in ('in_progress', 'reconciling') then
    raise exception 'Popup event must be in progress or reconciling';
  end if;
  select * into v_txn from public.stock_transactions where id = p_stock_txn_id;
  if not found or v_txn.status <> 'posted' then raise exception 'Posted stock movement not found'; end if;

  if p_movement_type = 'gain' then
    if v_txn.dest_branch_id <> v_popup.popup_branch_id
       or v_txn.type not in ('stock_in', 'batch_stock_in', 'manual_adjustment', 'recount_adjustment')
       or exists (
         select 1 from public.stock_transaction_lines stl
         where stl.txn_id = v_txn.id and stl.qty <= 0
       ) then
      raise exception 'Gain must link a positive stock-in or adjustment at the Popup branch';
    end if;
  else
    if v_txn.source_branch_id <> v_popup.popup_branch_id
       or v_txn.type not in ('stock_out', 'batch_stock_out', 'waste', 'manual_adjustment', 'recount_adjustment')
       or exists (
         select 1 from public.stock_transaction_lines stl
         where stl.txn_id = v_txn.id and stl.qty >= 0
       ) then
      raise exception 'Consumed, waste, and loss must link a negative Popup branch movement';
    end if;
    if p_movement_type = 'waste' and v_txn.type <> 'waste' then
      raise exception 'Waste summary must link a waste transaction';
    end if;
  end if;

  insert into public.popup_event_movements (
    popup_event_id, item_id, movement_type, quantity, stock_txn_id, created_by
  )
  select p_popup_event_id, stl.item_id, p_movement_type, abs(stl.qty), p_stock_txn_id, v_user
  from public.stock_transaction_lines stl
  where stl.txn_id = p_stock_txn_id and stl.qty <> 0
  on conflict do nothing;
  get diagnostics v_line_count = row_count;
  if v_line_count = 0 then raise exception 'Stock movement is already linked or has no lines'; end if;

  update public.popup_event_sessions set updated_by = v_user
  where id = p_popup_event_id returning * into v_popup;
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, after, branch_id, correlation_id
  ) values (
    v_user, 'popup.stock_movement_linked', 'popup_event', v_popup.id::text,
    jsonb_build_object('reference', v_popup.reference,
      'stock_reference', v_txn.reference, 'movement_type', p_movement_type,
      'line_count', v_line_count),
    v_popup.popup_branch_id, gen_random_uuid()
  ) returning id into v_audit_id;
  insert into public.popup_event_commands (
    popup_event_id, command_type, idempotency_key, resulting_version, actor_id, audit_log_id
  ) values (
    v_popup.id, 'link_movement', btrim(p_idempotency_key), v_popup.version,
    v_user, v_audit_id
  );
  return jsonb_build_object('popup_event_id', v_popup.id,
    'stock_txn_id', p_stock_txn_id, 'movement_type', p_movement_type,
    'line_count', v_line_count, 'version', v_popup.version, 'replayed', false);
end;
$$;
revoke all on function public.link_popup_stock_movement(
  uuid, uuid, public.popup_movement_type, text
) from public;
grant execute on function public.link_popup_stock_movement(
  uuid, uuid, public.popup_movement_type, text
) to authenticated, service_role;

create or replace function public.record_popup_event_count(
  p_popup_event_id uuid,
  p_lines jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_popup public.popup_event_sessions%rowtype;
  v_command public.popup_event_commands%rowtype;
  v_line jsonb;
  v_item_id uuid;
  v_unit_id uuid;
  v_audit_id uuid;
begin
  if v_user is null or not public.has_permission(v_user, 'calendar.manage') then
    raise exception 'Permission denied: calendar.manage required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one popup count line is required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) line
    group by line->>'item_id' having count(*) > 1
  ) then raise exception 'Duplicate popup count items are not allowed'; end if;

  perform pg_advisory_xact_lock(hashtextextended('popup-count:' || p_idempotency_key, 0));
  select * into v_command from public.popup_event_commands
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_command.command_type <> 'count' or v_command.popup_event_id <> p_popup_event_id then
      raise exception 'Idempotency key belongs to another popup command';
    end if;
    select * into v_popup from public.popup_event_sessions where id = p_popup_event_id;
    return jsonb_build_object('popup_event_id', v_popup.id, 'reference', v_popup.reference,
      'status', v_popup.status, 'version', v_popup.version, 'replayed', true);
  end if;

  select * into v_popup from public.popup_event_sessions
  where id = p_popup_event_id for update;
  if not found then raise exception 'Popup event not found'; end if;
  if v_popup.status not in ('in_progress', 'reconciling') then
    raise exception 'Popup event must be in progress or reconciling';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_item_id := (v_line->>'item_id')::uuid;
    v_unit_id := (v_line->>'unit_id')::uuid;
    if not exists (
      select 1 from public.inventory_items ii
      where ii.id = v_item_id and ii.base_unit_id = v_unit_id and ii.trackable
        and ii.active and ii.deleted_at is null
    ) then raise exception 'Popup count item or base unit is invalid'; end if;

    insert into public.popup_event_count_lines (
      popup_event_id, item_id, unit_id, transferred_in_qty, remaining_qty,
      returned_qty, consumed_qty, waste_qty, loss_qty, gain_qty, ending_qty, notes
    ) values (
      p_popup_event_id, v_item_id, v_unit_id,
      round(coalesce((v_line->>'transferred_in_qty')::numeric, 0), 4),
      round(coalesce((v_line->>'remaining_qty')::numeric, 0), 4),
      round(coalesce((v_line->>'returned_qty')::numeric, 0), 4),
      round(coalesce((v_line->>'consumed_qty')::numeric, 0), 4),
      round(coalesce((v_line->>'waste_qty')::numeric, 0), 4),
      round(coalesce((v_line->>'loss_qty')::numeric, 0), 4),
      round(coalesce((v_line->>'gain_qty')::numeric, 0), 4),
      round(coalesce((v_line->>'ending_qty')::numeric, 0), 4),
      nullif(btrim(v_line->>'notes'), '')
    ) on conflict (popup_event_id, item_id) do update set
      unit_id = excluded.unit_id,
      transferred_in_qty = excluded.transferred_in_qty,
      remaining_qty = excluded.remaining_qty,
      returned_qty = excluded.returned_qty,
      consumed_qty = excluded.consumed_qty,
      waste_qty = excluded.waste_qty,
      loss_qty = excluded.loss_qty,
      gain_qty = excluded.gain_qty,
      ending_qty = excluded.ending_qty,
      notes = excluded.notes;
  end loop;

  update public.popup_event_sessions set
    status = 'reconciling', counted_at = now(), counted_by = v_user, updated_by = v_user
  where id = p_popup_event_id returning * into v_popup;
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, after, branch_id, correlation_id
  ) values (
    v_user, 'popup.count_recorded', 'popup_event', v_popup.id::text,
    jsonb_build_object('reference', v_popup.reference, 'status', v_popup.status,
      'line_count', jsonb_array_length(p_lines)),
    v_popup.popup_branch_id, gen_random_uuid()
  ) returning id into v_audit_id;
  insert into public.popup_event_commands (
    popup_event_id, command_type, idempotency_key, resulting_version, actor_id, audit_log_id
  ) values (
    v_popup.id, 'count', btrim(p_idempotency_key), v_popup.version, v_user, v_audit_id
  );
  return jsonb_build_object('popup_event_id', v_popup.id, 'reference', v_popup.reference,
    'status', v_popup.status, 'version', v_popup.version, 'replayed', false);
end;
$$;
revoke all on function public.record_popup_event_count(uuid, jsonb, text) from public;
grant execute on function public.record_popup_event_count(uuid, jsonb, text)
  to authenticated, service_role;

create or replace function public.complete_popup_event(
  p_popup_event_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_popup public.popup_event_sessions%rowtype;
  v_command public.popup_event_commands%rowtype;
  v_audit_id uuid;
begin
  if v_user is null or not public.has_permission(v_user, 'calendar.manage') then
    raise exception 'Permission denied: calendar.manage required';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('popup-complete:' || p_idempotency_key, 0));
  select * into v_command from public.popup_event_commands
  where idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_command.command_type <> 'complete' or v_command.popup_event_id <> p_popup_event_id then
      raise exception 'Idempotency key belongs to another popup command';
    end if;
    select * into v_popup from public.popup_event_sessions where id = p_popup_event_id;
    return jsonb_build_object('popup_event_id', v_popup.id, 'reference', v_popup.reference,
      'status', v_popup.status, 'version', v_popup.version, 'replayed', true);
  end if;

  select * into v_popup from public.popup_event_sessions
  where id = p_popup_event_id for update;
  if not found then raise exception 'Popup event not found'; end if;
  if v_popup.status <> 'reconciling' then
    raise exception 'Popup event must be reconciling before completion';
  end if;
  if exists (
    select 1 from public.transfers t
    where t.popup_event_id = p_popup_event_id and t.status not in ('received', 'cancelled')
  ) then raise exception 'All linked popup transfers must be received or cancelled'; end if;

  -- Freeze transfer effects into the event movement links after final receiving counts exist.
  insert into public.popup_event_movements (
    popup_event_id, item_id, movement_type, quantity, transfer_id, created_by
  )
  select p_popup_event_id, tl.item_id,
    case when t.source_branch_id = v_popup.return_branch_id
      then 'outbound_transfer'::public.popup_movement_type
      else 'return_transfer'::public.popup_movement_type end,
    tl.received_qty, t.id, v_user
  from public.transfers t
  join public.transfer_lines tl on tl.transfer_id = t.id
  where t.popup_event_id = p_popup_event_id and t.status = 'received' and tl.received_qty > 0
  on conflict do nothing;

  if not exists (
    select 1 from public.popup_event_count_lines where popup_event_id = p_popup_event_id
  ) then raise exception 'Popup inventory count is required'; end if;
  if exists (
    select 1 from public.popup_event_count_lines
    where popup_event_id = p_popup_event_id and ending_qty <> 0
  ) then raise exception 'All remaining popup stock must be returned before completion'; end if;
  if exists (
    select 1
    from public.popup_event_movements pem
    where pem.popup_event_id = p_popup_event_id
      and not exists (
        select 1 from public.popup_event_count_lines pcl
        where pcl.popup_event_id = p_popup_event_id and pcl.item_id = pem.item_id
      )
  ) then raise exception 'Every linked movement item requires a popup count line'; end if;
  if exists (
    select 1
    from public.popup_event_count_lines pcl
    left join lateral (
      select
        coalesce(sum(pem.quantity) filter (
          where pem.movement_type = 'outbound_transfer'
        ), 0) as transferred_in_qty,
        coalesce(sum(pem.quantity) filter (
          where pem.movement_type = 'return_transfer'
        ), 0) as returned_qty,
        coalesce(sum(pem.quantity) filter (where pem.movement_type = 'consumed'), 0)
          as consumed_qty,
        coalesce(sum(pem.quantity) filter (where pem.movement_type = 'waste'), 0)
          as waste_qty,
        coalesce(sum(pem.quantity) filter (where pem.movement_type = 'loss'), 0)
          as loss_qty,
        coalesce(sum(pem.quantity) filter (where pem.movement_type = 'gain'), 0)
          as gain_qty
      from public.popup_event_movements pem
      where pem.popup_event_id = pcl.popup_event_id and pem.item_id = pcl.item_id
    ) linked on true
    where pcl.popup_event_id = p_popup_event_id
      and (
        pcl.transferred_in_qty <> round(linked.transferred_in_qty, 4)
        or pcl.returned_qty <> round(linked.returned_qty, 4)
        or pcl.consumed_qty <> round(linked.consumed_qty, 4)
        or pcl.waste_qty <> round(linked.waste_qty, 4)
        or pcl.loss_qty <> round(linked.loss_qty, 4)
        or pcl.gain_qty <> round(linked.gain_qty, 4)
      )
  ) then raise exception 'Popup summary quantities must match linked ledger movements'; end if;

  update public.popup_event_sessions set
    status = 'completed', completed_at = now(), completed_by = v_user, updated_by = v_user
  where id = p_popup_event_id returning * into v_popup;
  update public.calendar_events set status = 'completed', updated_by = v_user
  where id = v_popup.calendar_event_id;
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before, after, branch_id, correlation_id
  ) values (
    v_user, 'popup.event_completed', 'popup_event', v_popup.id::text,
    jsonb_build_object('status', 'reconciling'),
    jsonb_build_object('reference', v_popup.reference, 'status', v_popup.status,
      'line_count', (select count(*) from public.popup_event_count_lines
        where popup_event_id = p_popup_event_id)),
    v_popup.popup_branch_id, gen_random_uuid()
  ) returning id into v_audit_id;
  insert into public.popup_event_commands (
    popup_event_id, command_type, idempotency_key, resulting_version, actor_id, audit_log_id
  ) values (
    v_popup.id, 'complete', btrim(p_idempotency_key), v_popup.version, v_user, v_audit_id
  );
  return jsonb_build_object('popup_event_id', v_popup.id, 'reference', v_popup.reference,
    'status', v_popup.status, 'version', v_popup.version, 'replayed', false);
end;
$$;
revoke all on function public.complete_popup_event(uuid, text) from public;
grant execute on function public.complete_popup_event(uuid, text)
  to authenticated, service_role;

create or replace function public.mark_production_failed(
  p_order_id uuid,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_order public.production_orders%rowtype;
  v_existing public.production_orders%rowtype;
  v_branch_name text;
begin
  if v_user is null or not (
    public.has_permission(v_user, 'production.record')
    or public.has_permission(v_user, 'production.confirm')
  ) then raise exception 'Permission denied: production.record or production.confirm required'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'Failure reason must be at least 3 characters';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'Idempotency key is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('production-failed:' || p_idempotency_key, 0));
  select * into v_existing from public.production_orders
  where failure_idempotency_key = btrim(p_idempotency_key);
  if found then
    if v_existing.id <> p_order_id then
      raise exception 'Idempotency key belongs to another production order';
    end if;
    return jsonb_build_object('order_id', v_existing.id, 'reference', v_existing.reference,
      'failed_at', v_existing.failed_at, 'replayed', true);
  end if;

  select * into v_order from public.production_orders where id = p_order_id for update;
  if not found then raise exception 'Production order not found'; end if;
  if not public.has_branch_access(v_user, v_order.branch_id) then
    raise exception 'Branch access denied';
  end if;
  if v_order.status in ('completed', 'cancelled') then
    raise exception 'Completed or cancelled production orders are immutable';
  end if;

  update public.production_orders set
    status = 'cancelled', failed_at = now(), failed_by = v_user,
    failure_reason = btrim(p_reason), failure_idempotency_key = btrim(p_idempotency_key),
    updated_by = v_user
  where id = p_order_id returning * into v_order;
  select name into v_branch_name from public.branches where id = v_order.branch_id;
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, before, after, reason, branch_id, correlation_id
  ) values (
    v_user, 'production.failed', 'production_order', v_order.id::text,
    jsonb_build_object('status', case when v_order.started_at is null then 'draft'
      else 'in_progress' end),
    jsonb_build_object('reference', v_order.reference, 'status', v_order.status,
      'failed_at', v_order.failed_at),
    btrim(p_reason), v_order.branch_id, v_order.correlation_id
  );
  perform public.raise_notification(
    'failed_production', 'Failed production · ' || v_order.reference,
    'Production at ' || v_branch_name || ' failed and requires investigation.',
    'production_order', v_order.id, v_order.reference,
    'failed-production:' || v_order.id::text, null, v_order.branch_id, null
  );
  return jsonb_build_object('order_id', v_order.id, 'reference', v_order.reference,
    'failed_at', v_order.failed_at, 'replayed', false);
end;
$$;
revoke all on function public.mark_production_failed(uuid, text, text) from public;
grant execute on function public.mark_production_failed(uuid, text, text)
  to authenticated, service_role;
