# AGENTS.md — Zombeans Inventory System

This repository is a Next.js + Supabase multi-branch inventory management application.
For the full working agreement, coding rules, security constraints, and branding, see
[`CLAUDE.md`](./CLAUDE.md) — it is the single source of truth for both human and AI contributors.

## Quick facts

- **Stack:** Next.js (App Router, TS strict), Supabase (Postgres/Auth/Storage, RLS), Tailwind +
  shadcn/ui, React Hook Form + Zod, TanStack Query/Table, Recharts, PWA, Vercel, Vitest + Playwright.
- **Golden rule:** inventory quantities change ONLY through server-side atomic Postgres functions
  that write an append-only ledger, guarded by idempotency keys. Never from client components.
- **Secrets:** the Supabase service-role key is server-only. Never ship it to the browser.
- **Phases:** work proceeds in controlled phases — see [`docs/IMPLEMENTATION_PHASES.md`](./docs/IMPLEMENTATION_PHASES.md).
- **Assumptions:** record any unspecified decision in [`docs/ASSUMPTIONS.md`](./docs/ASSUMPTIONS.md).

The prior static-website rules (serve.mjs / screenshot workflow) are removed as of 2026-07-10.
