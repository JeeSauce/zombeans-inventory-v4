# Implementation Phases

Controlled, verifiable phases. **A phase does not start until the prior phase's tests are green.**
Each phase after 0 gets its own short spec → plan → implement cycle rather than one large
unverified generation.

## Definition of Done (every module)

Migrations ✓ · RLS policies ✓ · Zod validation ✓ · server-side business logic ✓ · UI connected to
real data ✓ · loading/empty/error states ✓ · audit logging where applicable ✓ · permissions tested
✓ · mobile verified ✓ · automated tests pass ✓ · docs updated ✓ · no critical TS/lint/build/
security errors ✓.

## Phase 0 — Planning & Repository Foundation

Architecture docs (all 13 + diagrams), repo scaffold, code-quality tooling, env validation, base
design system/tokens, local/staging/prod strategy. No business modules.
**Gate:** scaffold builds, lint/typecheck/test pass, docs complete.

## Phase 1 — Auth, Users, Roles, Security

Supabase Auth; profiles; roles/permissions/role_permissions/user_roles; Super Admin protection +
step-up email-code verification; RLS foundation + `has_permission` helper; audit foundation;
user-management UI.
**Gate:** critical tests 1, 21, 22, 23 (partial) pass.

## Phase 2 — Branches, Categories, Units, Catalog

4 branches; categories; units + conversions; unified inventory_items; products; variants;
modifiers; SKU generation; barcodes; branch pricing.
**Gate:** critical tests 19, 20 pass.

## Phase 3 — Ingredients, Suppliers, Purchasing

Ingredient lots + expiry; suppliers; supplier prices (sensitive); weighted-average costing; POs;
receiving checklist; partial receiving; supplier returns.
**Gate:** critical tests 6, 7 pass.

## Phase 4 — Recipes & Product Costing

Recipe versions; multi-level recipes; variant recipes; modifier deductions; packaging costs; cost
snapshots; costing dashboard (Super Admin only).
**Gate:** critical tests 1, 8 pass.

## Phase 5 — Production

Templates; orders; inputs/outputs; yield/waste; batches; expiration; FEFO; approvals.
**Gate:** critical tests 2, 3, 4 pass.

## Phase 6 — Multi-branch Stock

Ledger; balances; stock-in/out (+ batch); requests; transfers; receiving; discrepancies;
negative-inventory alerts.
**Gate:** critical tests 5, 9, 10 pass.

## Phase 7 — Recounts & Daily Operations

Start-of-day recount; optional end-of-day; cycle counts; variances; adjustments; day closing;
Super Admin reopening.
**Gate:** critical tests 11, 12, 13 pass.

## Phase 8 — Calendar, Popup Events, Notifications, Dashboard

Operational calendar; popup event sessions; in-app + email notifications; dashboard analytics.
**Gate:** notification dedup/severity + dashboard role-gating tests pass.

## Phase 9 — Reports, Exports, Recycle Bin, Backups

Reports; CSV/Excel/PDF/print exports; soft delete; auto-purge; backup jobs; restore docs.
**Gate:** critical tests 14, 15, 16 pass. **Complete 2026-07-14.**

## Phase 10 — Offline & POS Preparation ← next

Offline drafts; sync queue; conflict review; barcode scanning; Loyverse mapping tables; CSV
importer with preview; POS interfaces without live sync.
**Gate:** critical tests 17, 18, 24 pass.

## Phase 11 — Hardening & Deployment

Security review; RLS penetration tests; performance; accessibility; mobile; recovery testing;
staging deploy; production checklist; Vercel deploy.
**Gate:** full critical-scenario suite green; security review signed off.

## End-of-phase report (required each phase)

Completed work · files changed · migrations created · tests added · tests passed · known
limitations · security considerations · exact next phase.
