# Architecture

## Overview

A single Next.js (App Router, TypeScript strict) application deployed on Vercel, backed by
Supabase (Postgres + Auth + Storage). Security is defense-in-depth: the browser never mutates
inventory; all stock changes flow through validated, atomic, idempotent Postgres functions and
are enforced again by Row Level Security.

## Layers

```
Browser (React client components, TanStack Query cache, RHF+Zod forms, PWA offline queue)
      │  calls
      ▼
Server Actions / Route Handlers (Next.js, run under the user's Supabase session)
      │  authorize (server permission check) + validate (shared Zod)
      ▼
Postgres SECURITY DEFINER functions (atomic multi-table posting, idempotency keys)
      │
      ▼
Postgres tables + RLS policies (backstop) · append-only ledger · derived balances
```

### 1. Client

- React 19 Server Components by default; `"use client"` only where interactivity is needed.
- **TanStack Query** owns server-state cache, optimistic updates, and refetch.
- **RHF + Zod** for forms; the same Zod schemas (`lib/validation`) validate on the server.
- **PWA**: service worker caches reference data; IndexedDB queue holds offline recount/production
  drafts with local id + idempotency key; a sync engine replays them when online.
- Never imports `lib/supabase/admin.ts` or `getServerEnv()`.

### 2. Server (Next.js)

- **Server Actions** for mutations, **Route Handlers** for webhooks/exports/cron.
- `lib/supabase/server.ts` — request-scoped client using the user's cookies (RLS applies).
- `lib/supabase/admin.ts` — service-role client, `import "server-only"`, used ONLY for
  privileged tasks that legitimately bypass RLS (e.g. issuing step-up codes, backups). Every
  such use is audited.
- **Permission checks** (`lib/permissions`) run before any privileged action; they mirror RLS so
  failures are caught early with good UX, but are never the sole line of defense.

### 3. Database (Supabase Postgres)

- **Append-only ledger** (`stock_transactions` + `_lines`) is the source of truth for movement.
- **`inventory_balances`** is a derived projection maintained by posting functions (fast reads).
- **`inventory_lots`** track batch/expiry for FEFO; weighted-average cost stored per item.
- **SECURITY DEFINER functions** perform every multi-table inventory operation inside one
  transaction with an idempotency key; partial posting is impossible.
- **RLS** on every business table. Sensitive columns (cost, supplier price) are exposed only via
  role-gated views/functions, so unauthorized roles cannot read them even via direct API calls.

## Key cross-cutting concerns

- **Idempotency**: `idempotency_key` unique per logical operation; re-submits return the original
  result instead of double-posting. Applies to stock moves, production completion, transfer
  receiving, purchase receiving, POS import, offline sync.
- **Cost snapshots**: finalized records copy the cost-in-effect; later price changes never mutate
  history.
- **Audit**: `audit_logs` capture actor, action, entity, before/after (safe), reason, correlation
  id. Never store secrets/tokens/codes.
- **Optimistic concurrency**: `version` column on editable rows; stale writes are rejected.
- **Soft delete**: `deleted_at`/`deleted_by` + 30-day recycle bin; audit survives purges.

## Data flow example — completing a production batch

1. Production Staff submit actual inputs/outputs (Server Action, Zod-validated).
2. Server checks `production.confirm` permission and that lots are unexpired.
3. Calls `fn_complete_production(order_id, idempotency_key, …)` (SECURITY DEFINER):
   deduct inputs (FEFO lots) → add output lot → write ledger entries → update balances →
   snapshot cost → audit — all atomic.
4. On success, produced sub-product becomes available as a recipe input; TanStack Query
   invalidates affected queries.

## Environments

Local (Supabase CLI) · Staging (separate Supabase project) · Production (separate Supabase
project). See [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) and [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Technology choices & rationale

| Concern         | Choice              | Why                                                   |
| --------------- | ------------------- | ----------------------------------------------------- |
| Framework       | Next.js App Router  | Server-first, colocated server actions, Vercel-native |
| DB/Auth/Storage | Supabase            | Postgres + RLS + Auth in one, matches security model  |
| Server-state    | TanStack Query      | Cache, retries, offline-friendly                      |
| Tables          | TanStack Table      | Headless, accessible, large datasets                  |
| Validation      | Zod                 | One schema shared client↔server                       |
| Forms           | React Hook Form     | Performant, accessible                                |
| Charts          | Recharts            | Dashboard/report visuals                              |
| Tests           | Vitest + Playwright | Fast unit/integration + real e2e incl. RLS            |
