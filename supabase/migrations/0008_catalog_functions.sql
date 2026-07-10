-- 0008_catalog_functions.sql
-- Catalog helpers: human-readable SKU generation and the VAT/tax computation used everywhere a
-- selling price is shown. compute_line_tax() is the single source of truth for critical scenario 20
-- ("VAT is calculated only when enabled") — both the UI and later POS/report code call it, so the
-- rule can never drift between layers.

-- ── SKU sequences + generators ───────────────────────────────────────────────
create sequence if not exists public.item_sku_seq    as bigint start 1000;
create sequence if not exists public.variant_sku_seq as bigint start 1000;

-- ITM-001000, ITM-001001, … — sortable, unique, never a raw UUID.
create or replace function public.next_item_sku()
returns text
language sql
volatile
set search_path = public
as $$
  select 'ITM-' || lpad(nextval('public.item_sku_seq')::text, 6, '0');
$$;

create or replace function public.next_variant_sku()
returns text
language sql
volatile
set search_path = public
as $$
  select 'VAR-' || lpad(nextval('public.variant_sku_seq')::text, 6, '0');
$$;

grant execute on function public.next_item_sku()    to authenticated, service_role;
grant execute on function public.next_variant_sku() to authenticated, service_role;

-- ── VAT config accessor ──────────────────────────────────────────────────────
-- SECURITY DEFINER so pricing code can read the VAT config without holding settings.manage (the
-- application_settings table itself stays locked to settings.manage). Falls back to a disabled
-- default when the row is absent, so the system is VAT-free until a Super Admin turns it on.
create or replace function public.tax_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value from public.application_settings where key = 'vat'),
    '{"enabled": false, "rate": 0.12}'::jsonb
  );
$$;

grant execute on function public.tax_config() to authenticated, service_role;

-- ── compute_line_tax(base_price, tax_mode) → net / tax / gross / rate / applied ─
-- VAT is applied ONLY when the config is enabled AND the price's tax_mode is inclusive/exclusive.
--   none      → never taxed (tax = 0)
--   exclusive → price is net; gross = price * (1 + rate)
--   inclusive → price is gross; net  = price / (1 + rate)
create or replace function public.compute_line_tax(base_price numeric, mode public.tax_mode)
returns table (net numeric, tax numeric, gross numeric, rate numeric, applied boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cfg       jsonb   := public.tax_config();
  v_enabled boolean := coalesce((cfg ->> 'enabled')::boolean, false);
  v_rate    numeric := coalesce((cfg ->> 'rate')::numeric, 0);
  p         numeric := coalesce(base_price, 0);
begin
  if not v_enabled or mode = 'none' or v_rate = 0 then
    net := p; tax := 0; gross := p; rate := 0; applied := false;
    return next;
    return;
  end if;

  rate := v_rate;
  applied := true;
  if mode = 'exclusive' then
    net   := round(p, 4);
    tax   := round(p * v_rate, 4);
    gross := round(net + tax, 4);
  else  -- inclusive
    gross := round(p, 4);
    net   := round(p / (1 + v_rate), 4);
    tax   := round(gross - net, 4);
  end if;
  return next;
end;
$$;

grant execute on function public.compute_line_tax(numeric, public.tax_mode)
  to authenticated, service_role;
