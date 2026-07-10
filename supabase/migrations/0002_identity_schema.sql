-- 0002_identity_schema.sql
-- Identity & Access domain: profiles, roles, permissions, assignments, step-up challenges, audit.
-- RLS is enabled in 0003; reference data seeded in 0004.

-- ── Enums ────────────────────────────────────────────────────────────────────
create type public.user_status as enum ('active', 'disabled');

-- ── profiles (1:1 with auth.users) ───────────────────────────────────────────
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         extensions.citext not null unique,
  full_name     text not null,
  status        public.user_status not null default 'active',
  is_protected  boolean not null default false,   -- original Super Admin cannot be deleted/disabled/demoted
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles (id),
  updated_by    uuid references public.profiles (id),
  version       integer not null default 1
);
comment on table public.profiles is 'Application user profile, 1:1 with auth.users.';

-- ── roles / permissions ──────────────────────────────────────────────────────
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,               -- e.g. super_admin, branch_manager
  name        text not null,
  is_system   boolean not null default false,     -- system roles cannot be deleted
  created_at  timestamptz not null default now()
);

create table public.permissions (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,              -- resource.action, e.g. cost.read
  description  text not null,
  is_sensitive boolean not null default false,
  created_at   timestamptz not null default now()
);

create table public.role_permissions (
  role_id       uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_roles (
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  role_id      uuid not null references public.roles (id) on delete restrict,
  assigned_by  uuid references public.profiles (id),
  assigned_at  timestamptz not null default now(),
  primary key (profile_id, role_id)
);
-- NOTE: user_branch_assignments arrives in Phase 2 (needs the branches table). Branch Manager
-- has global visibility in the MVP, so branch scoping is not exercised in Phase 1.

-- ── step-up email-code challenges (Super Admin verification) ──────────────────
create table public.email_code_challenges (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  purpose       text not null default 'super_admin_stepup',
  code_hash     text not null,                    -- SHA-256(code + pepper); plaintext NEVER stored
  expires_at    timestamptz not null,
  max_attempts  integer not null default 5,
  attempts      integer not null default 0,
  consumed_at   timestamptz,                      -- single-use
  request_ip    text,
  created_at    timestamptz not null default now()
);
create index on public.email_code_challenges (profile_id, created_at desc);

-- ── audit_logs (append-only) ─────────────────────────────────────────────────
create table public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid references public.profiles (id),  -- null for system actions
  action         text not null,
  entity_type    text not null,
  entity_id      text,
  before         jsonb,
  after          jsonb,
  reason         text,
  branch_id      uuid,                                   -- FK added in Phase 2
  request_ip     text,
  correlation_id uuid,
  created_at     timestamptz not null default now()
);
create index on public.audit_logs (created_at desc);
create index on public.audit_logs (entity_type, entity_id);
comment on table public.audit_logs is 'Append-only audit trail. No secrets/tokens/codes stored.';

-- ── updated_at / version triggers ────────────────────────────────────────────
create trigger set_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- ── auto-create a profile when an auth user is created ───────────────────────
-- The Super Admin server action / seed sets full_name & is_protected via user metadata.
create or replace function public.tg_handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.profiles (id, email, full_name, is_protected)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data ->> 'is_protected')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_handle_new_auth_user();

-- ── protect the original Super Admin from disable/delete/demote ───────────────
create or replace function public.tg_protect_super_admin()
returns trigger
language plpgsql
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

create trigger protect_super_admin_upd before update on public.profiles
  for each row execute function public.tg_protect_super_admin();
create trigger protect_super_admin_del before delete on public.profiles
  for each row execute function public.tg_protect_super_admin();

-- Prevent removing the super_admin role from a protected profile.
create or replace function public.tg_protect_super_admin_role()
returns trigger
language plpgsql
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

create trigger protect_super_admin_role before delete on public.user_roles
  for each row execute function public.tg_protect_super_admin_role();
