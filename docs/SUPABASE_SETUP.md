# Supabase Setup

Three isolated environments. **Staging and production use SEPARATE Supabase projects.**

| Env        | Database                            | Auth emails                 | Notes                           |
| ---------- | ----------------------------------- | --------------------------- | ------------------------------- |
| Local      | Supabase CLI (Docker)               | Inbucket (`:54324`)         | `supabase start`; seed dev data |
| Staging    | Supabase project "zombeans-staging" | test provider               | preview deploys                 |
| Production | Supabase project "zombeans-prod"    | live provider (Resend/SMTP) | protected                       |

## Prerequisites

- Docker Desktop (for local `supabase start`).
- Supabase CLI (installed as a dev dependency; `npx supabase --version`).
- A Supabase account + two hosted projects (staging, prod) — created by the owner. The Supabase
  MCP connector must be authorized in an interactive session to manage hosted projects from here.

## Local development

```bash
cp .env.example .env.local          # fill NEXT_PUBLIC_* + SUPABASE_SERVICE_ROLE_KEY (local keys)
npx supabase start                  # boots Postgres/Auth/Storage/Studio/Inbucket
npm run db:reset                    # apply migrations + seed (dev data only)
npm run dev
```

Local anon/service keys are printed by `supabase start`. Studio: http://localhost:54323.

## Migrations

- Numbered SQL in `supabase/migrations/` applied in order: **schema → constraints/indexes → RLS
  policies → SECURITY DEFINER functions**.
- Create: `npx supabase migration new <name>`; apply locally: `npm run db:migrate` or
  `npm run db:reset` (rebuild from scratch).
- Push to hosted: `npx supabase db push` (staging first, then prod after verification).

## Auth configuration

- Self-signup disabled — accounts are created by the Super Admin.
- Email confirmations enabled; password reset + activation flows.
- **Super Admin step-up**: after password success, a 6-digit code is generated server-side, only a
  hash stored (`email_code_challenges`), TTL ~5 min, single-use, attempt- and rate-limited, all
  attempts audited. A full-privilege session is issued only after verification.
- Configure the transactional email provider via env (`EMAIL_PROVIDER`, `RESEND_API_KEY` / SMTP).
  Local uses the `console` transport / Inbucket.

## Storage

- Buckets: `product-images`, `production-photos`, `receiving-photos` (private by default; signed
  URLs). 10 MiB limit. RLS-style storage policies per role/branch.

## Secrets & keys

- `NEXT_PUBLIC_*` (URL + anon key) are safe for the browser.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only — set in Vercel project env (not `NEXT_PUBLIC_`),
  never in client bundles. Enforced by `import "server-only"` in `lib/supabase/admin.ts`.
- Rotate keys on staff offboarding; never commit real values.

## Row Level Security

RLS enabled on all business tables with explicit policies per role (Super Admin, Branch Manager,
Production, Inventory), branch scoping via `user_branch_assignments`, and sensitive columns behind
role-gated views/functions. See [`ROLES_AND_PERMISSIONS.md`](./ROLES_AND_PERMISSIONS.md) and the
RLS authorization tests in [`TESTING_STRATEGY.md`](./TESTING_STRATEGY.md).
