# Testing Strategy

## Tooling

- **Vitest** — unit + integration (domain logic in `lib/**`, Zod schemas, RLS-via-service checks).
- **Playwright** — e2e happy + failure paths, desktop + mobile projects.
- **RLS authorization tests** — spin real Supabase (local) sessions per role and assert reads/
  writes are allowed/denied. These are first-class, not optional.

## Per-phase requirements

Unit · integration · RLS authorization · validation · error-state · mobile-layout checks · e2e
happy path · e2e failure path. A phase is not complete until its tests pass.

## Test data

Deterministic factories; seed clearly marked as development/test data; never seeded to production.

## The 24 critical scenarios (must all pass by Phase 11)

1. Unauthorized staff cannot view product costs. _(P4; enforced from P1 RLS)_
2. Production cannot consume expired inventory. _(P5)_
3. Production completion cannot partially post (atomicity). _(P5)_
4. Duplicate production submission does not deduct twice (idempotency). _(P5)_
5. Duplicate transfer receiving does not add stock twice. _(P6)_
6. Partial purchase delivery posts only accepted quantities. _(P3)_
7. Weighted-average cost updates correctly. _(P3)_
8. Historical transaction costs remain unchanged after price changes. _(P4)_
9. Branch sale recipes deduct prepared sub-products, not raw ingredients. _(P4/P6)_
10. Negative inventory stays visible and raises a Critical alert. _(P6)_
11. Recount variance creates the correct adjustment. _(P7)_
12. Closed days cannot be edited by ordinary staff. _(P7)_
13. Super Admin reopening requires a reason (and is audited). _(P7)_
14. Deleted records can be restored before the purge date. _(P9)_
15. Deleted records are purged when eligible. _(P9)_
16. Audit logs survive record deletion. _(P9)_
17. Offline duplicate synchronization is prevented. _(P10)_
18. Conflicting offline recounts require review. _(P10)_
19. Branch prices remain independent. _(P2)_
20. VAT is calculated only when enabled. _(P2)_
21. Email verification codes expire and cannot be reused. _(P1)_
22. Excessive code attempts are blocked. _(P1)_
23. Service-role credentials never appear in browser bundles. _(P1; CI bundle scan)_
24. POS import previews do not post inventory before confirmation. _(P10)_

## Scenario #23 enforcement

CI greps the client bundle (`.next/static`) for the service-role key pattern and fails on any hit;
`lib/supabase/admin.ts` carries `import "server-only"` so a client import is a build error.

## Coverage focus

Highest rigor on costing math (weighted-average, multi-level recipes, actual-yield cost), FEFO lot
selection, atomic posting, and idempotency — these are the correctness-critical paths.

## Commands

```bash
npm run test         # Vitest unit + integration
npm run test:e2e     # Playwright
npm run typecheck    # tsc --noEmit
npm run lint
```
