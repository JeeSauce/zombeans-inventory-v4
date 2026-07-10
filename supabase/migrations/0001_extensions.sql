-- 0001_extensions.sql
-- Base extensions. gen_random_uuid() is in Postgres core (pgcrypto also provides digest/crypt).
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

-- Shared trigger: keep updated_at fresh and bump the optimistic-concurrency version on every update.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$$;
