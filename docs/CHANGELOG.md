# Changelog

All notable changes to the Zombeans Inventory system. Kept per phase.
Format loosely follows Keep a Changelog. Dates are Asia/Manila.

## [Unreleased]

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
