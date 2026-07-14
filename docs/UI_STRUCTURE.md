# UI Structure & Route Map

## Design principles

Minimal, clean, professional, fast, beginner-friendly, responsive. Restrained zombie/coffee
branding (accents, icons, empty states, alerts) — readability first. Light + dark mode. Desktop
sidebar, collapsible tablet sidebar, simplified mobile nav. Never show raw UUIDs.

## Global shell

- **Sidebar** (desktop) / collapsible (tablet) / bottom-nav + drawer (mobile).
- **Top bar**: global search, branch switcher (where relevant), notifications bell, theme toggle,
  account menu.
- **Breadcrumbs**, **status badges**, **critical alert banner** (negative inventory, expired lots).
- **States on every major page**: skeleton loading, empty, success, warning, error.

## Route map (App Router)

```
/                                     → redirect to /dashboard (auth) or /login
(auth)
  /login                              email + password; Super Admin → step-up code
  /verify                             step-up 6-digit code entry
  /reset-password  /activate
(app)
  /dashboard                          KPIs, alerts, upcoming events (role-filtered cards)
  /catalog
    /products            /products/[sku]
    /variants            /modifiers
    /categories          /units
    /items               unified inventory items
  /ingredients           /ingredients/[sku]           (Main only; lots, expiry)
  /suppliers             /suppliers/[id]
  /purchasing
    /orders              /orders/[ref]
    /receiving           /receiving/[ref]              checklist
    /returns
  /recipes               /recipes/[id]                versions, cost breakdown (Super Admin)
  /costing                                             (Super Admin only)
  /production
    /orders              /orders/[ref]
    /templates           /batches
  /inventory
    /stock               balances per branch
    /stock-in  /stock-out  /adjustments
    /ledger              append-only movements
  /transfers
    /requests            /requests/[ref]
    /prepare  /receive  /discrepancies
  /recounts
    /new                 /[ref]                        start-of-day, cycle, etc.
    /variances
  /calendar                                            month / week / agenda
  /popups              /popups/[id]                    event sessions
  /reports               /reports/[type]               filters + CSV/Excel/PDF/print
  /notifications
  /offline-pos                                         device drafts, conflicts, scan, POS staging
  /admin                                               (Super Admin)
    /users   /roles   /permissions   /settings
    /audit   /recycle-bin   /backups
```

## Mobile priority actions (thumb-reachable)

Scan item · Start recount · Record production · Sync device drafts · Request stock · Receive
transfer · Report waste.

## Phase 10 offline and POS surface

- `/offline-pos` is permission composed: operational roles receive device-local drafts and
  barcode lookup; `offline.review` adds conflict cards and reasoned decision dialogs; `pos.import`
  adds Loyverse mappings, CSV upload/preview, and an explicit confirmation dialog.
- Draft creation is online because the server must issue a scoped snapshot receipt. Editing and
  retrying are offline-capable through IndexedDB, with stable human labels and no raw UUID display.
- The service worker caches only static GET assets and an offline fallback. It never intercepts,
  queues, replays, or fabricates a mutation request; the application queue owns sync state.
- CSV preview shows per-row mapped item, converted base quantity, validation status, and totals.
  Confirmation is unavailable for any invalid/unmapped/duplicate row and clearly identifies the
  irreversible ledger posting boundary.

## Phase 9 report and recovery surfaces

- `/reports` shows all four operational reports to authenticated roles and adds the two financial
  reports only for `cost.read`. Detail pages use bounded date, accessible-branch, category, and
  item-type filters; exports and print share the visible authorized result.
- `/admin/recycle-bin` is Super-Admin recovery tooling. It shows human labels, dates, dependency/
  hold state, reasoned restore, and confirmed eligible purge—never raw UUIDs.
- `/admin/backups` is a status, policy, history, and restore-drill guide. Empty metadata is an
  explicit warning, not a false success state; backup and restore execution stay external.

## Dashboard cards (role-filtered)

Total inventory value* · Low-stock · Out-of-stock · Today's production · Pending stock requests ·
Branch stock levels · Most-used ingredients · Recent movements · **Critical negative inventory** ·
Failed production · Recount variances · Upcoming events.
Filters: date range, branch, category, item type. *Financial cards hidden from unauthorized roles.

## Accessibility & interaction

- Labelled inputs, keyboard navigation, focus-visible rings (Zombie Green), confirmation dialogs
  for destructive/irreversible actions.
- Animate only `transform`/`opacity`; spring-style easing; no `transition-all`.
- Status badges: Draft/Pending/Approved/Posted/Reversed, Critical (destructive), Warning, Success.

## Offline UX (PWA)

Clear offline / queued / syncing / conflict / failed / synchronized states on recount and
production drafts. Barcode scanning remains read-only. Conflicts require review; never overwrite a
newer confirmed count. Only server snapshot receipts and stable idempotency keys cross the
device/server trust boundary.
