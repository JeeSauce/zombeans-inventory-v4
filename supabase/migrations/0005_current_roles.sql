-- 0005_current_roles.sql
-- Role names are gated behind roles.manage on the roles table, so ordinary staff can't read even
-- their own role's display name via a join. Expose it through a SECURITY DEFINER function, mirroring
-- current_permissions().
create or replace function public.current_roles()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select r.name
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.profile_id = auth.uid()
  order by r.name;
$$;

grant execute on function public.current_roles() to authenticated;
