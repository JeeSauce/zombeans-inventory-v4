# Testing Strategy

## Tooling

- **Vitest** — unit + integration (domain logic in `lib/**`, Zod schemas, RLS-via-service checks).
- **Playwright** — e2e happy + failure paths, desktop + mobile projects.
- Playwright serializes shared seeded-database flows and runs the production build. Its console
  email override is accepted only with an explicit test flag and a loopback Supabase URL.
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

## Phase 11 critical-scenario evidence map

Every scenario has an automated gate; real-Postgres tests run serially after a clean database
reset. File/test names below are stable review anchors rather than a claim based only on phase
labels.

| #   | Automated evidence                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `tests/integration/recipes.test.ts` - “enforces critical scenario 1 at the function and table layers”; `rls.test.ts` permission gate |
| 2   | `tests/integration/production.test.ts` - expired/quarantined FEFO skip and expired-only refusal                                      |
| 3   | `tests/integration/production.test.ts` - “rolls back all lots, balances, ledger rows, and order status when any input is short”      |
| 4   | `tests/integration/production.test.ts` - duplicate completion returns the existing transaction without double mutation               |
| 5   | `tests/integration/stock.test.ts` - idempotent transfer receiving with exact lot/balance/ledger/discrepancy counts                   |
| 6   | `tests/integration/purchasing.test.ts` - partial delivery posts only accepted quantity and blocks over-receipt                       |
| 7   | `tests/integration/purchasing.test.ts` plus `tests/unit/costing.test.ts` - exact weighted-average blend and replay                   |
| 8   | `tests/integration/recipes.test.ts` - activation snapshot remains unchanged after source cost changes                                |
| 9   | `tests/integration/recipes.test.ts` - sale recipes reject raw inputs and consume the prepared sub-product boundary                   |
| 10  | `tests/integration/stock.test.ts` - exact negative balance, full ledger quantity, and active Critical alert                          |
| 11  | `tests/integration/recounts.test.ts` - frozen formula and one exact compensating adjustment                                          |
| 12  | `tests/integration/recounts.test.ts` - function and direct-RLS writes rejected after day close                                       |
| 13  | `tests/integration/recounts.test.ts` - Super Admin reason, single audit/replay, and later-change attribution                         |
| 14  | `tests/integration/phase9.test.ts` - hidden soft delete, Super Admin listing, exact restore, idempotent replay                       |
| 15  | `tests/integration/phase9.test.ts` - eligible purge with in-window, held, dependency, and ledger protection                          |
| 16  | `tests/integration/phase9.test.ts` - pre-existing and purge audit rows survive business-row removal                                  |
| 17  | `tests/integration/phase10.test.ts` - duplicate offline submission adds no second submission/recount/ledger/balance effect           |
| 18  | `tests/integration/phase10.test.ts` - stale overlapping recount is held for explicit reasoned review                                 |
| 19  | `tests/integration/catalog.test.ts` - independent branch prices plus atomic full-form insert/update/delete                           |
| 20  | `tests/integration/catalog.test.ts` and `tests/unit/tax.test.ts` - VAT disabled/default, none/inclusive/exclusive behavior           |
| 21  | `tests/unit/stepup.test.ts` - expiry and consumed-code single-use rejection                                                          |
| 22  | `tests/unit/stepup.test.ts` - max-attempt lockout even when the later code is correct                                                |
| 23  | `npm run scan:bundle` - configured service-role marker must be absent from every `.next/static` file; `server-only` import backstop  |
| 24  | `tests/integration/phase10.test.ts` - preview is inventory-side-effect-free; explicit confirmation posts once                        |

Phase 11 additionally runs `hardening.test.ts` (definer/grant/index controls),
`rls-penetration.test.ts` (all tables x roles x verbs plus branch bypass),
`deployment-config.test.ts`, `email.test.ts`, and `accessibility.spec.ts`.

## Scenario #23 enforcement

CI greps the client bundle (`.next/static`) for the service-role key pattern and fails on any hit;
`lib/supabase/admin.ts` carries `import "server-only"` so a client import is a build error.

## Phase 8 gate (not one of the numbered scenarios)

- **Notification dedup/severity:** real Postgres must prove one active notification per stable
  condition, append-only re-raise/resolution/read/ack/delivery history, all eight source-to-severity
  mappings, Critical-only email, targeted RLS, and idempotent claim/finalize delivery.
- **Dashboard role gating:** Branch Manager, Production Staff, and Inventory Staff must fail when
  calling the financial RPC directly. Super Admin must receive exact valuation, and the operational
  RPC must not contain cost/value fields.
- **Calendar/popup safety:** permission tests cover manager mutation versus staff read-only access;
  popup completion must validate a summary without changing balances or the append-only ledger.

## Phase 9 gate

- **Reports and exports:** all operational roles receive only accessible-branch, cost-free report
  data; direct financial RPC calls require `cost.read`. CSV formula injection and protected-field
  leakage are rejected, and CSV/Excel/PDF output is derived from the same validated report result.
- **Lifecycle scenarios 14–16:** real Postgres proves restore before purge, eligible purge, and
  dependency/hold-blocked purge. Direct lifecycle updates and hard deletes are rejected, while
  idempotent command replays do not duplicate history.
- **Backup metadata:** only `service_role` records sanitized backup-run metadata; only
  `backup.manage` can read status/history. Browser coverage verifies truthful empty status when no
  external infrastructure has reported a run.

## Phase 10 gate

- **Scenario 17 — idempotent offline sync:** real Postgres submits the same server-scoped recount
  draft twice with one idempotency key and proves the second call returns the first result without
  adding another submission, recount, ledger transaction, ledger line, or balance change.
- **Scenario 18 — explicit conflict review:** two server snapshots of the same branch/date/item are
  submitted after the first count posts. The second is held as `review_required`, changes no
  inventory, and can transition only through a reasoned `offline.review` decision.
- **Scenario 24 — preview is staging only:** CSV preview leaves transactions, lines, balances, and
  lots byte-for-byte unchanged. Explicit confirmation posts exactly one ledger transaction per
  external line, and replay adds nothing.
- Permission/RLS coverage also proves Inventory Staff cannot import POS data or directly insert
  submission rows, POS staging is hidden from that role, barcode lookup is read-only and
  cost-free, and a snapshot receipt cannot be used by another actor.
- Phase 10 integration files run serially with the rest of the real-Postgres suite because all
  files share one local database; this prevents teardown deadlocks without weakening assertions.

## Coverage focus

Highest rigor on costing math (weighted-average, multi-level recipes, actual-yield cost), FEFO lot
selection, atomic posting, offline conflict detection, preview/confirm separation, and idempotency
— these are the correctness-critical paths.

## Commands

```bash
npm run test              # Vitest unit tests
npm run test:integration  # Vitest against local Postgres
npm run test:recovery     # Focused Phase 9 restore/purge/backup drill
npm run test:e2e          # Playwright: Chromium + Pixel 7
npm run typecheck         # tsc --noEmit
npm run lint
```
