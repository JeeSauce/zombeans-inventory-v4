-- 0009_catalog_seed.sql
-- Baseline org & catalog reference data: branches, measurement units + core conversions, a starter
-- category tree, and the default application settings (VAT disabled — critical scenario 20 baseline).
-- Idempotent: safe to re-run. Owners refine branches/categories through the admin UI.

-- ── Branches ─────────────────────────────────────────────────────────────────
-- zombeans.xyz lists one live location (San Carlos City). The multi-branch design also needs a
-- central production site, so we seed the Commissary (main / holds raw ingredients) + the café.
-- Additional branches are added via the Branches admin as the business expands. See ASSUMPTIONS A-017.
insert into public.branches (key, name, is_main, holds_raw_ingredients, active) values
  ('commissary', 'Zombeans Commissary', true,  true,  true),
  ('san-carlos', 'Zombeans San Carlos', false, false, true)
on conflict (key) do nothing;

-- ── Units ────────────────────────────────────────────────────────────────────
insert into public.units (code, name, dimension) values
  ('g',         'Gram',      'mass'),
  ('kg',        'Kilogram',  'mass'),
  ('ml',        'Milliliter','volume'),
  ('l',         'Liter',     'volume'),
  ('pc',        'Piece',     'count'),
  ('serving',   'Serving',   'count'),
  ('portion',   'Portion',   'count'),
  ('pack',      'Pack',      'count'),
  ('tray',      'Tray',      'count'),
  ('container', 'Container', 'count'),
  ('sack',      'Sack',      'count'),
  ('box',       'Box',       'count')
on conflict (code) do nothing;

-- ── Global unit conversions (both directions for convenience) ────────────────
insert into public.unit_conversions (item_id, from_unit_id, to_unit_id, factor)
select null, f.id, t.id, c.factor
from (values
  ('kg', 'g',  1000),
  ('g',  'kg', 0.001),
  ('l',  'ml', 1000),
  ('ml', 'l',  0.001)
) as c(from_code, to_code, factor)
join public.units f on f.code = c.from_code
join public.units t on t.code = c.to_code
on conflict do nothing;

-- ── Starter category tree ────────────────────────────────────────────────────
insert into public.categories (name, item_type) values
  ('Coffee',          'drink'),
  ('Non-Coffee',      'drink'),
  ('Meals',           'food'),
  ('Snacks',          'food'),
  ('Coffee Beans',    'raw_ingredient'),
  ('Dairy',           'raw_ingredient'),
  ('Syrups & Sauces', 'raw_ingredient'),
  ('Dry Goods',       'raw_ingredient'),
  ('Prepared Bases',  'sub_product'),
  ('Packaging',       'packaging'),
  ('Containers',      'container')
on conflict do nothing;

-- ── Default application settings ─────────────────────────────────────────────
-- VAT disabled by default; Philippine standard rate 12% pre-filled for when a Super Admin enables it.
insert into public.application_settings (key, value, description) values
  (
    'vat',
    '{"enabled": false, "rate": 0.12, "registered_name": null, "tin": null}'::jsonb,
    'Value-Added Tax config. When enabled, prices with tax_mode inclusive/exclusive are taxed at rate.'
  ),
  (
    'thresholds',
    '{"high_value_adjustment": 5000, "waste_over": 1000}'::jsonb,
    'Placeholder peso thresholds (A-007) refined in later phases: manual-adjustment review, waste approval.'
  )
on conflict (key) do nothing;
