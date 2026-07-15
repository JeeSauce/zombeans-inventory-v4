-- 0038 — pin search_path on INVOKER trigger functions
--
-- The four trigger functions below run with the invoker's rights (no SECURITY DEFINER),
-- so migration 0036's definer hardening did not cover them. Supabase's advisor still flags
-- them as `function_search_path_mutable`. Pinning `search_path = ''` closes that WARN: every
-- object they touch is already schema-qualified (public.profiles, public.roles) or a
-- pg_catalog builtin (now()), which resolves regardless of search_path, so behaviour is
-- unchanged. Recreated with the exact original bodies plus the pinned setting.

-- ── updated_at / version bump (0001) ─────────────────────────────────────────
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$$;

-- ── updated_at only, no version column (0026) ────────────────────────────────
create or replace function public.tg_set_updated_at_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── protect the original Super Admin from disable/delete/demote (0002) ────────
create or replace function public.tg_protect_super_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_protected then
      raise exception 'Protected Super Admin cannot be deleted';
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if old.is_protected then
      if new.is_protected = false then
        raise exception 'Protected flag on the Super Admin cannot be removed';
      end if;
      if new.status = 'disabled' then
        raise exception 'Protected Super Admin cannot be disabled';
      end if;
    end if;
    return new;
  end if;
  return null;
end;
$$;

-- ── prevent removing super_admin role from a protected profile (0002) ─────────
create or replace function public.tg_protect_super_admin_role()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  is_protected_super boolean;
  role_key text;
begin
  select p.is_protected into is_protected_super from public.profiles p where p.id = old.profile_id;
  select r.key into role_key from public.roles r where r.id = old.role_id;
  if is_protected_super and role_key = 'super_admin' then
    raise exception 'Cannot remove the super_admin role from the protected Super Admin';
  end if;
  return old;
end;
$$;
