# Design: Edit inventory items

Date: 2026-07-15
Branch: `feature/catalog-item-editing`
Base: `main`

## Problem

Inventory items can be created and listed, but there is no way to edit one after
creation. The only server action is `createItemAction`; the list is read-only. A Super
Admin (who holds `catalog.item.write`) has no edit affordance, so fixing a typo or
adjusting a reorder level currently requires a workaround. There is also no UI to retire
an item — the `active` flag exists and is shown as a badge, but nothing can change it.

## Goal

Add editing for an existing inventory item, plus an activate/deactivate toggle, reusing
the existing create patterns. App-layer only — no schema, RLS, or migration changes.

## Non-goals

- Deleting items (soft-delete / recycle bin is a separate Phase 9 concern).
- Editing other catalog entities (products, suppliers, categories) — separate follow-ups.
- Bulk editing.

## Database (no changes required)

`0007_catalog_rls.sql` already provides everything needed:

- Column-level `UPDATE` grant to `authenticated` covering all editable columns
  (name, item_type, category_id, base_unit_id, purchase_unit_id, low_stock_threshold,
  reorder_level, trackable, batch_tracked, expiry_tracked, is_consumable, image_url,
  storage_notes, active, updated_by, version, …), deliberately omitting the sensitive
  `weighted_avg_cost`.
- RLS policy `inventory_items_write` (`for all`) gated on
  `has_permission(auth.uid(), 'catalog.item.write')`.

So an update issued on the session (RLS-enforced) client succeeds only for a
`catalog.item.write` holder, exactly like the existing create path.

## Editable vs locked fields

Editable: name, category, purchase unit, low-stock threshold, reorder level, tracking
flags (trackable / consumable / batch_tracked / expiry_tracked), storage notes, and
**active** (new toggle).

Locked after creation: **item type** and **base unit**. Changing base unit silently
invalidates every quantity already recorded against the item; changing item type can
violate recipe-composition rules the app enforces. SKU is auto-generated and never
changes.

## Server action — `updateItemAction`

Added to `app/(app)/catalog/items/actions.ts`.

- Signature mirrors `createItemAction`: `(itemId, prevState, formData) => ActionState`.
  The item id is bound via `.bind`/hidden field so the action stays a form action.
- Gate: `requirePermission("catalog.item.write")` (same as create).
- Validate with the existing `inventoryItemSchema`.
- **Locked-field enforcement is server-side, not UI-only.** The update writes only the
  allowed columns and never applies a client-supplied `item_type` or `base_unit_id`,
  even if present in the form payload. Hiding/disabling those inputs in the UI is a
  convenience, not the control.
- Update via the session client:
  `supabase.from("inventory_items").update({...allowed}).eq("id", itemId)`, relying on
  RLS for authorization.
- **Concurrency:** read the item's `version` when the dialog opens and submit it back;
  the update is guarded (`.eq("version", submittedVersion)`) so a stale edit affects
  zero rows and returns a friendly "this item was updated elsewhere — reload and try
  again." Exact `version` maintenance (trigger vs. explicit increment) is confirmed
  during implementation; if guarding adds disproportionate complexity, fall back to
  last-write-wins and note it in the spec/PR.
- Audit: `writeAudit` with `before` (current row values) and `after` (new values), then
  `revalidatePath("/catalog/items")`.
- Returns the same `ItemActionState` shape (`{ error?, info? }`) for inline form errors
  and a success toast.

## UI — edit dialog

In `components/catalog/items-client.tsx`:

- An **Edit** button (pencil icon) on each table row, rendered only when `canWrite`.
- Opens a dialog reusing the create form fields, pre-filled with the row's current
  values (the page already loads the fields needed; extend the row projection with the
  editable fields + `version`).
- **Item type** and **base unit** inputs are shown but **disabled**, with a short
  "can't be changed after creation" helper note.
- Adds an **Active / Inactive** control (checkbox or switch) bound to `active`.
- Reuses the existing dialog / form / validation styling; extract shared form fields so
  create and edit do not duplicate the field markup.

## Testing

- **Unit** (`tests/unit`): `updateItemAction`
  - rejects a caller without `catalog.item.write`;
  - a valid edit updates the allowed fields;
  - a payload attempting to change `item_type` / `base_unit_id` leaves them unchanged;
  - toggling `active` works;
  - audit log receives before/after.
- **E2E** (`tests/e2e`): as Super Admin, edit an item's name and reorder level and see
  the change in the list; deactivate an item and see the badge flip to "inactive".

## Definition of done

Zod validation + server logic + real-data UI (loading/error/success states) + audit
logging + tested permissions + passing unit/e2e + lint/typecheck/build clean + updated
docs (CHANGELOG, this spec). No new migrations.
