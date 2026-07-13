-- 0021_phase6_stock_rls.sql
-- Phase 6 RLS and grants. Every mutation is definer-only; authenticated reads omit costs.

create or replace function public.has_branch_access(p_uid uuid, p_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (
    not exists (
      select 1 from public.user_branch_assignments uba where uba.profile_id = p_uid
    )
    or exists (
      select 1 from public.user_branch_assignments uba
      where uba.profile_id = p_uid and uba.branch_id = p_branch_id
    )
  )
$$;
revoke all on function public.has_branch_access(uuid, uuid) from public;
grant execute on function public.has_branch_access(uuid, uuid) to authenticated, service_role;

grant select on public.stock_requests, public.stock_request_lines,
  public.transfers, public.transfer_lines, public.transfer_discrepancies,
  public.inventory_alerts to authenticated;

grant select (
  id, transfer_line_id, source_lot_id, destination_lot_id, allocated_qty, received_qty,
  lot_number, received_date, expiration_date, created_at
) on public.transfer_lot_allocations to authenticated;

grant select, insert, update, delete on public.stock_requests, public.stock_request_lines,
  public.transfers, public.transfer_lines, public.transfer_lot_allocations,
  public.transfer_discrepancies, public.inventory_alerts to service_role;

alter table public.stock_requests enable row level security;
alter table public.stock_request_lines enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_lines enable row level security;
alter table public.transfer_lot_allocations enable row level security;
alter table public.transfer_discrepancies enable row level security;
alter table public.inventory_alerts enable row level security;

create policy stock_requests_select on public.stock_requests
  for select to authenticated
  using (
    public.has_branch_access(auth.uid(), requesting_branch_id)
    and (
      public.has_permission(auth.uid(), 'stock.transfer.prepare')
      or public.has_permission(auth.uid(), 'stock.transfer.approve')
      or public.has_permission(auth.uid(), 'stock.transfer.receive')
    )
  );

create policy stock_request_lines_select on public.stock_request_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.stock_requests sr where sr.id = request_id
    )
  );

create policy transfers_select on public.transfers
  for select to authenticated
  using (
    (
      public.has_branch_access(auth.uid(), source_branch_id)
      or public.has_branch_access(auth.uid(), dest_branch_id)
    )
    and (
      public.has_permission(auth.uid(), 'stock.transfer.prepare')
      or public.has_permission(auth.uid(), 'stock.transfer.approve')
      or public.has_permission(auth.uid(), 'stock.transfer.receive')
    )
  );

create policy transfer_lines_select on public.transfer_lines
  for select to authenticated
  using (exists (select 1 from public.transfers t where t.id = transfer_id));

create policy transfer_allocations_select on public.transfer_lot_allocations
  for select to authenticated
  using (
    exists (
      select 1 from public.transfer_lines tl
      join public.transfers t on t.id = tl.transfer_id
      where tl.id = transfer_line_id
    )
  );

create policy transfer_discrepancies_select on public.transfer_discrepancies
  for select to authenticated
  using (exists (select 1 from public.transfers t where t.id = transfer_id));

create policy inventory_alerts_select on public.inventory_alerts
  for select to authenticated
  using (
    public.has_branch_access(auth.uid(), branch_id)
    and (
      public.has_permission(auth.uid(), 'catalog.item.read')
      or public.has_permission(auth.uid(), 'stock.in')
      or public.has_permission(auth.uid(), 'stock.out')
      or public.has_permission(auth.uid(), 'stock.transfer.prepare')
      or public.has_permission(auth.uid(), 'stock.transfer.approve')
      or public.has_permission(auth.uid(), 'stock.transfer.receive')
    )
  );

