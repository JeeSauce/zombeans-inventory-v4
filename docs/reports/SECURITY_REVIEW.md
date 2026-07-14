# Phase 11 Security Review

Date: 2026-07-14 (Asia/Manila)
Scope: repository at `codex/phase-11-hardening-deployment`, migrations `0001`-`0036`
Method: source review, clean local migration replay, effective Postgres grant inventory, real-role
integration tests, browser bundle scan, unit/build checks, and Playwright accessibility/security
smoke coverage.

## Sign-off status

Repository-controlled security gates are **approved**.

The production-only audit completed with zero high/critical findings. It reports two moderate
findings for PostCSS below 8.5.10 nested inside Next 15.5.20. PostCSS is used by Next at build time,
and the Next maintainers state that this advisory does not affect Next.js users and that no 15.x
backport is planned. Forcing npm's suggested Next downgrade or overriding a framework-private
dependency would introduce greater compatibility risk, so this bounded residual is accepted until
a supported Next upgrade carries the fix. See
[GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) and
[Next.js issue #93234](https://github.com/vercel/next.js/issues/93234).

The first real encrypted-export scratch restore remains an operator-owned deployment prerequisite
and must meet the acceptance criteria in `BACKUP_AND_RECOVERY.md`; it is not a missing
repository-controlled test.

No unresolved critical application-code, database-policy, secret-exposure, cost-gating, or ledger
integrity finding was identified in the completed review. Hosted Supabase/Vercel project settings
are outside this code-only phase and are not represented as reviewed.

## Findings resolved in Phase 11

| Severity | Finding                                                                                                                                                  | Resolution                                                                                                                                                                                               | Evidence                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Stock balances, lots, ledger headers/lines, and production orders had permission checks but incomplete branch predicates.                                | Migration `0036` replaces the policies with `has_branch_access(auth.uid(), branch_id)` boundaries and applies branch scope to limited production updates.                                                | `rls-penetration.test.ts` creates two real branches and proves non-Super roles see only the assigned branch while Super Admin retains cross-branch visibility. |
| High     | The legacy “no branch assignments means global” fallback applied to Production and Inventory roles, not only the intended global roles.                  | Unassigned Production/Inventory users now fail closed; Super Admin remains global and the documented MVP Branch Manager fallback remains. The local seed creates explicit operational assignments.       | `hardening.test.ts` probes all three unassigned role outcomes; two-branch penetration tests cover assigned users.                                              |
| High     | Postgres' default function grant left an ambient `PUBLIC` execution surface; several internal reference generators were callable by authenticated users. | Revoke `PUBLIC`/`anon` execute for all existing/future public functions and revoke authenticated access to internal generators.                                                                          | Dynamic definer/grant test plus effective catalog inventory below.                                                                                             |
| Medium   | Identity helpers accepted an arbitrary user ID, allowing cross-user role/permission/branch probes.                                                       | `has_permission`, `is_super_admin`, and `has_branch_access` now require the supplied ID to equal `auth.uid()`.                                                                                           | Cross-user probes return false in `hardening.test.ts`.                                                                                                         |
| Medium   | Costing issued one RPC per recipe and branch pricing performed one read/write loop per branch.                                                           | One protected cost batch RPC and one atomic price-form RPC replace both fan-outs.                                                                                                                        | Integration tests validate permission, atomic rollback, insert/update/delete, and malformed-entry isolation.                                                   |
| High     | Production email configuration advertised Resend but threw at runtime; `console` could expose step-up codes if selected in production.                   | Server-only Resend delivery is implemented with sanitized errors and idempotency headers; console fails closed in production except an explicit loopback-Supabase E2E guard that hosted URLs cannot use. | `email.test.ts`; no real provider key used.                                                                                                                    |

## SECURITY DEFINER inventory

The live schema contains **103** `SECURITY DEFINER` functions. The inventory query used
`pg_proc`, `regprocedure`, and effective `has_function_privilege` checks after a clean reset.
Every signature appears exactly once below.

Global results:

- 103/103 pin `search_path`; the dynamic test fails on any future unpinned definer.
- 0/103 are executable by `PUBLIC` or `anon`.
- 74 are authenticated entry points (72 also executable by controlled service jobs; two are
  authenticated identity projections only).
- 13 are service-only helpers.
- 16 are owner/internal helpers with no authenticated, service-role, anonymous, or public grant.

### Authenticated application boundaries (72; service role also permitted)

These are either permission/branch-gated command/query boundaries or harmless deterministic
calculators. Mutation boundaries derive the actor from `auth.uid()`; replay-sensitive stock,
production, recount, offline, POS, lifecycle, and delivery operations validate stable keys inside
Postgres. Reasons are required for destructive/exception/approval operations where the business
contract calls for one. Pure reads/calculators do not invent meaningless reason or idempotency
parameters.

1. `activate_recipe_version(uuid)`
2. `approve_transfer(uuid)`
3. `calculate_recipe_cost_batch(uuid[])`
4. `calculate_recipe_cost(uuid)`
5. `cancel_popup_event(uuid,text,text)`
6. `can_view_calendar_event(uuid,uuid)`
7. `can_view_notification(uuid,uuid,uuid,uuid)`
8. `close_day(uuid,date,text)`
9. `complete_popup_event(uuid,text)`
10. `compute_line_tax(numeric,tax_mode)`
11. `confirm_pos_import(uuid,text,uuid)`
12. `create_calendar_event(text,text,text,calendar_event_type,uuid,timestamp with time zone,timestamp with time zone,text)`
13. `create_popup_event(text,text,text,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text)`
14. `create_production_order(uuid,numeric,text,text)`
15. `create_stock_request(uuid,text,text,jsonb)`
16. `deactivate_loyverse_mapping(uuid,text,uuid)`
17. `get_backup_status()`
18. `get_dashboard_financials(uuid,uuid,item_type)`
19. `get_dashboard_operational(date,date,uuid,uuid,item_type)`
20. `get_financial_report(text,date,date,uuid,uuid,item_type)`
21. `get_operational_report(text,date,date,uuid,uuid,item_type)`
22. `has_branch_access(uuid,uuid)`
23. `has_offline_submission_access(uuid,uuid,uuid)`
24. `has_permission(uuid,text)`
25. `has_pos_import_access(uuid,uuid)`
26. `has_recount_access(uuid,uuid)`
27. `issue_offline_snapshot(offline_submission_type,uuid,uuid,jsonb,uuid)`
28. `is_super_admin(uuid)`
29. `item_cost(uuid)`
30. `link_popup_stock_movement(uuid,uuid,popup_movement_type,text)`
31. `link_popup_transfer(uuid,uuid,text)`
32. `list_offline_conflicts()`
33. `list_recycle_bin()`
34. `lookup_inventory_item_by_barcode(text)`
35. `mark_production_failed(uuid,text,text)`
36. `next_item_sku()`
37. `next_po_reference()`
38. `next_receipt_reference()`
39. `next_return_reference()`
40. `open_recount(uuid,date,recount_session_type,text,jsonb)`
41. `place_retention_hold(recycle_entity_type,uuid,retention_dependency_type,text,text)`
42. `post_production_completion(uuid)`
43. `post_purchase_receipt(uuid)`
44. `post_recount_adjustment(uuid,recount_adjustment_reason,text,text)`
45. `post_stock_in(uuid,text,text,text,jsonb)`
46. `post_stock_out(uuid,text,text,text,jsonb)`
47. `post_supplier_return(uuid)`
48. `prepare_transfer(uuid,uuid,uuid,text,text,jsonb)`
49. `preview_pos_import(uuid,text,uuid,jsonb)`
50. `purge_recycle_bin(text,integer)`
51. `receive_transfer(uuid,text,text,jsonb)`
52. `recipe_cost_snapshot(uuid)`
53. `record_popup_event_count(uuid,jsonb,text)`
54. `record_production_actuals(uuid,numeric,text,date,date,text,jsonb)`
55. `refresh_operational_notifications()`
56. `release_retention_hold(uuid,text,text)`
57. `reopen_day(uuid,date,text,text)`
58. `resolve_offline_conflict(uuid,offline_resolution_decision,text,uuid)`
59. `resolve_transfer_discrepancy(uuid,text)`
60. `restore_recycle_record(recycle_entity_type,uuid,text,text)`
61. `review_stock_request(uuid,text,text,jsonb)`
62. `set_notification_receipt_state(uuid,boolean,text)`
63. `set_product_branch_prices(uuid,jsonb)`
64. `soft_delete_record(recycle_entity_type,uuid,text,text)`
65. `start_popup_event(uuid,text)`
66. `submit_offline_production(uuid,uuid,uuid,timestamp with time zone,uuid,numeric,text,date,date,text,jsonb)`
67. `submit_offline_recount(uuid,date,uuid,uuid,timestamp with time zone,uuid,text,jsonb)`
68. `submit_recount(uuid,text,jsonb)`
69. `tax_config()`
70. `unit_factor_to_base(uuid,uuid)`
71. `update_calendar_event(uuid,integer,text,text,text,calendar_event_type,calendar_event_status,uuid,timestamp with time zone,timestamp with time zone,text)`
72. `upsert_loyverse_mapping(loyverse_entity_type,text,text,text,uuid,numeric,text,uuid)`

### Authenticated identity projections (2; not granted to service role)

1. `current_permissions()`
2. `current_roles()`

Both are actor-derived projections; callers cannot supply another profile ID.

### Service-role-only helpers (13)

1. `_calculate_recipe_cost_internal(uuid,uuid[],integer,uuid,uuid)`
2. `claim_notification_email_deliveries(uuid,integer)`
3. `finalize_notification_email_delivery(uuid,uuid,boolean,text,text)`
4. `next_production_reference()`
5. `next_stock_request_reference()`
6. `next_stock_txn_reference()`
7. `next_transfer_reference()`
8. `next_variant_sku()`
9. `phase9_entity_snapshot(recycle_entity_type,uuid)`
10. `raise_notification(notification_source_type,text,text,text,uuid,text,text,uuid,uuid,uuid)`
11. `record_backup_run(text,text,backup_mechanism,backup_run_status,text,boolean,timestamp with time zone,timestamp with time zone,date,bigint,timestamp with time zone,text)`
12. `recycle_dependency_reason(recycle_entity_type,uuid)`
13. `resolve_notification(text,text,text)`

These support server-owned delivery, sanitized backup metadata, notification projection, internal
reference generation, costing, and lifecycle dependency checks. Browser roles have no execute
grant. `record_backup_run` validates stable run identity, safe metadata, timing, encryption, and
idempotent replay.

### Owner/internal-only helpers and triggers (16)

1. `assert_business_day_open(uuid,date)`
2. `next_calendar_event_reference()`
3. `next_day_close_event_reference()`
4. `next_day_close_reference()`
5. `next_notification_reference()`
6. `next_offline_submission_reference()`
7. `next_popup_event_reference()`
8. `next_pos_import_reference()`
9. `next_recount_adjustment_reference()`
10. `next_recount_reference()`
11. `phase10_apply_offline_recount(uuid,date,uuid,text,jsonb,boolean)`
12. `phase9_validate_report_filters(date,date,uuid)`
13. `tg_guard_privileged_profile_fields()`
14. `tg_guard_stock_transaction_business_day()`
15. `tg_handle_new_auth_user()`
16. `tg_inventory_alert_notification()`

They are reachable only from owning functions/triggers; no application/service API role has a
direct execute path.

## Service-role-key boundary

Status: **pass (repository)**.

- `lib/supabase/admin.ts` begins with `import "server-only"`; it is the only client constructor
  that reads `SUPABASE_SERVICE_ROLE_KEY`, disables session persistence/refresh, and never accepts a
  browser session.
- Reviewed call sites are limited to account administration, hashed step-up challenges, append-only
  audit writes, sensitive supplier/PO cost reads/writes after explicit application permission
  checks, and service-owned email delivery RPCs.
- No `"use client"` module imports the admin client or server environment.
- `.env.example` contains placeholders only. Local/CI DB URLs are explicitly excluded from the
  Vercel runtime inventory.
- `scan:bundle` now loads `.env.local` when present so local runs cannot silently skip; CI injects a
  dummy marker and fails if it appears under `.next/static`.

## Cost and supplier-price isolation

Status: **pass**.

- UI/server boundaries check `cost.read`, `supplier_price.read`, or `supplier_price.write` before
  rendering or using sensitive data.
- Authenticated column grants omit `weighted_avg_cost`, lot/PO cost snapshots, supplier `price`,
  report financial fields, and other protected values.
- Financial/cost RPCs repeat permission checks in Postgres; operational reports are cost-free.
- Integration tests prove ordinary roles cannot select protected columns or call financial/cost
  functions, while authorized Super Admin paths return the expected values.
- Historical recipe, lot, purchase, production, transfer, and ledger cost snapshots remain frozen.

## Append-only ledger and inventory mutation

Status: **pass**.

- No application code directly inserts, updates, or deletes `inventory_balances`, `inventory_lots`,
  `stock_transactions`, or `stock_transaction_lines`.
- Authenticated grants/policies expose no direct DML path into ledger, lifecycle, offline, or POS
  posting tables. The penetration suite attempts every verb as every application role.
- Atomic definer functions own balance/lot mutation and append ledger headers/lines with actor,
  branch, business-day, reason, permission, and replay controls appropriate to each operation.
- Corrections post compensating entries; confirmed historical rows and snapshots are not rewritten.
- Scenarios 2-18 and 24 exercise expiry, atomic rollback, replay, FEFO, negative visibility,
  recount/day closure, offline conflict, and POS preview/confirm invariants against real Postgres.

## RLS penetration and branch scope

Status: **pass**.

`rls-penetration.test.ts` hard-codes the complete public-business-table inventory and fails if a
table is added without an explicit contract. For Super Admin, Branch Manager, Production,
Inventory, and anonymous access it compares grants/policies for SELECT/INSERT/UPDATE/DELETE and
then performs real reads/writes. Anonymous access is denied for all verbs; protected direct DML is
denied for all application roles; cross-branch stock/production reads are denied.

## Web/runtime controls

Status: **pass with documented CSP limitation**.

- Exact Next/React/Supabase framework versions and Node 24 major are pinned.
- CSP restricts default/base/form/frame/object/connect/image/font/media/worker/manifest sources;
  HSTS, `nosniff`, frame denial, strict referrer policy, and a camera-limited Permissions Policy
  are configured.
- Current Next/component behavior still requires `'unsafe-inline'` for scripts/styles. This is a
  known hardening limitation; a nonce-based CSP is a separately designed change, not silently
  claimed here.
- Resend delivery is server-only, fails closed without a key, uses a stable delivery idempotency
  header, and does not include provider bodies/secrets in application errors.

## Release evidence commands

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run scan:bundle
npm run db:reset
npm run test:integration
npm run test:recovery
npm run seed:dev
npm run test:e2e
npm audit --omit=dev
npm audit --omit=dev --audit-level=high
```

All functional commands above completed successfully in the final Phase 11 gate sequence. The
plain `npm audit --omit=dev` command executed and exits nonzero for the two accepted moderate
findings; its `--audit-level=high` counterpart exits zero and proves that the high/critical
production gate is clear. Exact counts and the residual-risk decision are recorded in
`PHASE_11.md`.
