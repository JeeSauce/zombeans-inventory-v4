-- 0003_identity_rls.sql
-- Permission helpers + Row Level Security for the identity domain.
-- Helpers are SECURITY DEFINER so they read role tables without tripping RLS recursion.

-- ── Helper functions ─────────────────────────────────────────────────────────
create or replace function public.has_permission(uid uuid, perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions pm on pm.id = rp.permission_id
    where ur.profile_id = uid
      and pm.slug = perm
  );
$$;

create or replace function public.is_super_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.profile_id = uid
      and r.key = 'super_admin'
  );
$$;

-- Permissions of the currently authenticated user (for UI `can()` checks).
create or replace function public.current_permissions()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct pm.slug
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions pm on pm.id = rp.permission_id
  where ur.profile_id = auth.uid();
$$;

grant execute on function public.current_permissions() to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;
grant execute on function public.is_super_admin(uuid) to authenticated;

-- Guard: only users.manage holders may change is_protected/status (blocks self-escalation).
create or replace function public.tg_guard_privileged_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only applies to real authenticated users. Service-role / DB-superuser contexts (auth.uid()
  -- is null) are trusted and pass through to the protected-Super-Admin trigger.
  if auth.uid() is not null
     and (new.is_protected is distinct from old.is_protected
          or new.status is distinct from old.status)
     and not public.has_permission(auth.uid(), 'users.manage') then
    raise exception 'Only users.manage holders may change protected/status fields';
  end if;
  return new;
end;
$$;

create trigger guard_privileged_profile_fields before update on public.profiles
  for each row execute function public.tg_guard_privileged_profile_fields();

-- ── Table privileges ─────────────────────────────────────────────────────────
-- Supabase's `authenticated` role gets no DML by default on postgres-owned tables. Grant it
-- explicitly and let RLS filter rows. email_code_challenges gets NOTHING (service-role only).
grant select, insert, update, delete on
  public.profiles, public.roles, public.permissions, public.role_permissions, public.user_roles
  to authenticated;
grant select on public.audit_logs to authenticated;  -- append-only: no insert/update/delete

-- The service role (BYPASSRLS backend client) still needs explicit table grants. It owns the
-- privileged paths: issuing/verifying step-up codes, creating accounts, writing audit rows.
grant select, insert, update, delete on
  public.profiles, public.roles, public.permissions, public.role_permissions,
  public.user_roles, public.email_code_challenges, public.audit_logs
  to service_role;

-- ── Enable RLS ───────────────────────────────────────────────────────────────
alter table public.profiles              enable row level security;
alter table public.roles                 enable row level security;
alter table public.permissions           enable row level security;
alter table public.role_permissions      enable row level security;
alter table public.user_roles            enable row level security;
alter table public.email_code_challenges enable row level security;
alter table public.audit_logs            enable row level security;

-- ── profiles ─────────────────────────────────────────────────────────────────
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_permission(auth.uid(), 'users.manage'));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (public.has_permission(auth.uid(), 'users.manage'));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.has_permission(auth.uid(), 'users.manage'))
  with check (id = auth.uid() or public.has_permission(auth.uid(), 'users.manage'));
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.has_permission(auth.uid(), 'users.manage'));

-- ── roles / permissions / role_permissions (admin-managed) ───────────────────
create policy roles_select on public.roles for select to authenticated
  using (public.has_permission(auth.uid(), 'roles.manage'));
create policy roles_write on public.roles for all to authenticated
  using (public.has_permission(auth.uid(), 'roles.manage'))
  with check (public.has_permission(auth.uid(), 'roles.manage'));

create policy permissions_select on public.permissions for select to authenticated
  using (public.has_permission(auth.uid(), 'roles.manage'));
create policy permissions_write on public.permissions for all to authenticated
  using (public.has_permission(auth.uid(), 'roles.manage'))
  with check (public.has_permission(auth.uid(), 'roles.manage'));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (public.has_permission(auth.uid(), 'roles.manage'));
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (public.has_permission(auth.uid(), 'roles.manage'))
  with check (public.has_permission(auth.uid(), 'roles.manage'));

-- ── user_roles ───────────────────────────────────────────────────────────────
create policy user_roles_select on public.user_roles for select to authenticated
  using (profile_id = auth.uid() or public.has_permission(auth.uid(), 'users.manage'));
create policy user_roles_write on public.user_roles for all to authenticated
  using (public.has_permission(auth.uid(), 'users.manage'))
  with check (public.has_permission(auth.uid(), 'users.manage'));

-- ── email_code_challenges: no policies ⇒ deny all to anon/authenticated. ──────
-- Only the service-role admin client and SECURITY DEFINER functions may touch it.

-- ── audit_logs: readable by audit.read; never writable/updatable via the API. ─
create policy audit_select on public.audit_logs for select to authenticated
  using (public.has_permission(auth.uid(), 'audit.read'));
-- (no insert/update/delete policies: writes go through the service role / definer functions;
--  the table is append-only — updates and deletes are never permitted through RLS.)
