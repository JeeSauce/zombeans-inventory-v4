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
  /admin                                               (Super Admin)
    /users   /roles   /permissions   /settings
    /audit   /recycle-bin   /backups
    /pos                 mappings + CSV import preview (V2 prep)
```

## Mobile priority actions (thumb-reachable)

Scan item · Start recount · Record production · Request stock · Receive transfer · Report waste.

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

Clear offline / queued / syncing / conflict / failed / synchronized states on recount, production,
and stock-count drafts and barcode scans. Conflicts require review; never overwrite a newer
confirmed count.
