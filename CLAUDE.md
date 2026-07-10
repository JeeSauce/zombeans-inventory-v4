# CLAUDE.md — Zombeans Inventory System

Production-ready, multi-branch inventory management for the Zombeans café & restaurant.
This file governs how Claude works in this repository. It supersedes the previous
static-HTML frontend rules (removed 2026-07-10; this is a full application, not a landing page).

## Stack (current stable)

- **Next.js (App Router) + TypeScript strict** — server-first, Server Actions / Route Handlers
- **Supabase**: Postgres + Auth + Storage; **RLS on every business table**
- **Tailwind CSS + shadcn/ui**; **React Hook Form + Zod**; **TanStack Query + TanStack Table**; **Recharts**
- **PWA** (offline recount/production drafts); **Vercel** deploy
- **Vitest** (unit/integration) + **Playwright** (e2e)

## Non-negotiable security rules

1. The browser NEVER mutates inventory quantities. All stock changes go through server-side,
   validated, atomic `SECURITY DEFINER` Postgres functions writing the append-only ledger.
2. The Supabase **service-role key** is server-only. Never import it into a client component
   or any `"use client"` module. Guard `lib/supabase/admin.ts` with `import "server-only"`.
3. Never bypass RLS for convenience. RLS is the backstop even when server checks exist.
4. Sensitive cost / supplier-price / settings data is gated at BOTH the UI and DB layers
   (role-gated views / functions). Hiding a button is not access control.
5. Every stock movement, POS import, offline submission, production completion, and purchase
   receiving is protected by an **idempotency key**.
6. The ledger is append-only. Corrections create reversing/compensating entries — never edits.
7. Preserve historical cost snapshots; never recompute finalized records.

## Working rules

- Build in the phases defined in `docs/IMPLEMENTATION_PHASES.md`. Do not implement the whole
  app in one unverified generation. Complete → test → document each phase before the next.
- Do not display raw DB UUIDs in the UI. Show names, SKUs, barcodes, human references.
- Every major page needs loading, empty, success, warning, and error states.
- Accessibility: labelled controls, keyboard nav, confirmation dialogs, mobile-friendly.
- When a minor detail is unspecified, choose the safest simplest option and record it in
  `docs/ASSUMPTIONS.md`.
- Consult official docs before using version-sensitive APIs.

## Localization

- English · Philippine peso `₱1,234.56` · Asia/Manila · form dates `MM/DD/YYYY` ·
  human dates `Month D, YYYY`. Store timestamps in UTC; convert for Asia/Manila display.

## Branding (from `assets/`)

- Accent **Zombie Green `#31E11A`**, Brain Pink `#E7A8B9`, Coffee Bean Brown `#A7632B`,
  Dark Roast `#1A1A14`, Soft White `#F7F6F2`, Charcoal `#2A2A2A`.
- Headings **Poppins SemiBold**; body **Inter Regular**. Rounded outline icons, rounded buttons.
- Restrained zombie/coffee theme: accents, icons, empty states, alerts — never at the cost of
  readability. Operational clarity first. Light + dark mode.

## Definition of Done (per module)

Migrations + RLS + Zod validation + server logic + real-data UI + loading/error states +
audit logging + tested permissions + verified mobile + passing tests + updated docs +
no critical TS/lint/build/security errors.

## Do NOT

- Do not use the old `serve.mjs` / `screenshot.mjs` static workflow (removed).
- Do not update inventory directly from UI components.
- Do not commit credentials or backups with production data.
- Do not seed fake data into production.
