# Roles & Permissions

Role names are convenient labels; **authorization is driven by granular permissions** mapped to
roles via `role_permissions`, and enforced at three layers: UI gating → server permission check
→ RLS policy. Hiding a button is never sufficient.

## Roles

| Role                 | Summary                                                                             |
| -------------------- | ----------------------------------------------------------------------------------- |
| **Super Admin**      | Full access to everything. Exactly one protected account initially.                 |
| **Branch Manager**   | Operational visibility across all branches; approvals; NO costs/margins/user admin. |
| **Production Staff** | Create/record production; NO prices/margins; cannot edit completed production.      |
| **Inventory Staff**  | Stock in/out, transfers, receiving, recounts, waste; NO recipes/costs/prices.       |

## Super Admin protection

The original Super Admin cannot be deleted, disabled, or demoted through the normal UI
(`is_protected` flag + server guard + RLS). Recovery is a documented, audited procedure.

## Permission catalog (representative — full list seeded in Phase 1)

Permissions use `resource.action` slugs. Examples:

- `catalog.item.read` / `.write`
- `cost.read` (sensitive) · `price.read` / `price.write`
- `supplier.read` / `.write` · `supplier_price.read` (sensitive)
- `recipe.read` / `.write`
- `production.create` · `production.record` · `production.confirm` · `production.approve_variance`
- `stock.in` · `stock.out` · `stock.transfer.prepare` · `stock.transfer.receive`
- `recount.perform` · `recount.confirm` · `recount.confirm_unusual`
- `adjustment.request` · `adjustment.approve` · `adjustment.approve_high_value`
- `waste.record` · `waste.approve`
- `purchase.create` · `purchase.approve` · `purchase.receive`
- `calendar.manage` (Super Admin and Branch Manager; all operational roles can read)
- `closure.reopen` (Super Admin) · `recyclebin.restore`
- `users.manage` · `roles.manage` · `settings.manage` · `audit.read` · `backup.manage`

## Permission matrix (key capabilities)

| Capability                          | Super Admin |  Branch Mgr  | Production  |  Inventory  |
| ----------------------------------- | :---------: | :----------: | :---------: | :---------: |
| View costs / margins / food-cost %  |     ✅      |      ❌      |     ❌      |     ❌      |
| View supplier pricing               |     ✅      |      ❌      |     ❌      |     ❌      |
| Edit recipes                        |     ✅      |      ❌      |     ❌      |     ❌      |
| Edit selling prices                 |     ✅      |      ❌      |     ❌      |     ❌      |
| Users / roles / permissions         |     ✅      |      ❌      |     ❌      |     ❌      |
| Global settings / backups / secrets |     ✅      |      ❌      |     ❌      |     ❌      |
| Audit logs                          |     ✅      |      ❌      |     ❌      |     ❌      |
| View inventory — all branches       |     ✅      |      ✅      | ⛔ assigned | ⛔ assigned |
| Create/record production            |     ✅      |      ❌      |     ✅      |     ❌      |
| Submit production output            |     ✅      |      ✅      |     ✅      |     ❌      |
| Confirm ordinary production         |     ✅      |      ✅      |     ❌      |     ❌      |
| Approve exceptional variance        |     ✅      |      ❌      |     ❌      |     ❌      |
| Stock in / out (+ batch)            |     ✅      |      ❌      |     ❌      |     ✅      |
| Prepare transfer / receive transfer |     ✅      |   approve    |     ❌      |     ✅      |
| Approve transfer                    |     ✅      |      ✅      |     ❌      |     ❌      |
| Perform recount                     |     ✅      |      ✅      |     ❌      |     ✅      |
| Post ordinary recount adjustment    |     ✅      |      ✅      |     ❌      |     ✅      |
| Post unusual recount adjustment     |     ✅      |      ❌      |     ❌      |     ❌      |
| Close ready business day            |     ✅      |      ✅      |     ❌      |     ❌      |
| Record waste                        |     ✅      |      ✅      |  ✅ (prod)  |     ✅      |
| Approve waste over threshold        |     ✅      |      ❌      |     ❌      |     ❌      |
| Standard manual adjustment approval |     ✅      |      ✅      |     ❌      |     ❌      |
| High-value adjustment approval      |     ✅      |      ❌      |     ❌      |     ❌      |
| Create purchase order/draft         |     ✅      |      ✅      |     ❌      |     ❌      |
| Approve purchase order              |     ✅      | ⛔ delegated |     ❌      |     ❌      |
| Receive PO delivery                 |     ✅      |      ❌      |     ❌      |     ✅      |
| Calendar create/edit                |     ✅      |      ✅      |     ❌      |     ❌      |
| Calendar / popup read               |     ✅      |      ✅      |     ✅      |     ✅      |
| Popup engagement lifecycle          |     ✅      |      ✅      |     ❌      |     ❌      |
| View targeted notifications         |     ✅      |      ✅      |     ✅      |     ✅      |
| Acknowledge own notification        |     ✅      |      ✅      |     ✅      |     ✅      |
| Dashboard operational analytics     |     ✅      |      ✅      |     ✅      |     ✅      |
| Dashboard inventory valuation       |     ✅      |      ❌      |     ❌      |     ❌      |
| Reopen closed day                   |     ✅      |      ❌      |     ❌      |     ❌      |
| Recycle-bin restore                 |     ✅      |      ❌      |     ❌      |     ❌      |

Legend: ✅ allowed · ❌ denied · ⛔ conditional (branch-scoped or requires explicit delegation).

> **Branch Manager visibility note:** initially only one Branch Manager exists, so the role sees
> operational data for ALL branches. If additional managers are later added, branch scoping via
> `user_branch_assignments` is already in the schema to restrict them.

## Enforcement pattern

1. **UI**: `can(permission)` hook hides/disables controls (UX only).
2. **Server**: every Server Action calls `requirePermission(permission, { branchId? })` before work.
3. **RLS**: policies reference a `has_permission(uid, slug)` SQL helper + branch assignment; even a
   forged direct API call is blocked.
4. **Sensitive columns**: costs & supplier prices live behind role-gated views/functions; Phase 7
   recount cost/variance-value columns are omitted from authenticated grants, and Phase 8 exposes
   valuation only through a `cost.read`-checking function. Email recipient addresses and provider
   errors are server-only.

Automated authorization tests (Vitest + Playwright) prove each denial — see TESTING_STRATEGY.
