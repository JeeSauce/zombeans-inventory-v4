-- 0011_purchasing_rls.sql
-- RLS + grants for purchasing & ledger core. Sensitive cost columns are granted by explicit
-- column list (omitting them) so `authenticated` cannot read them; a cost.read-gated view exposes
-- cost to Super Admin. New permission supplier_price.write (super_admin only).

-- ── New permission ───────────────────────────────────────────────────────────
insert into public.permissions (slug, description, is_sensitive) values
  ('supplier_price.write', 'Create and edit supplier pricing', true)
on conflict (slug) do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on p.slug='supplier_price.write'
where r.key='super_admin' on conflict do nothing;

-- ── Non-sensitive tables: table-wide grants ──────────────────────────────────
grant select, insert, update, delete on
  public.suppliers, public.supplier_items,
  public.purchase_receipts, public.purchase_receipt_lines,
  public.supplier_returns, public.supplier_return_lines,
  public.inventory_lots, public.inventory_balances,
  public.stock_transactions, public.stock_transaction_lines
  to authenticated;

-- ── Definer-only ledger tables: revoke all write access from authenticated ─────
revoke insert, update, delete on public.inventory_balances, public.stock_transactions from authenticated;

-- ── Sensitive-cost tables: grant by column list, omitting the cost column ─────
-- supplier_prices: omit price
grant select (id, supplier_item_id, currency, effective_date, created_at, created_by)
  on public.supplier_prices to authenticated;
grant insert (supplier_item_id, currency, effective_date, created_by)
  on public.supplier_prices to authenticated;
-- purchase_orders: omit subtotal, total
grant select (id, reference, supplier_id, status, payment_status, expected_date, notes,
  created_at, updated_at, created_by, updated_by, approved_by, approved_at, version,
  deleted_at, deleted_by, purge_at) on public.purchase_orders to authenticated;
grant insert (reference, supplier_id, status, payment_status, expected_date, notes,
  created_by, updated_by) on public.purchase_orders to authenticated;
grant update (supplier_id, status, payment_status, expected_date, notes, updated_by,
  approved_by, approved_at, version, deleted_at, deleted_by, purge_at)
  on public.purchase_orders to authenticated;
grant delete on public.purchase_orders to authenticated;
-- purchase_order_lines: omit unit_cost
grant select (id, po_id, item_id, unit_id, ordered_qty, received_accepted_qty,
  created_at, updated_at, created_by, updated_by, version) on public.purchase_order_lines to authenticated;
grant insert (po_id, item_id, unit_id, ordered_qty, created_by, updated_by)
  on public.purchase_order_lines to authenticated;
grant update (unit_id, ordered_qty, updated_by, version) on public.purchase_order_lines to authenticated;
grant delete on public.purchase_order_lines to authenticated;

-- inventory_lots.unit_cost, stock_transaction_lines.unit_cost_snapshot,
-- supplier_returns.payable_adjustment are covered by the table-wide grants above BUT are sensitive;
-- revoke those columns explicitly is impossible after a table grant, so re-grant by column list:
revoke select, insert, update, delete on public.inventory_lots from authenticated;
grant select (id, item_id, branch_id, lot_number, received_date, expiration_date, qty_remaining,
  status, created_at, updated_at, version) on public.inventory_lots to authenticated;
-- (no insert/update/delete for authenticated — lots are written by definer functions only)

revoke select, insert, update, delete on public.stock_transaction_lines from authenticated;
grant select (id, txn_id, item_id, qty, unit_id, lot_id, created_at)
  on public.stock_transaction_lines to authenticated;

revoke select, insert, update on public.supplier_returns from authenticated;
grant select (id, reference, supplier_id, status, reason, idempotency_key, correlation_id,
  created_at, updated_at, created_by, updated_by, version) on public.supplier_returns to authenticated;
grant insert (reference, supplier_id, status, reason, idempotency_key, correlation_id,
  created_by, updated_by) on public.supplier_returns to authenticated;
grant update (status, reason, updated_by, version) on public.supplier_returns to authenticated;

-- service_role: full grants (owns privileged/definer paths)
grant select, insert, update, delete on
  public.suppliers, public.supplier_items, public.supplier_prices,
  public.purchase_orders, public.purchase_order_lines,
  public.purchase_receipts, public.purchase_receipt_lines,
  public.supplier_returns, public.supplier_return_lines,
  public.inventory_lots, public.inventory_balances,
  public.stock_transactions, public.stock_transaction_lines
  to service_role;

-- ── Enable RLS ───────────────────────────────────────────────────────────────
alter table public.suppliers               enable row level security;
alter table public.supplier_items          enable row level security;
alter table public.supplier_prices         enable row level security;
alter table public.purchase_orders         enable row level security;
alter table public.purchase_order_lines    enable row level security;
alter table public.purchase_receipts       enable row level security;
alter table public.purchase_receipt_lines  enable row level security;
alter table public.supplier_returns        enable row level security;
alter table public.supplier_return_lines   enable row level security;
alter table public.inventory_lots          enable row level security;
alter table public.inventory_balances      enable row level security;
alter table public.stock_transactions      enable row level security;
alter table public.stock_transaction_lines enable row level security;

-- ── Policies ─────────────────────────────────────────────────────────────────
-- suppliers / supplier_items: supplier.read / supplier.write
create policy suppliers_select on public.suppliers for select to authenticated
  using (deleted_at is null and public.has_permission(auth.uid(),'supplier.read'));
create policy suppliers_write on public.suppliers for all to authenticated
  using (public.has_permission(auth.uid(),'supplier.write'))
  with check (public.has_permission(auth.uid(),'supplier.write'));
create policy supplier_items_select on public.supplier_items for select to authenticated
  using (public.has_permission(auth.uid(),'supplier.read'));
create policy supplier_items_write on public.supplier_items for all to authenticated
  using (public.has_permission(auth.uid(),'supplier.write'))
  with check (public.has_permission(auth.uid(),'supplier.write'));

-- supplier_prices: read supplier_price.read; write supplier_price.write
create policy supplier_prices_select on public.supplier_prices for select to authenticated
  using (public.has_permission(auth.uid(),'supplier_price.read'));
create policy supplier_prices_write on public.supplier_prices for all to authenticated
  using (public.has_permission(auth.uid(),'supplier_price.write'))
  with check (public.has_permission(auth.uid(),'supplier_price.write'));

-- purchase_orders / lines: read purchase.create OR purchase.receive OR purchase.approve; write purchase.create
create policy po_select on public.purchase_orders for select to authenticated
  using (deleted_at is null and (
    public.has_permission(auth.uid(),'purchase.create') or
    public.has_permission(auth.uid(),'purchase.receive') or
    public.has_permission(auth.uid(),'purchase.approve')));
create policy po_write on public.purchase_orders for all to authenticated
  using (public.has_permission(auth.uid(),'purchase.create'))
  with check (public.has_permission(auth.uid(),'purchase.create'));
create policy po_lines_select on public.purchase_order_lines for select to authenticated
  using (public.has_permission(auth.uid(),'purchase.create') or
         public.has_permission(auth.uid(),'purchase.receive') or
         public.has_permission(auth.uid(),'purchase.approve'));
create policy po_lines_write on public.purchase_order_lines for all to authenticated
  using (public.has_permission(auth.uid(),'purchase.create'))
  with check (public.has_permission(auth.uid(),'purchase.create'));

-- receipts / lines: read+write purchase.receive
create policy receipts_select on public.purchase_receipts for select to authenticated
  using (public.has_permission(auth.uid(),'purchase.receive') or
         public.has_permission(auth.uid(),'purchase.approve'));
create policy receipts_write on public.purchase_receipts for all to authenticated
  using (public.has_permission(auth.uid(),'purchase.receive'))
  with check (public.has_permission(auth.uid(),'purchase.receive'));
create policy receipt_lines_select on public.purchase_receipt_lines for select to authenticated
  using (public.has_permission(auth.uid(),'purchase.receive') or
         public.has_permission(auth.uid(),'purchase.approve'));
create policy receipt_lines_write on public.purchase_receipt_lines for all to authenticated
  using (public.has_permission(auth.uid(),'purchase.receive'))
  with check (public.has_permission(auth.uid(),'purchase.receive'));

-- supplier_returns / lines: supplier.write
create policy returns_select on public.supplier_returns for select to authenticated
  using (public.has_permission(auth.uid(),'supplier.read'));
create policy returns_write on public.supplier_returns for all to authenticated
  using (public.has_permission(auth.uid(),'supplier.write'))
  with check (public.has_permission(auth.uid(),'supplier.write'));
create policy return_lines_select on public.supplier_return_lines for select to authenticated
  using (public.has_permission(auth.uid(),'supplier.read'));
create policy return_lines_write on public.supplier_return_lines for all to authenticated
  using (public.has_permission(auth.uid(),'supplier.write'))
  with check (public.has_permission(auth.uid(),'supplier.write'));

-- lots / balances / ledger: readable with catalog.item.read; NEVER writable via API (definer only)
create policy lots_select on public.inventory_lots for select to authenticated
  using (public.has_permission(auth.uid(),'catalog.item.read'));
create policy balances_select on public.inventory_balances for select to authenticated
  using (public.has_permission(auth.uid(),'catalog.item.read'));
create policy stock_txn_select on public.stock_transactions for select to authenticated
  using (public.has_permission(auth.uid(),'catalog.item.read'));
create policy stock_txn_lines_select on public.stock_transaction_lines for select to authenticated
  using (public.has_permission(auth.uid(),'catalog.item.read'));
-- (no insert/update/delete policies on balances/txn/txn_lines: definer functions only.)

-- ── cost.read-gated cost view ────────────────────────────────────────────────
-- SECURITY DEFINER function returns item cost only to cost.read holders.
create or replace function public.item_cost(p_item uuid)
returns numeric language sql stable security definer set search_path=public as $$
  select case when public.has_permission(auth.uid(),'cost.read')
              then (select weighted_avg_cost from public.inventory_items where id=p_item)
              else null end;
$$;
grant execute on function public.item_cost(uuid) to authenticated, service_role;
