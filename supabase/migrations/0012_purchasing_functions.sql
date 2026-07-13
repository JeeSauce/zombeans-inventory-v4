-- 0012_purchasing_functions.sql
-- Reference generators + atomic, idempotent posting functions. These are the ONLY writers of
-- inventory_lots / inventory_balances / stock_transactions. Gate scenarios 6 (only accepted qty
-- posts) and 7 (weighted-average correct).

-- ── Human reference generators (SECURITY DEFINER: no direct sequence USAGE needed) ──
create or replace function public.next_po_reference() returns text
  language sql volatile security definer set search_path=public as $$
  select 'PO-' || to_char(now(),'YYYY') || '-' || lpad(nextval('po_ref_seq')::text,6,'0'); $$;
create or replace function public.next_receipt_reference() returns text
  language sql volatile security definer set search_path=public as $$
  select 'RCV-' || to_char(now(),'YYYY') || '-' || lpad(nextval('receipt_ref_seq')::text,6,'0'); $$;
create or replace function public.next_return_reference() returns text
  language sql volatile security definer set search_path=public as $$
  select 'RET-' || to_char(now(),'YYYY') || '-' || lpad(nextval('return_ref_seq')::text,6,'0'); $$;
create or replace function public.next_stock_txn_reference() returns text
  language sql volatile security definer set search_path=public as $$
  select 'STK-' || to_char(now(),'YYYY') || '-' || lpad(nextval('stock_txn_ref_seq')::text,6,'0'); $$;
grant execute on function public.next_po_reference(), public.next_receipt_reference(),
  public.next_return_reference(), public.next_stock_txn_reference() to authenticated, service_role;

-- ── Base-unit conversion helper: purchase unit → base unit factor for an item ─
-- Returns the factor F such that (qty in from_unit) * F = (qty in base unit). 1 if same unit or
-- an item-specific/global conversion is absent (caller supplies matching units in the MVP).
create or replace function public.unit_factor_to_base(p_item uuid, p_from_unit uuid)
returns numeric language plpgsql stable security definer set search_path=public as $$
declare
  v_base uuid;
  v_factor numeric;
begin
  select base_unit_id into v_base from public.inventory_items where id=p_item;
  if v_base is null then raise exception 'Item % has no base unit', p_item; end if;
  if p_from_unit = v_base then return 1; end if;
  -- item-specific first, then global
  select factor into v_factor from public.unit_conversions
    where item_id=p_item and from_unit_id=p_from_unit and to_unit_id=v_base limit 1;
  if v_factor is not null then return v_factor; end if;
  select factor into v_factor from public.unit_conversions
    where item_id is null and from_unit_id=p_from_unit and to_unit_id=v_base limit 1;
  if v_factor is not null then return v_factor; end if;
  raise exception 'No conversion from unit % to base unit of item %', p_from_unit, p_item;
end; $$;
grant execute on function public.unit_factor_to_base(uuid,uuid) to authenticated, service_role;

-- ── post_purchase_receipt ────────────────────────────────────────────────────
create or replace function public.post_purchase_receipt(p_receipt_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_receipt   public.purchase_receipts%rowtype;
  v_main      uuid;
  v_txn_id    uuid;
  rl          record;
  v_factor    numeric;
  v_base_qty  numeric;
  v_base_cost numeric;
  v_old_qty   numeric;
  v_old_avg   numeric;
  v_outstanding numeric;
  v_lot_id    uuid;
begin
  select * into v_receipt from public.purchase_receipts where id=p_receipt_id for update;
  if v_receipt.id is null then raise exception 'Receipt % not found', p_receipt_id; end if;

  -- Idempotency: same key already posted → return the existing txn, do not double-post.
  select id into v_txn_id from public.stock_transactions
    where idempotency_key = v_receipt.idempotency_key;
  if v_txn_id is not null then return v_txn_id; end if;

  select id into v_main from public.branches where is_main and deleted_at is null limit 1;
  if v_main is null then raise exception 'No main branch configured'; end if;

  insert into public.stock_transactions
    (reference, type, status, dest_branch_id, purchase_receipt_id, created_by,
     confirmed_at, idempotency_key, correlation_id)
  values (public.next_stock_txn_reference(), 'purchase_receiving', 'posted', v_main,
     v_receipt.id, v_receipt.received_by, now(), v_receipt.idempotency_key, v_receipt.correlation_id)
  returning id into v_txn_id;

  for rl in
    select prl.*, pol.item_id, pol.unit_id, pol.unit_cost, pol.ordered_qty,
           pol.received_accepted_qty, pol.id as po_line_id
    from public.purchase_receipt_lines prl
    join public.purchase_order_lines pol on pol.id = prl.po_line_id
    where prl.receipt_id = p_receipt_id and prl.accepted_qty > 0
  loop
    -- Over-receipt guard (scenario 6 boundary): accepted ≤ outstanding.
    v_outstanding := rl.ordered_qty - rl.received_accepted_qty;
    if rl.accepted_qty > v_outstanding then
      raise exception 'Over-receipt on PO line %: accepted % exceeds outstanding %',
        rl.po_line_id, rl.accepted_qty, v_outstanding;
    end if;

    v_factor    := public.unit_factor_to_base(rl.item_id, rl.unit_id);
    v_base_qty  := round(rl.accepted_qty * v_factor, 4);
    v_base_cost := round(rl.unit_cost / v_factor, 4);

    insert into public.inventory_lots
      (item_id, branch_id, lot_number, expiration_date, qty_remaining, unit_cost, status)
    values (rl.item_id, v_main, rl.lot_number, rl.expiration_date, v_base_qty, v_base_cost, 'available')
    returning id into v_lot_id;

    insert into public.stock_transaction_lines
      (txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot)
    values (v_txn_id, rl.item_id, v_base_qty,
      (select base_unit_id from public.inventory_items where id = rl.item_id),
      v_lot_id,
      v_base_cost);

    insert into public.inventory_balances (item_id, branch_id, qty_on_hand, updated_at)
    values (rl.item_id, v_main, v_base_qty, now())
    on conflict (item_id, branch_id) do update
      set qty_on_hand = public.inventory_balances.qty_on_hand + excluded.qty_on_hand,
          updated_at = now();

    -- Weighted-average recompute (scenario 7).
    select qty_on_hand into v_old_qty from public.inventory_balances
      where item_id=rl.item_id and branch_id=v_main;
    v_old_qty := coalesce(v_old_qty,0) - v_base_qty;  -- qty BEFORE this receipt
    select weighted_avg_cost into v_old_avg from public.inventory_items where id=rl.item_id;
    update public.inventory_items set
      weighted_avg_cost = case
        when coalesce(v_old_qty,0) <= 0 then v_base_cost
        else round((v_old_qty*coalesce(v_old_avg,0) + v_base_qty*v_base_cost)/(v_old_qty+v_base_qty),4)
      end
    where id = rl.item_id;

    update public.purchase_order_lines
      set received_accepted_qty = received_accepted_qty + rl.accepted_qty
      where id = rl.po_line_id;
  end loop;

  -- PO status transition.
  update public.purchase_orders po set status = case
    when not exists (
      select 1 from public.purchase_order_lines l
      where l.po_id = po.id and l.received_accepted_qty < l.ordered_qty
    ) then 'fully_received'::public.po_status
    else 'partially_received'::public.po_status
  end
  where po.id = v_receipt.po_id;

  update public.purchase_receipts set status='posted' where id=p_receipt_id;
  return v_txn_id;
end; $$;
grant execute on function public.post_purchase_receipt(uuid) to authenticated, service_role;

-- ── post_supplier_return ─────────────────────────────────────────────────────
create or replace function public.post_supplier_return(p_return_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_ret    public.supplier_returns%rowtype;
  v_txn_id uuid;
  rl       record;
  v_lot    public.inventory_lots%rowtype;
begin
  select * into v_ret from public.supplier_returns where id=p_return_id for update;
  if v_ret.id is null then raise exception 'Return % not found', p_return_id; end if;
  select id into v_txn_id from public.stock_transactions where idempotency_key=v_ret.idempotency_key;
  if v_txn_id is not null then return v_txn_id; end if;

  insert into public.stock_transactions
    (reference, type, status, source_branch_id, supplier_return_id, created_by,
     confirmed_at, idempotency_key, correlation_id)
  select public.next_stock_txn_reference(), 'supplier_return', 'posted',
     l.branch_id, v_ret.id, v_ret.created_by, now(), v_ret.idempotency_key, v_ret.correlation_id
  from public.inventory_lots l
  join public.supplier_return_lines srl on srl.lot_id=l.id
  where srl.return_id=p_return_id limit 1
  returning id into v_txn_id;

  for rl in select * from public.supplier_return_lines where return_id=p_return_id loop
    select * into v_lot from public.inventory_lots where id=rl.lot_id for update;
    if v_lot.qty_remaining < rl.qty then
      raise exception 'Return exceeds lot % remaining (% < %)', rl.lot_id, v_lot.qty_remaining, rl.qty;
    end if;
    update public.inventory_lots set qty_remaining = qty_remaining - rl.qty where id=rl.lot_id;
    update public.inventory_balances set qty_on_hand = qty_on_hand - rl.qty, updated_at=now()
      where item_id=rl.item_id and branch_id=v_lot.branch_id;
    insert into public.stock_transaction_lines
      (txn_id, item_id, qty, unit_id, lot_id, unit_cost_snapshot)
    values (v_txn_id, rl.item_id, -rl.qty,
      (select base_unit_id from public.inventory_items where id=rl.item_id), rl.lot_id, v_lot.unit_cost);
  end loop;

  update public.supplier_returns set status='posted' where id=p_return_id;
  return v_txn_id;
end; $$;
grant execute on function public.post_supplier_return(uuid) to authenticated, service_role;
