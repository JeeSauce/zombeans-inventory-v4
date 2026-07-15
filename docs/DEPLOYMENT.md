# Deployment

## Current boundary

Phase 11 prepares code and operator instructions only. No Vercel project has been created or
linked, no hosted Supabase setting has been changed, no real secret has been entered, and no
preview or production deployment has been promoted.

- Vercel team: **Zombeans** (`team_l1xJAIg6ZB0zY19O4b0t7Mgo`)
- Vercel project: **operator TODO - does not exist yet**
- Intended framework: Next.js on Vercel, detected from the repository
- Build: `npm ci` then `npm run build`
- Output: Next.js/Vercel framework default; no custom output directory

[`vercel.json`](../vercel.json) deliberately contains only framework, install, and build settings.
The operator owns project creation, Git connection, access controls, domains, environment scopes,
and promotion.

## Environment model

| Vercel scope | Supabase target             | Data                 | Promotion rule          |
| ------------ | --------------------------- | -------------------- | ----------------------- |
| Preview      | separate staging project    | disposable/test only | PR verification         |
| Production   | separate production project | real business data   | explicit human approval |

Never point Preview at production. Configure every scope independently; do not use a shared
service-role key or step-up pepper.

## Required Vercel variables

Use [`.env.example`](../.env.example) as the inventory and enter values only in Vercel's encrypted
environment settings.

| Variable                        | Preview                             | Production                        | Notes                                        |
| ------------------------------- | ----------------------------------- | --------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | staging API URL                     | production API URL                | Public by design.                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging public/anon key             | production public/anon key        | RLS remains mandatory.                       |
| `NEXT_PUBLIC_SITE_URL`          | stable HTTPS preview/staging origin | canonical HTTPS production origin | Must exactly match auth redirect allowlists. |
| `SUPABASE_SERVICE_ROLE_KEY`     | staging server secret               | production server secret          | Bypasses RLS; server runtime only.           |
| `EMAIL_PROVIDER`                | `resend` for realistic staging      | `resend`                          | `console` is rejected in production.         |
| `EMAIL_FROM`                    | verified staging sender             | verified production sender        | Verify the sending domain first.             |
| `RESEND_API_KEY`                | staging/restricted key              | production/restricted key         | Server-only; never expose to browser code.   |
| `E2E_ALLOW_CONSOLE_EMAIL`       | unset                               | unset                             | Local Playwright only; never set in Vercel.  |
| `STEPUP_CODE_PEPPER`            | unique random secret                | different unique random secret    | At least 32 random bytes recommended.        |
| `STEPUP_CODE_TTL_SECONDS`       | `300`                               | `300` unless approved otherwise   | Set explicitly for reviewability.            |
| `STEPUP_MAX_ATTEMPTS`           | `5`                                 | `5` unless approved otherwise     | Set explicitly.                              |
| `STEPUP_RATE_LIMIT_PER_HOUR`    | `5`                                 | `5` unless approved otherwise     | Set explicitly.                              |
| `APP_TIMEZONE`                  | `Asia/Manila`                       | `Asia/Manila`                     | Business-date authority.                     |
| `APP_DEFAULT_CURRENCY`          | `PHP`                               | `PHP`                             | Display/default currency.                    |

Do **not** set `SUPABASE_DB_URL` on the Vercel application; it is for local/CI integration tests.
Leave `LOYVERSE_API_TOKEN` and all SMTP variables unset. Phase 10 has no live Loyverse sync, and
this release implements Resend rather than SMTP.

## Production checklist

### 1. Repository and release evidence

- [ ] Review and merge the Phase 11 PR only after all CI jobs are green.
- [ ] Confirm the release commit is tagged or otherwise recorded for rollback.
- [ ] Review [`SECURITY_REVIEW.md`](./reports/SECURITY_REVIEW.md) and
      [`PHASE_11.md`](./reports/PHASE_11.md).
- [ ] Confirm `npm audit --omit=dev` has no unresolved high/critical production finding, or record
      an explicit accepted-risk owner and expiry.

### 2. Create isolated hosted infrastructure (operator only)

- [ ] Create/verify separate staging and production Supabase projects.
- [ ] Enable the selected managed backup/PITR plan and record retention outside the repository.
- [ ] Configure Supabase Auth URLs/providers, password policy, self-signup setting, and redirect
      allowlists through the hosted dashboard. Do not change bypass roles.
- [ ] Verify the Resend sending domain (SPF/DKIM) and create separate restricted API keys.
- [ ] Create a Vercel project under the **Zombeans** team and connect the Git repository.
- [ ] Keep automatic production promotion disabled until the database/app release order below is
      rehearsed on staging.

### 3. Apply and verify the staging database

- [ ] Link the Supabase CLI to **staging only** in the operator's secured environment.
- [ ] Review a dry run, then apply numbered migrations `0001` through `0036` (and any later
      reviewed migration) in order. Never paste database credentials into a command transcript.
- [ ] Run the full database/RLS suite against staging with test-only accounts and disposable data.
- [ ] Confirm every public business table has RLS, anonymous DML is denied, and branch-isolation
      probes pass.
- [ ] Run the scratch-restore procedure in [`BACKUP_AND_RECOVERY.md`](./BACKUP_AND_RECOVERY.md) and
      record RTO/RPO evidence.

### 4. Seed/bootstrap safely

- [ ] Do **not** run `npm run seed:dev` against staging or production.
- [ ] Migrations seed only controlled reference configuration such as roles, permissions, units,
      and baseline catalog settings.
- [ ] Create the first protected Super Admin through an operator-reviewed bootstrap procedure;
      verify the Auth user, protected profile flag, and `super_admin` role in one controlled window.
- [ ] Add explicit `user_branch_assignments` for every Production and Inventory account before it
      begins work; those roles fail closed when unassigned. Branch Manager retains the documented
      MVP global fallback only while it has no assignments.
- [ ] Use the application to create later staff accounts, then complete their branch assignments
      through an operator-reviewed database/admin procedure. Do not import the local demo users,
      branches, transactions, or test passwords.

### 5. Configure and verify Vercel Preview

- [ ] Enter only staging values in Preview scope and production values only in Production scope.
- [ ] Confirm the service-role key, Resend key, and pepper are not available to client-side build
      code and do not use a `NEXT_PUBLIC_` prefix.
- [ ] Deploy a Preview from the release branch. Do not use a production secret in Preview.
- [ ] Inspect response headers: CSP, HSTS on HTTPS production-mode responses, `nosniff`, frame
      denial, referrer policy, camera-only permissions, and cache rules for service-worker assets.
- [ ] Run login/step-up email, dashboard, receiving, production completion, stock transfer,
      recount, offline conflict, POS preview/confirm, reports, recycle restore, and backup-status
      smoke tests on desktop and phone.
- [ ] Confirm `/sw.js` and `/offline.html` revalidate; hashed `/_next/static` assets retain Next.js
      immutable caching.

### 6. Production release (operator approval required)

- [ ] Announce a release window and confirm a fresh verified restore point.
- [ ] Apply reviewed migration `0036`+ to production before promoting app code that calls its new
      RPCs. Validate migration history and hot-path indexes.
- [ ] Create the protected bootstrap user if this is the first release, then verify step-up email.
- [ ] Promote the reviewed Vercel deployment to Production only after database and environment
      checks pass.
- [ ] Repeat the smoke tests with non-destructive production checks and verify audit entries.
- [ ] Monitor authentication failures, function/runtime errors, email delivery, database load,
      negative inventory alerts, and Core Web Vitals during the release window.

## Security and cache choices

`next.config.mjs` applies a restrictive baseline CSP, same-origin framing/form/base rules,
`nosniff`, strict referrer policy, HSTS in production, and a Permissions Policy that keeps camera
access available for barcode scanning while disabling unused sensitive capabilities. Inline style
and script allowances remain because the current Next.js runtime and component stack require them;
removing them requires a nonce-based CSP project and is not hidden behind this release.

The service worker and offline fallback always revalidate so a rollback or security fix is not
masked by stale shell code. The manifest uses a short stale-while-revalidate window; brand/icons
use a one-day cache because their filenames are not content-hashed. Next.js owns dynamic-page and
hashed static-asset caching.

## Rollback

1. Stop promotion and preserve logs/audit evidence.
2. App-only regression: promote the previously verified Vercel deployment.
3. Database regression without corruption: ship a reviewed forward compensating migration. Do not
   edit or delete applied migration files.
4. Suspected data corruption: stop writes, preserve the current state, and follow the human-approved
   PITR/export restore procedure. Never run a destructive restore from the web application.
5. Re-run RLS, ledger invariants, critical smoke tests, and backup verification before reopening.

Migration `0036` is additive/tightening (functions, policies, indexes). Rolling the app back may
leave these safe database controls in place; weakening them requires a separate security review.
