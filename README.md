# Zombeans Inventory

Production-ready, multi-branch inventory management for the **Zombeans** café & restaurant —
central warehouse, production factory, and four branches (Main, Roadkill, Plaza, Popup).

> **Status:** Phase 1 (Auth, Users, Roles & Security) complete. Phase 2 (Catalog) is next.
> See [`docs/IMPLEMENTATION_PHASES.md`](docs/IMPLEMENTATION_PHASES.md).
>
> Local dev: `npx supabase start` → `npm run seed:dev` → `npm run dev`. Sign in with
> `superadmin@zombeans.dev` / `Zombeans!Dev123` (step-up code prints to the server console).

## Stack

Next.js (App Router, TS strict) · Supabase (Postgres + Auth + Storage, RLS) · Tailwind v4 +
shadcn/ui · React Hook Form + Zod · TanStack Query/Table · Recharts · PWA · Vercel · Vitest +
Playwright.

## Getting started

```bash
cp .env.example .env.local     # fill in Supabase + email values
npx supabase start             # local DB/Auth/Storage (needs Docker)
npm install
npm run dev                    # http://localhost:3000
```

Quality gates:

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

## Documentation

| Doc                                                    | Purpose                               |
| ------------------------------------------------------ | ------------------------------------- |
| [SYSTEM_REQUIREMENTS](docs/SYSTEM_REQUIREMENTS.md)     | Scope, branches, roles, NFRs          |
| [ARCHITECTURE](docs/ARCHITECTURE.md)                   | Layers, data flow, security model     |
| [DATABASE_SCHEMA](docs/DATABASE_SCHEMA.md)             | Normalized schema by context          |
| [ROLES_AND_PERMISSIONS](docs/ROLES_AND_PERMISSIONS.md) | Permission matrix + enforcement       |
| [BUSINESS_RULES](docs/BUSINESS_RULES.md)               | Costing, production, stock, approvals |
| [UI_STRUCTURE](docs/UI_STRUCTURE.md)                   | Route map + UX conventions            |
| [SUPABASE_SETUP](docs/SUPABASE_SETUP.md)               | Environments, auth, RLS, storage      |
| [IMPLEMENTATION_PHASES](docs/IMPLEMENTATION_PHASES.md) | Phase plan + Definition of Done       |
| [TESTING_STRATEGY](docs/TESTING_STRATEGY.md)           | Tooling + 24 critical scenarios       |
| [DEPLOYMENT](docs/DEPLOYMENT.md)                       | Vercel + migration pipeline           |
| [BACKUP_AND_RECOVERY](docs/BACKUP_AND_RECOVERY.md)     | Backup/restore procedures             |
| [ASSUMPTIONS](docs/ASSUMPTIONS.md)                     | Recorded decisions                    |
| [CHANGELOG](docs/CHANGELOG.md)                         | Per-phase changes                     |
| [diagrams/](docs/diagrams/)                            | ERD + workflow/state diagrams         |

## Security first

Inventory quantities change ONLY through server-side atomic Postgres functions writing an
append-only ledger, guarded by idempotency keys and RLS. The service-role key is server-only.
See [`CLAUDE.md`](CLAUDE.md) for the full working agreement.
