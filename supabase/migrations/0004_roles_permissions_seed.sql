-- 0004_roles_permissions_seed.sql
-- System reference data: the permission catalog, the four system roles, and their mappings.
-- This is REFERENCE data (ships in every environment), not development sample data.

-- ── Permission catalog ───────────────────────────────────────────────────────
insert into public.permissions (slug, description, is_sensitive) values
  ('catalog.item.read',          'View inventory items and products',            false),
  ('catalog.item.write',         'Create and edit inventory items and products', false),
  ('price.read',                 'View selling prices',                          false),
  ('price.write',                'Edit selling prices',                          false),
  ('cost.read',                  'View costs, margins, and food-cost %',         true),
  ('supplier.read',              'View suppliers',                               false),
  ('supplier.write',             'Create and edit suppliers',                    false),
  ('supplier_price.read',        'View supplier pricing',                        true),
  ('recipe.read',                'View recipes',                                 false),
  ('recipe.write',               'Create and edit recipes',                      false),
  ('production.create',          'Create production orders',                     false),
  ('production.record',          'Record actual production inputs and outputs',  false),
  ('production.confirm',         'Confirm ordinary production output',           false),
  ('production.approve_variance','Approve exceptional production variance',      false),
  ('stock.in',                   'Perform stock-in',                             false),
  ('stock.out',                  'Perform stock-out',                            false),
  ('stock.transfer.prepare',     'Prepare branch transfers',                     false),
  ('stock.transfer.approve',     'Approve branch transfers',                     false),
  ('stock.transfer.receive',     'Receive branch transfers',                     false),
  ('recount.perform',            'Perform recounts',                             false),
  ('recount.confirm',            'Confirm recount variances',                    false),
  ('recount.confirm_unusual',    'Confirm unusual recount variances',            false),
  ('adjustment.request',         'Request manual adjustments',                   false),
  ('adjustment.approve',         'Approve standard manual adjustments',          false),
  ('adjustment.approve_high_value','Approve high-value manual adjustments',      false),
  ('waste.record',               'Record waste',                                 false),
  ('waste.approve',              'Approve waste over threshold',                 false),
  ('purchase.create',            'Create purchase orders and drafts',            false),
  ('purchase.approve',           'Approve purchase orders',                      false),
  ('purchase.receive',           'Receive purchase-order deliveries',            false),
  ('closure.reopen',             'Reopen a closed operational day',              false),
  ('recyclebin.restore',         'Restore soft-deleted records',                 false),
  ('calendar.manage',            'Create and edit calendar entries',             false),
  ('users.manage',               'Manage user accounts',                         false),
  ('roles.manage',               'Manage roles and permissions',                 false),
  ('settings.manage',            'Manage global settings',                       false),
  ('audit.read',                 'View audit logs',                              false),
  ('backup.manage',              'Manage backups',                               false);

-- ── System roles ─────────────────────────────────────────────────────────────
insert into public.roles (key, name, is_system) values
  ('super_admin',    'Super Admin',    true),
  ('branch_manager', 'Branch Manager', true),
  ('production',     'Production Staff', true),
  ('inventory',      'Inventory Staff',  true);

-- ── Super Admin: ALL permissions ─────────────────────────────────────────────
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key = 'super_admin';

-- ── Branch Manager ───────────────────────────────────────────────────────────
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on p.slug in (
  'catalog.item.read', 'price.read', 'supplier.read', 'recipe.read',
  'production.confirm', 'stock.transfer.approve',
  'recount.perform', 'recount.confirm',
  'adjustment.approve', 'waste.record',
  'purchase.create', 'calendar.manage'
)
where r.key = 'branch_manager';

-- ── Production Staff ─────────────────────────────────────────────────────────
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on p.slug in (
  'catalog.item.read', 'recipe.read',
  'production.create', 'production.record', 'waste.record'
)
where r.key = 'production';

-- ── Inventory Staff ──────────────────────────────────────────────────────────
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on p.slug in (
  'catalog.item.read',
  'stock.in', 'stock.out',
  'stock.transfer.prepare', 'stock.transfer.receive',
  'recount.perform', 'waste.record',
  'adjustment.request', 'purchase.receive'
)
where r.key = 'inventory';
