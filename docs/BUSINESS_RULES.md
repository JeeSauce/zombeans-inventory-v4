# Business Rules

Authoritative rules that server logic and RLS must enforce. Each rule maps to tests in
[`TESTING_STRATEGY.md`](./TESTING_STRATEGY.md).

## Costing

- Product cost = raw ingredients + sub-products + portioned products + disposable packaging +
  applicable expected waste. **Excluded (MVP):** labor, electricity, rent, overhead, delivery.
- Reusable containers (squeeze bottles, gallons) are NOT costed into output unless
  `is_consumable = true`.
- Valuation uses **weighted-average cost**; lots are tracked separately for expiry/FEFO but do not
  change the valuation method.
- Costs recalc when ingredient prices change, but **finalized records keep their cost snapshot** —
  production, transfers, receiving, adjustments, future POS sales, finalized reports never change.
- Actual-output costing: if a 2 kg → expected 20 L espresso batch yields 19.4 L, cost/mL uses the
  **actual** 19.4 L.
- Derived metrics: cost/batch, /output unit, /serving, /variant; gross profit, gross margin,
  food-cost %, markup %. Selling-price recommendations are manual; an optional global target
  margin never auto-changes prices.
- **Only Super Admin** may view or change cost/margin/supplier-price data (UI + DB enforced).

## Units & conversions

- All recipe math, weighted-average cost, balances, and production use **normalized base units**.
- Conversions from purchase unit → base unit per item (1 sack = 25 kg; 1 box = 100 pc; …).
- Cross-dimension conversions (kg↔l) are rejected unless an explicit item-specific conversion
  exists.

## Ingredients, lots & expiry

- Raw ingredients are stored **only at Main**.
- Production selects lots **FEFO** (first-expire-first-out).
- Expired lots: unavailable for production and transfers; still visible in recounts; trigger
  notifications; require a waste/disposal transaction; require manager confirmation before removal.

## Recipes

- Multi-level: raw → sub-product (e.g. Latin Mix) → finished (e.g. Spanish Latte). A produced
  sub-product automatically becomes available as a recipe input.
- Versioned; exactly one active version per recipe with an effective date.
- Every stock-affecting variant/modifier has its own recipe/deduction definition. Only relevant
  modifiers are shown for a given item.

## Production

- Flow: select → category → recipe/template → qty → compute inputs → check available & unexpired
  stock → show max producible → allow reduction if short → approve (if required) → start → record
  actual inputs/outputs → confirm → deduct inputs → add output to Main → make sub-product
  available → create batch/expiry → write audit + ledger.
- **Completion is atomic**: never deduct inputs unless output + ledger records also save.
- Duplicate submission (same idempotency key) must NOT deduct twice.
- Warnings when: actual output below acceptable yield; usage exceeds expected; waste over allowed
  %; over-time; ingredient unavailable/expired; failure.
- Production Staff submit; Branch Manager/Super Admin confirm ordinary output; exceptional
  variance needs Super Admin.

## Branch sales-deduction model

- Branches never deduct raw ingredients on a sale. Main converts raw → sub-products/portioned
  products first. Roadkill/Plaza/Popup and Main's café section consume **branch-held prepared
  components** + packaging.
- All branches (incl. Main café) must hold starting inventory of the prepared components and
  packaging they sell, so raw ingredients are never double-deducted.

## Stock ledger

- Append-only; the source of truth. Balances are a derived projection.
- Corrections create reversing/compensating entries; posted entries are never overwritten.
- **Negative inventory** allowed when a valid transaction posts, but: marked Critical; immediate
  in-app + email notification; requires investigation; shown prominently; never hideable; records
  cause; reconciled via documented adjustment/recount.

## Stock requests & transfers

- request → Main review → prepare → approve → in-transit → receiving branch counts → confirm →
  inventory updates on receipt → differences create discrepancies needing reason/resolution.
- Receiving is **idempotent** — confirming twice does not add stock twice.
- Popup transfers may link to a popup event; after the event: count remaining, return unused to
  Main, record consumed/waste/loss/gain, produce an event inventory summary.

## Recounts & daily control

- Start-of-day full recount required. Expected = opening + received + production output − transfers
  out − usage − stock-outs − waste. Variance = physical − expected.
- Adjustments require a reason; variance value from cost snapshots; unusual variances escalate.
- When a day is closed, ordinary staff cannot edit its transactions. Super Admin may reopen with a
  reason; reopening + all later changes are audited.

## Approval rules (defaults; thresholds configurable global + item override)

| Action                          | Approval                                   |
| ------------------------------- | ------------------------------------------ |
| Stock-in from approved PO       | receiving confirmation                     |
| Manual adjustment               | Branch Manager                             |
| High-value manual adjustment    | Super Admin                                |
| Waste over threshold            | Super Admin                                |
| Ordinary production output      | Production submit → Branch Manager confirm |
| Exceptional production variance | Super Admin                                |
| Recount variance                | Branch Manager                             |
| Unusual recount variance        | escalate to Super Admin                    |
| Transfer                        | prepare → approve → dispatch → receive     |
| Expired-item disposal           | Manager confirmation                       |
| Closed-period modification      | Super Admin only                           |

**Unusual adjustment signals:** % of expected stock, peso-value threshold, repeated adjustments by
one employee, adjustment after closing, negative-inventory creation, missing linked recount,
missing reason, high wastage frequency.

## Purchasing

- Managers create requests/PO drafts; only Super Admin approves official POs unless delegated.
- No "Sent to Supplier" status (supplier comms are manual/offline).
- Receiving records ordered/delivered/accepted/rejected/damaged/missing, expiry, lot, actual unit
  cost, checklist, optional photo, receiver, timestamp. Shortages/substitutions/damage/price diffs
  require review before finalizing. Accepted qty auto-creates stock-in + updates weighted-average.
- Payment statuses: unpaid, partially paid, paid, overdue, cancelled, refunded. Supplier returns
  adjust inventory + payables.

## Tax (VAT)

- Disabled by default; computed only when Super Admin enables; inclusive or exclusive; the applied
  tax config is **frozen on finalized records** so historical amounts never change.

## Retention

- Supported business roots are soft-deleted for 30 days. The actor must hold that entity's write
  permission; only Super Admin can restore or run purge. Every lifecycle command requires a reason,
  is idempotent, and appends an audit record.
- Purge skips any record with an active explicit retention hold, an inbound business dependency, or
  ledger/accounting history. Audit history is retained independently and survives an otherwise
  eligible business-record purge; an audit row alone does not make every record permanently
  unpurgeable.
- Audit logs are retained ≥ 7 years. Stock transactions, transaction lines, lots, balances, cost
  snapshots, and other critical ledger/accounting history are never lifecycle roots and are
  effectively permanent.
