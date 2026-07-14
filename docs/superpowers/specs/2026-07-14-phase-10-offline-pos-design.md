# Phase 10 — Offline & POS Preparation — Design

## Goal and scope

Phase 10 adds device-local recount and production drafts, an idempotent synchronization queue,
explicit server-owned conflict review, barcode lookup, Loyverse-to-inventory mapping, and a staged
CSV import workflow. It deliberately does not connect to a live POS API. Every quantity change
continues to use an authenticated, branch-aware, atomic `SECURITY DEFINER` Postgres function and
the existing append-only stock ledger.

In scope:

- versioned client draft storage for recount and production actuals;
- online/offline status and a retryable sync queue with stable client-generated UUID keys;
- offline recount auto-posting only when the server proves its snapshot is still current;
- explicit conflict acceptance/rejection with an append-only resolution record;
- production-draft sync into the existing awaiting-confirmation workflow, without bypassing the
  existing `production.confirm` posting boundary;
- safe barcode lookup by inventory-item, product-variant, or modifier barcode;
- Loyverse item/variant/modifier mappings to internal inventory items;
- CSV parsing, server-side validation, staging preview, and explicit idempotent confirmation;
- responsive, accessible light/dark UI states and PWA support for an already-loaded draft screen.

Out of scope: Loyverse credentials, webhooks, polling, scheduled/live POS synchronization,
automatic conflict winners, editing posted ledger rows, browser-side inventory mutations, and
deployment hardening from Phase 11.

## Permissions

Three Phase 10 permissions keep duties narrow:

| Permission       | Purpose                                           | Seeded roles                                       |
| ---------------- | ------------------------------------------------- | -------------------------------------------------- |
| `offline.sync`   | Submit owned recount/production drafts            | Super Admin, Branch Manager, Production, Inventory |
| `offline.review` | Accept or reject server-detected draft conflicts  | Super Admin, Branch Manager                        |
| `pos.import`     | Manage mappings, preview CSV, and confirm imports | Super Admin, Branch Manager                        |

Every RPC also checks authentication and `has_branch_access`. An offline production submission
continues to require `production.record`; production posting continues to require
`production.confirm`. Unusual recount adjustments continue to require
`recount.confirm_unusual`, including during reviewed conflict acceptance.

## Offline client model

`lib/offline/draft-store.ts` owns a versioned IndexedDB database. Drafts contain a generated draft
ID, immutable UUID idempotency key, type, human label, server snapshot time, creation/update times,
payload, sync state, and the last safe error. The browser may create, edit, queue, retry, or delete
device-local drafts, but it never changes an inventory balance.

The `/offline-pos` client caches only safe catalog labels and IDs needed to finish an already
started draft. It observes `navigator.onLine`, retains the same idempotency key across retries, and
removes or marks a draft only after the server returns a durable result. A service worker caches
the application shell/static assets needed by an already-loaded screen; network mutation requests
are never cached or synthesized.

### Recount draft payload

A recount draft records branch, Manila business date, a server-issued snapshot timestamp, reason,
and one or more `{ itemId, physicalQty }` lines. Expected quantity is never trusted from the
browser. At sync, Postgres locks the scope and checks the authoritative ledger for any posted
movement after the snapshot.

If the snapshot is current, the sync RPC orchestrates the existing `open_recount`,
`submit_recount`, and `post_recount_adjustment` functions with keys derived from the stable offline
key. Ordinary variances post atomically. A no-variance count closes without a ledger row. An
unusual variance is saved for explicit authorized review rather than silently posted.

If any scoped item moved after the snapshot, the submission is saved as `review_required` and no
recount or ledger mutation occurs. Because the first accepted offline recount itself creates a
posted movement, a second overlapping draft from the same old snapshot necessarily conflicts.

### Production draft payload

A production draft identifies an existing in-progress production order and captures actual output,
lot, production/expiry dates, notes, input consumption, and waste. Sync compares the order's
authoritative `updated_at` with the draft snapshot. A current draft calls the existing
`record_production_actuals` RPC and becomes `synced`; this intentionally creates no ledger entry.
The existing online confirmation step remains the only production-posting path. A changed order is
stored for review.

## Server synchronization and conflict model

`offline_submissions` is the durable receipt for every sync attempt. It stores a human reference,
type, branch, client draft ID/times, snapshot, stable idempotency key, status, safe payload, conflict
reason, actor, and result references. `offline_submission_items` normalizes the affected scope for
locking and conflict queries. Replaying an idempotency key returns the same receipt and
`replayed: true`; it does not call a posting primitive again.

`offline_conflict_resolutions` is append-only and has its own stable idempotency key and audit-log
reference. Reviewers may:

- reject, preserving the submitted evidence and posting nothing; or
- accept, causing the server to re-snapshot/revalidate and invoke the appropriate existing recount
  or production primitive. The reviewer supplies a reason. Any current permission, branch, closed
  day, unusual-variance, or production-state failure aborts the whole resolution.

The conflict UI is populated by a safe RPC that returns references, names, SKUs, quantities,
timestamps, and reasons, never raw UUIDs as visible labels and never cost snapshots.

## Barcode lookup

`lookup_inventory_item_by_barcode()` trims and validates a barcode, requires catalog read access,
and searches active inventory items, product variants, and modifiers. It returns a safe item name,
SKU, barcode, source label, and base-unit code. Multiple distinct internal matches are rejected as
ambiguous. The UI supports keyboard/manual entry and the browser `BarcodeDetector` API when
available. Lookup has no quantity input or mutation path.

## Loyverse mappings

`loyverse_mappings` maps `(entity_type, external_id)` for Loyverse `item`, `variant`, or `modifier`
entities to one active internal inventory item plus a positive base-unit quantity multiplier.
External name/SKU are safe operational metadata. An idempotent mapping command RPC validates
`pos.import`, branch-independent catalog eligibility, reason, and actor, then writes an audit row.

Mappings never include costs or supplier prices. Direct authenticated DML is revoked; ordinary
reads are limited to `pos.import` holders through RLS. Deactivation is a new mapping command, not a
hard delete.

## CSV preview and confirmation

The accepted UTF-8 CSV contract has these headers:

`external_reference,external_line_id,occurred_at,type,entity_type,external_id,quantity`

`type` is `sale` or `refund`; entity type is `item`, `variant`, or `modifier`; quantity is positive
with at most four decimals. Files are capped at 1 MiB and 500 data rows. The parser supports quoted
commas, escaped quotes, CRLF/LF, and quoted newlines. Client parsing provides immediate feedback;
the server repeats all validation before calling Postgres.

### Preview

`preview_pos_import()` requires `pos.import`, branch access, filename, stable preview key, and a
validated row array. It resolves mappings, checks previously confirmed external line IDs, writes a
`pos_imports` staging header and `pos_import_rows`, and writes audit evidence. It does not call any
stock-posting function or write `stock_transactions`, `stock_transaction_lines`, inventory lots,
or balances. Replay returns the same frozen preview.

Rows are `valid`, `unmapped`, `duplicate`, or `invalid`. The preview UI shows human external and
internal labels plus safe errors. Confirm is disabled unless every row is valid.

### Confirm

`confirm_pos_import()` requires a distinct stable confirm key and reviewer reason, locks the import,
revalidates every mapping and external-line uniqueness, and posts all rows in one transaction.
Each staged row produces one `pos_sale` or `pos_refund` stock transaction with a derived stable
ledger idempotency key and an append-only `pos_import_postings` link.

Sales consume lots FEFO and retain each lot's frozen cost snapshot. Any uncovered sale quantity is
still represented by a cost-snapshotted ledger line and may create the existing negative-inventory
alert. Refunds create a traceable POS-return lot at the item's current weighted-average cost.
Balances update only inside the confirm RPC. Replay returns the original transaction references and
`replayed: true` with zero duplicate header, line, lot, balance, or posting rows.

The top-level import status changes from `preview` to `confirmed` only after all ledger, lot,
balance, posting-link, audit, and header changes succeed. Any error rolls back the entire confirm.

## Schema, RLS, and sensitive-data boundary

Migrations are split as requested:

- `0033_phase10_schema.sql`: enums, sequences, tables, constraints, indexes, permissions, and
  append-only guards;
- `0034_phase10_rls.sql`: RLS, safe column grants, read policies, and no authenticated DML; and
- `0035_phase10_functions.sql`: actor-aware lookup, mapping, sync/review, preview, and confirm RPCs.

Every new business table has RLS. Authenticated users receive safe selected columns only and no
direct insert/update/delete grants. Payloads and internal idempotency/result IDs are returned only
by narrowly scoped RPCs where needed. Cost columns remain inaccessible; only definer functions read
weighted averages and lot costs during an authorized posting. Service-role access remains
server-only and is not needed by the Phase 10 browser workflow.

All mutating RPCs are `SECURITY DEFINER`, set `search_path = public`, use `auth.uid()`, validate the
specific permission and branch, require a stable key and reason where a human decision occurs, use
advisory/row locks, and append an audit row in the same transaction. Append-only resolution,
mapping-command, and posting-link rows reject update/delete.

## UI and server boundaries

`/offline-pos` is permission-aware and contains four operational sections:

1. device drafts and sync queue for recount/production;
2. conflict review for authorized reviewers;
3. barcode lookup with scanner/manual fallback; and
4. Loyverse mappings plus CSV preview/confirmation for POS importers.

Server actions validate unknown input with Zod, repeat permission checks, call only session-bound
RPCs, return safe messages, and revalidate affected routes. No client component imports the admin
client, a service-role key, protected cost code, or a direct inventory mutation.

The page includes labelled controls, keyboard operation, destructive/confirm dialogs, responsive
cards/tables, online/offline and pending/synced/review/error status, empty states, warnings, errors,
loading skeletons, and light/dark tokens. Visible records use branch/item names, SKUs, barcodes,
and human references rather than UUIDs.

## Phase gate mapping

- **Scenario 17 — duplicate offline synchronization:** submit an ordinary recount variance with a
  stable key, prove one offline receipt, one recount adjustment transaction, one set of ledger
  lines, and one balance delta; replay and prove `replayed: true` with identical result and zero
  additional ledger/balance/lot rows. Production sync and POS confirm receive separate replay tests.
- **Scenario 18 — conflicting offline recounts:** create two drafts for the same item/branch and
  snapshot, sync the first, then sync the second. Prove only the first posts, the second is
  `review_required`, the balance reflects one decision, and an authorized explicit accept/reject
  with reason is required for any second outcome.
- **Scenario 24 — preview is side-effect-free:** count stock headers, lines, balances, and lots;
  preview a valid mapped CSV; prove all four inventory counts/values are unchanged; confirm and
  prove the expected `pos_sale`/`pos_refund` posting; replay confirm and prove no duplicates.

Additional real-Postgres tests cover all-role permission denial, branch scope, RLS/DML denial,
unmapped/duplicate rows, unusual recount review, production workflow preservation, mapping
idempotency, barcode ambiguity, append-only guards, audit evidence, and cost-column isolation.
Unit tests cover draft-store state transitions, CSV edge cases, and Zod limits. Playwright covers
desktop/mobile navigation, offline queue state, barcode fallback, importer preview/confirm dialogs,
and role-gated review/POS surfaces.

## Safe defaults and limitations

- Offline recounts use the device's last server snapshot and conflict on any later scoped ledger
  movement; this favors review over false auto-merges.
- One POS row becomes one ledger transaction for maximum traceability; later live integration may
  batch a receipt while retaining external-line uniqueness.
- CSV is the only POS ingestion surface in Phase 10. No Loyverse token, API call, webhook, or
  background sync exists.
- The service worker supports drafts in an already-loaded installed session. Secure cross-user
  cache eviction, background sync, and full offline cold start are Phase 11 hardening items.
