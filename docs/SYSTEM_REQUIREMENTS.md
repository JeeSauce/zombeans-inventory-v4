# System Requirements

## Purpose

Production-ready, multi-branch inventory management for **Zombeans** — a café/restaurant that is
also a central warehouse and production factory. The system tracks raw ingredients, production of
sub-products and portioned products, multi-branch stock, transfers, recounts, purchasing, and
costing, with strict role-based access and an auditable, append-only inventory ledger.

## Branches (4 permanent locations)

1. **Zombeans Main** — customer café + central warehouse + production factory + the ONLY raw
   ingredient store + source of stock distributed to other branches.
2. **Zombeans Roadkill** — holds prepared components only; requests/receives/recounts.
3. **Zombeans Plaza** — holds prepared components only; requests/receives/recounts.
4. **Zombeans Popup** — permanent location; individual popup engagements are separate event
   sessions linked to it.

Roadkill/Plaza/Popup never store raw production ingredients. Branch sales deduct prepared
sub-products/portioned products + packaging — never raw ingredients (see BUSINESS_RULES §Sales).

## Roles (see ROLES_AND_PERMISSIONS.md)

Super Admin · Branch Manager · Production Staff · Inventory Staff. Exactly one protected Super
Admin exists initially; granular permissions back the role names.

## Functional scope — MVP (Version 1)

1. Products & categories; unified inventory-item architecture (drinks, food, raw ingredients,
   sub-products, portioned products, packaging, reusable containers).
2. Ingredients, suppliers, unit conversions, weighted-average costing, lots/expiry (FEFO).
3. Recipes (multi-level, versioned), variant/modifier deductions, product costing.
4. Production templates, orders, inputs/outputs, yield/waste, batches, approvals.
5. Multi-branch stock: append-only ledger, balances, stock-in/out (+ batch), requests,
   transfers, receiving, discrepancies, negative-inventory alerts.
6. Recounts & daily control (start-of-day required), variances, day closing/reopening.
7. Calendar, popup event sessions, notifications, dashboard.
8. Reports + CSV/Excel/PDF exports, recycle bin, backups.
9. Offline drafts + sync queue; POS (Loyverse) mapping tables + CSV import preview (no live sync).

## Explicitly deferred to V2

- Live Loyverse API sync (5-min cron). Schema + import preview prepared now; no live posting.
- Selling-price auto-recommendations (manual in MVP; optional target-margin setting only).
- General attachment management for supplier docs.

## Non-functional requirements

- **Security**: RLS everywhere; service-role key server-only; sensitive costs hidden at UI+DB;
  step-up email verification for Super Admin; rate limiting on sensitive actions; 7-year audit
  retention (ledger effectively permanent).
- **Integrity**: atomic multi-table posting; idempotency keys; append-only ledger; historical
  cost snapshots immutable.
- **Availability/Offline**: PWA offline drafts for recount/production/stock counts + barcode scan.
- **Accessibility**: labelled controls, keyboard nav, confirmation dialogs, mobile-first.
- **Localization**: English, PHP `₱1,234.56`, Asia/Manila, form dates `MM/DD/YYYY`, human dates
  `Month D, YYYY`.
- **Performance**: derived balances for fast reads; indexed ledger; paginated tables.

## Constraints & assumptions

- Supplier communication happens manually outside the system (no "Sent to Supplier" status).
- VAT disabled by default; only computed when Super Admin enables it; tax config frozen on
  finalized records.
- Negative inventory is allowed when a valid transaction posts, but is flagged Critical and must
  be reconciled.
- See [`ASSUMPTIONS.md`](./ASSUMPTIONS.md) for recorded decisions on unspecified details.

## Success criteria (acceptance)

All 24 critical test scenarios in [`TESTING_STRATEGY.md`](./TESTING_STRATEGY.md) pass, and each
module meets the Definition of Done in [`IMPLEMENTATION_PHASES.md`](./IMPLEMENTATION_PHASES.md).
