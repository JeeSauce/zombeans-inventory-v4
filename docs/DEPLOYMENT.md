# Deployment

## Targets

- **Vercel** hosts the Next.js app. Two Vercel environments: Preview (per-PR / staging) and
  Production, each bound to its own Supabase project.

## Environment variables (Vercel project settings)

Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`.
Server-only (NOT `NEXT_PUBLIC_`): `SUPABASE_SERVICE_ROLE_KEY`, email provider secrets, step-up
tuning. Set separately for Preview and Production scopes. See `.env.example`.

## Pipeline

1. PR opened → CI (`.github/workflows/ci.yml`): format check, lint, typecheck, tests, build.
2. Vercel builds a **Preview** deployment against the **staging** Supabase project.
3. Migrations to staging: `npx supabase db push` (linked to staging), verify, run e2e.
4. Merge to `main` → Vercel **Production** build.
5. Migrations to production: `npx supabase db push` (linked to prod) as a gated step, after a
   staging dry run. Never auto-migrate prod on every push.

## Release checklist

- [ ] CI green (lint, typecheck, unit/integration, build).
- [ ] e2e happy + failure paths pass on staging.
- [ ] All applicable critical scenarios pass.
- [ ] RLS authorization tests pass against staging.
- [ ] Bundle scan confirms no service-role key in client output (scenario #23).
- [ ] Migrations reviewed and applied to staging, then production.
- [ ] Backups verified (see BACKUP_AND_RECOVERY.md).
- [ ] Accessibility + mobile spot-checks done.
- [ ] Rollback plan noted (previous Vercel deployment + DB restore point).

## Rollback

- App: promote the previous Vercel deployment.
- DB: forward-only migrations; destructive changes ship with a tested compensating migration.
  Restore from the latest verified backup if data corruption is suspected.

## Domains & PWA

- Custom domain on Vercel; HTTPS enforced. PWA manifest + service worker served from `/`.
