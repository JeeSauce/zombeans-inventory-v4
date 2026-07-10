# Changelog

All notable changes to the Zombeans Inventory system. Kept per phase.
Format loosely follows Keep a Changelog. Dates are Asia/Manila.

## [Unreleased]

### Phase 1 — Authentication, Users, Roles & Security — 2026-07-10

Added

- Identity schema (migrations 0001–0005): profiles, roles, permissions, role_permissions,
  user_roles, email_code_challenges, audit_logs; 38-permission catalog + 4 system roles.
- RLS on all identity tables + `has_permission` / `is_super_admin` / `current_permissions` /
  `current_roles` SECURITY DEFINER helpers; explicit grants (authenticated + service_role).
- Protected Super Admin (triggers block disable/delete/demote + privileged-field escalation).
- Super Admin step-up email verification: CSPRNG 6-digit code, HMAC-hash at rest, ~5-min TTL,
  single-use, attempt- and rate-limited, fully audited; middleware gates a password-only Super
  Admin session to /verify until verified (signed httpOnly marker, edge-verified).
- Server permission enforcement, session middleware, force-logout of disabled accounts,
  password-reset request, append-only audit writer, provider-agnostic email (console transport).
- UI: login → step-up → dashboard; app shell (permission-gated sidebar + mobile nav, theme
  toggle, account menu); role-gated dashboard; user management (create/roles/enable-disable);
  audit-log viewer. Design system retokenized from the live site (Anton/Inter/JetBrains Mono,
  forest-green/cream/amber, dark + light).
- Dev seed (local-only, guarded); scan:bundle guard (scenario #23) wired into CI.

Tests

- 13 unit (step-up logic — scenarios 21, 22; localization), 11 RLS integration (permission
  helpers, profile scoping, sensitive-table lockdown, Super Admin protection), 8 Playwright e2e
  (auth happy + failure paths, step-up gate; desktop + mobile). Bundle scan confirms scenario 23.

### Phase 0 — Planning & Repository Foundation — 2026-07-10

Added

- Rewrote `CLAUDE.md` / `AGENTS.md` for the Next.js + Supabase stack (replacing prior static-site
  frontend rules).
- Repository scaffold: `package.json`, `tsconfig.json` (strict), `next.config.mjs`,
  Tailwind v4 (`postcss.config.mjs`, `app/globals.css` with Zombeans brand tokens),
  `app/layout.tsx`, `app/page.tsx` placeholder.
- Tooling: ESLint (flat config), Prettier, Vitest (+ setup, smoke test), Playwright, `components.json`
  (shadcn), PWA `manifest.webmanifest`, GitHub Actions CI.
- Environment validation (`lib/env.ts`, Zod) + `.env.example`; localization helpers (`lib/format.ts`),
  `lib/utils.ts` (cn).
- Supabase local config (`supabase/config.toml`) + migration folder scaffold.
- Documentation set (13 docs): SYSTEM_REQUIREMENTS, ARCHITECTURE, DATABASE_SCHEMA,
  ROLES_AND_PERMISSIONS, BUSINESS_RULES, UI_STRUCTURE, SUPABASE_SETUP, IMPLEMENTATION_PHASES,
  TESTING_STRATEGY, DEPLOYMENT, BACKUP_AND_RECOVERY, ASSUMPTIONS, CHANGELOG.
- Diagrams: ERD + workflow/state diagrams (ledger, production, transfer, purchase receiving,
  recount) in `docs/diagrams/`.

Notes

- No business modules yet (per Phase 0 scope). Next: Phase 1 — Auth, Users, Roles, Security.
