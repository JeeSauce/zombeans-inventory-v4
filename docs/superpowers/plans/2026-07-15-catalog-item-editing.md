# Inventory Item Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `catalog.item.write` holder edit an existing inventory item's descriptive fields and toggle it active/inactive, with item type and base unit locked after creation.

**Architecture:** A pure payload builder computes the allowed update columns (never item type or base unit). A new `updateItemAction` server action gates on `catalog.item.write`, applies the payload via the RLS-enforced session client guarded by the row's `version`, and writes a before/after audit entry. The items list gains a per-row Edit dialog reusing the create form fields.

**Tech Stack:** Next.js App Router server actions, Supabase (session client + RLS), Zod, React `useActionState`, Vitest (unit + integration/real-Postgres), Playwright (e2e).

## Global Constraints

- No database migrations — the `UPDATE` grant and `inventory_items_write` RLS policy already exist (`0007_catalog_rls.sql`).
- Item type (`item_type`) and base unit (`base_unit_id`) are LOCKED after creation and MUST NOT be writable — enforced server-side, not just hidden in UI.
- The sensitive `weighted_avg_cost` column is never read or written by this feature.
- Writes go through the session client (`@/lib/supabase/server` `createClient`), never the admin client; RLS is the real gate.
- `version` is auto-incremented by the existing `tg_set_updated_at` trigger — guard on the old value, never set it manually.
- Every mutation writes an audit entry via `writeAudit` (before + after).
- Run `npm run format` before any commit; CI runs `prettier --check` first and fails fast.

---

### Task 1: Pure update-payload builder

**Files:**

- Create: `lib/catalog/item-update.ts`
- Test: `tests/unit/catalog-item-update.test.ts`

**Interfaces:**

- Consumes: `InventoryItemInput` from `@/lib/validation/catalog`.
- Produces: `buildItemUpdatePayload(input: InventoryItemInput, opts: { active: boolean; actorId: string }): ItemUpdatePayload` and the `ItemUpdatePayload` interface (snake_case DB columns; excludes `item_type` and `base_unit_id`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/catalog-item-update.test.ts
import { describe, it, expect } from "vitest";
import { buildItemUpdatePayload } from "@/lib/catalog/item-update";
import type { InventoryItemInput } from "@/lib/validation/catalog";

const base: InventoryItemInput = {
  name: "Milo",
  itemType: "raw_ingredient",
  categoryId: "11111111-1111-1111-1111-111111111111",
  baseUnitId: "22222222-2222-2222-2222-222222222222",
  purchaseUnitId: null,
  lowStockThreshold: 5,
  reorderLevel: 10,
  trackable: true,
  batchTracked: false,
  expiryTracked: false,
  isConsumable: true,
  storageNotes: "Dry store",
};

describe("buildItemUpdatePayload", () => {
  it("maps editable fields to DB columns", () => {
    const p = buildItemUpdatePayload(base, { active: true, actorId: "actor-1" });
    expect(p).toEqual({
      name: "Milo",
      category_id: "11111111-1111-1111-1111-111111111111",
      purchase_unit_id: null,
      low_stock_threshold: 5,
      reorder_level: 10,
      trackable: true,
      batch_tracked: false,
      expiry_tracked: false,
      is_consumable: true,
      storage_notes: "Dry store",
      active: true,
      updated_by: "actor-1",
    });
  });

  it("never includes locked columns even though input carries them", () => {
    const p = buildItemUpdatePayload(base, { active: false, actorId: "a" }) as Record<
      string,
      unknown
    >;
    expect("item_type" in p).toBe(false);
    expect("base_unit_id" in p).toBe(false);
    expect(p.active).toBe(false);
  });

  it("normalizes nullish optionals to null", () => {
    const p = buildItemUpdatePayload(
      {
        ...base,
        categoryId: null,
        purchaseUnitId: null,
        lowStockThreshold: null,
        reorderLevel: null,
        storageNotes: null,
      },
      { active: true, actorId: "a" },
    );
    expect(p.category_id).toBeNull();
    expect(p.low_stock_threshold).toBeNull();
    expect(p.storage_notes).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/catalog-item-update.test.ts`
Expected: FAIL — cannot find module `@/lib/catalog/item-update`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/catalog/item-update.ts
import type { InventoryItemInput } from "@/lib/validation/catalog";

/**
 * Columns an edit is allowed to change. `item_type` and `base_unit_id` are intentionally
 * excluded: changing base unit silently invalidates recorded quantities, and changing item
 * type can violate recipe-composition rules. This exclusion is the real control — the UI only
 * hides those inputs for convenience.
 */
export interface ItemUpdatePayload {
  name: string;
  category_id: string | null;
  purchase_unit_id: string | null;
  low_stock_threshold: number | null;
  reorder_level: number | null;
  trackable: boolean;
  batch_tracked: boolean;
  expiry_tracked: boolean;
  is_consumable: boolean;
  storage_notes: string | null;
  active: boolean;
  updated_by: string;
}

export function buildItemUpdatePayload(
  input: InventoryItemInput,
  opts: { active: boolean; actorId: string },
): ItemUpdatePayload {
  return {
    name: input.name,
    category_id: input.categoryId ?? null,
    purchase_unit_id: input.purchaseUnitId ?? null,
    low_stock_threshold: input.lowStockThreshold ?? null,
    reorder_level: input.reorderLevel ?? null,
    trackable: input.trackable,
    batch_tracked: input.batchTracked,
    expiry_tracked: input.expiryTracked,
    is_consumable: input.isConsumable,
    storage_notes: input.storageNotes ?? null,
    active: opts.active,
    updated_by: opts.actorId,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/catalog-item-update.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Format and commit**

```bash
npm run format
git add lib/catalog/item-update.ts tests/unit/catalog-item-update.test.ts
git commit -m "feat(catalog): pure inventory-item update payload builder"
```

---

### Task 2: Integration test — DB update contract (RLS + version guard)

**Files:**

- Create: `tests/integration/catalog-item-update.test.ts`

**Interfaces:**

- Consumes: `connect`, `createUser`, `assignRole`, `asUser`, `cleanupUsers` from `./helpers/db`.
- Produces: nothing consumed by later tasks; locks in the DB behavior `updateItemAction` relies on.

This test hits the real local Supabase. It proves: a `catalog.item.write` holder can update via the RLS client; the `version` trigger increments; a stale-version guard matches zero rows; a non-writer is denied. Requires local Supabase running with migrations applied (`npx supabase db reset`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/catalog-item-update.test.ts
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, assignRole, cleanupUsers, connect, createUser } from "./helpers/db";

const EMAIL_LIKE = "item-edit+%@zombeans.test";
let admin: Client;
let acting: Client;
const users = { super: "", inventory: "" };
let itemId = "";
let unitId = "";

beforeAll(async () => {
  admin = await connect();
  acting = await connect();
  await cleanupUsers(admin, EMAIL_LIKE);
  users.super = await createUser(admin, "item-edit+super@zombeans.test");
  users.inventory = await createUser(admin, "item-edit+inv@zombeans.test");
  await assignRole(admin, users.super, "super_admin");
  await assignRole(admin, users.inventory, "inventory");
  unitId = (await admin.query<{ id: string }>(`select id from public.units limit 1`)).rows[0]!.id;
  itemId = (
    await admin.query<{ id: string }>(
      `insert into public.inventory_items (name, sku, item_type, base_unit_id, created_by, updated_by)
       values ('Edit Target', 'ITM-EDIT-1', 'raw_ingredient', $1, $2, $2) returning id`,
      [unitId, users.super],
    )
  ).rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await admin.query(`delete from public.inventory_items where sku = 'ITM-EDIT-1'`);
  await cleanupUsers(admin, EMAIL_LIKE);
  await acting.end();
  await admin.end();
});

describe("inventory_items update contract", () => {
  it("lets a catalog.item.write holder update and bumps version via trigger", async () => {
    const after = await asUser(acting, users.super, async (c) => {
      const before = await c.query<{ version: number }>(
        `select version from public.inventory_items where id = $1`,
        [itemId],
      );
      const upd = await c.query<{ id: string; version: number; name: string }>(
        `update public.inventory_items set name = 'Edited', reorder_level = 42, updated_by = $2
         where id = $1 and version = $3 returning id, version, name`,
        [itemId, users.super, before.rows[0]!.version],
      );
      return upd.rows[0]!;
    });
    expect(after.name).toBe("Edited");
    expect(after.version).toBe(2);
  });

  it("guards a stale version to zero rows", async () => {
    const rows = await asUser(acting, users.super, async (c) => {
      const upd = await c.query(
        `update public.inventory_items set name = 'Stale' where id = $1 and version = 1 returning id`,
        [itemId],
      );
      return upd.rowCount;
    });
    expect(rows).toBe(0);
  });

  it("denies a user without catalog.item.write", async () => {
    await expect(
      asUser(acting, users.inventory, (c) =>
        c.query(`update public.inventory_items set name = 'Nope' where id = $1`, [itemId]),
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);
  });
});
```

- [ ] **Step 2: Run to verify it passes against the existing schema**

Run: `npx vitest run tests/integration/catalog-item-update.test.ts --no-file-parallelism`
Expected: PASS (3 tests). (This is a characterization test — the DB already supports the contract; it locks it in.)

- [ ] **Step 3: Commit**

```bash
npm run format
git add tests/integration/catalog-item-update.test.ts
git commit -m "test(catalog): lock in inventory_items update RLS + version contract"
```

---

### Task 3: `updateItemAction` server action

**Files:**

- Modify: `app/(app)/catalog/items/actions.ts`

**Interfaces:**

- Consumes: `buildItemUpdatePayload` (Task 1); `requirePermission` from `@/lib/permissions`; `writeAudit` from `@/lib/audit`; `createClient` from `@/lib/supabase/server`; `inventoryItemSchema` from `@/lib/validation/catalog`.
- Produces: `updateItemAction(itemId: string, prev: ItemActionState, formData: FormData): Promise<ItemActionState>` — bound with the item id via `.bind(null, itemId)` in the client.

- [ ] **Step 1: Add the action** (append to `app/(app)/catalog/items/actions.ts`)

```ts
import { buildItemUpdatePayload } from "@/lib/catalog/item-update";

/** Edit an existing item. Locked fields (type, base unit) are never written. catalog.item.write. */
export async function updateItemAction(
  itemId: string,
  _prev: ItemActionState,
  formData: FormData,
): Promise<ItemActionState> {
  const { user } = await requirePermission("catalog.item.write");

  const version = Number(formData.get("version"));
  if (!Number.isInteger(version)) return { error: "Missing item version. Reload and try again." };

  const parsed = inventoryItemSchema.safeParse({
    name: formData.get("name"),
    itemType: formData.get("itemType"),
    categoryId: nullableUuid(formData.get("categoryId")),
    baseUnitId: formData.get("baseUnitId"),
    purchaseUnitId: nullableUuid(formData.get("purchaseUnitId")),
    lowStockThreshold: nullableNumber(formData.get("lowStockThreshold")),
    reorderLevel: nullableNumber(formData.get("reorderLevel")),
    trackable: formData.get("trackable") === "on",
    batchTracked: formData.get("batchTracked") === "on",
    expiryTracked: formData.get("expiryTracked") === "on",
    isConsumable: formData.get("isConsumable") === "on",
    storageNotes: formData.get("storageNotes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("inventory_items")
    .select(
      "name, category_id, purchase_unit_id, low_stock_threshold, reorder_level, trackable, batch_tracked, expiry_tracked, is_consumable, storage_notes, active",
    )
    .eq("id", itemId)
    .single();

  const payload = buildItemUpdatePayload(parsed.data, {
    active: formData.get("active") === "on",
    actorId: user.id,
  });

  const { data: updated, error } = await supabase
    .from("inventory_items")
    .update(payload)
    .eq("id", itemId)
    .eq("version", version)
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message.replace(/^.*?:\s*/, "") };
  if (!updated) return { error: "This item was updated elsewhere. Reload and try again." };

  await writeAudit({
    actorId: user.id,
    action: "item.updated",
    entityType: "inventory_item",
    entityId: itemId,
    before,
    after: payload,
  });
  revalidatePath("/catalog/items");
  return { info: `Updated ${payload.name}.` };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Format and commit**

```bash
npm run format
git add app/(app)/catalog/items/actions.ts
git commit -m "feat(catalog): updateItemAction with version guard and locked fields"
```

---

### Task 4: Edit UI — shared form fields, edit dialog, active toggle

**Files:**

- Modify: `app/(app)/catalog/items/page.tsx` (extend row projection with editable fields + `version`)
- Modify: `components/catalog/items-client.tsx` (extract shared fields; add Edit button + dialog)

**Interfaces:**

- Consumes: `updateItemAction` (Task 3).
- Produces: `ItemRow` extended with `categoryId`, `purchaseUnitId`, `baseUnitId`, `itemType` label source, `lowStockThreshold`, `reorderLevel`, `trackable`, `batchTracked`, `expiryTracked`, `isConsumable`, `storageNotes`, `version`.

- [ ] **Step 1: Extend the page projection** — in `page.tsx`, widen the `inventory_items` select and the `Raw`/`ItemRow` mapping to include: `category_id, purchase_unit_id, base_unit_id, low_stock_threshold, reorder_level, trackable, batch_tracked, expiry_tracked, is_consumable, storage_notes, version`. Map them onto each `ItemRow` (camelCase). Keep the existing `category`/`base_unit` name joins for display.

- [ ] **Step 2: Extract shared form fields** — in `items-client.tsx`, move the field markup currently inside `CreateItemDialog`'s `<form>` (name, type, category, base unit, purchase unit, thresholds, the checkbox fieldset, storage notes) into a new component:

```tsx
function ItemFormFields({
  itemType,
  setItemType,
  categories,
  units,
  scopedCategories,
  defaults,
  lockStructural,
}: {
  itemType: string;
  setItemType: (v: string) => void;
  categories: (OptionRow & { itemType: string })[];
  units: OptionRow[];
  scopedCategories: (OptionRow & { itemType: string })[];
  defaults?: Partial<ItemRow>;
  lockStructural?: boolean;
}) {
  // identical field markup as the current create form, with two changes:
  //  - each input uses `defaultValue` from `defaults` when provided
  //  - the Type <select> and Base unit <select> get `disabled={lockStructural}`
  //    and, when locked, a sibling <p className="text-muted-foreground text-xs">
  //    "Can't be changed after creation." Their current values are still submitted
  //    via hidden inputs so the schema parse succeeds.
}
```

`CreateItemDialog` renders `<ItemFormFields ... />` (no defaults, not locked). Verify create still works after extraction.

- [ ] **Step 3: Add the edit dialog + row button**

```tsx
function EditItemDialog({
  item,
  categories,
  units,
}: {
  item: ItemRow;
  categories: (OptionRow & { itemType: string })[];
  units: OptionRow[];
}) {
  const [open, setOpen] = useState(false);
  const [itemType, setItemType] = useState<string>(item.itemType);
  const action = updateItemAction.bind(null, item.id);
  const [state, formAction] = useActionState<ItemActionState, FormData>(action, {});
  useEffect(() => {
    if (state.info) {
      toast.success(state.info);
      setOpen(false);
    }
  }, [state]);
  const scopedCategories = useMemo(
    () => categories.filter((c) => c.itemType === itemType),
    [categories, itemType],
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Edit ${item.name}`}>
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {item.name}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <input type="hidden" name="version" value={item.version} />
          <ItemFormFields
            itemType={itemType}
            setItemType={setItemType}
            categories={categories}
            units={units}
            scopedCategories={scopedCategories}
            defaults={item}
            lockStructural
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="active"
              defaultChecked={item.active}
              className="accent-primary"
            />
            Active (uncheck to retire this item)
          </label>
          <div className="flex justify-end">
            <EditSubmit />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}
```

Import `Pencil` from `lucide-react` and `updateItemAction` from the actions module. In the table body, add a right-aligned actions `<TableCell>` that renders `{canWrite && <EditItemDialog item={it} categories={categories} units={units} />}`, plus a matching `<TableHead />`.

- [ ] **Step 4: Verify build + types**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all PASS; `/catalog/items` still builds.

- [ ] **Step 5: Format and commit**

```bash
npm run format
git add app/(app)/catalog/items/page.tsx components/catalog/items-client.tsx
git commit -m "feat(catalog): edit dialog with locked structural fields and active toggle"
```

---

### Task 5: E2E — edit and deactivate as Super Admin, plus changelog

**Files:**

- Modify: `tests/e2e/catalog.spec.ts`
- Modify: `docs/CHANGELOG.md`

**Interfaces:**

- Consumes: the running app + seeded DB. Super Admin needs the step-up bypass (email code isn't automatable), same technique as `tests/e2e/accessibility.spec.ts` (`completeLocalSuperAdminStepUp`: log in, then set the `zb_stepup` cookie computed via HMAC-SHA256 over `stepup:<userId>` keyed by `STEPUP_CODE_PEPPER`).

- [ ] **Step 1: Write the failing e2e** — append to `tests/e2e/catalog.spec.ts`:

```ts
import { createHmac } from "node:crypto";
import { Client } from "pg";

const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const STEPUP_PEPPER = process.env.STEPUP_CODE_PEPPER ?? "local-dev-stepup-pepper-change-me";

async function loginSuperAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("superadmin@zombeans.dev");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/verify$/);
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ id: string }>(
      `select id from auth.users where email = 'superadmin@zombeans.dev'`,
    );
    const marker = createHmac("sha256", STEPUP_PEPPER)
      .update(`stepup:${rows[0]!.id}`)
      .digest("hex");
    await page
      .context()
      .addCookies([
        { name: "zb_stepup", value: marker, url: new URL(page.url()).origin, httpOnly: true },
      ]);
  } finally {
    await db.end();
  }
}

test("super admin edits and deactivates an inventory item", async ({ page }) => {
  await loginSuperAdmin(page);
  await page.goto("/catalog/items");

  // Create a throwaway item to edit.
  const sku = `E2E ${Date.now()}`;
  await page.getByRole("button", { name: /add item/i }).click();
  await page.getByLabel("Name").fill(sku);
  await page.getByLabel("Base unit").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Create item" }).click();
  const row = page.getByRole("row", { name: new RegExp(sku) });
  await expect(row).toBeVisible();

  // Edit: rename + deactivate.
  await row.getByRole("button", { name: new RegExp(`Edit ${sku}`) }).click();
  await page.getByLabel("Name").fill(`${sku} edited`);
  await page.getByLabel(/Active/).uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();

  const editedRow = page.getByRole("row", { name: new RegExp(`${sku} edited`) });
  await expect(editedRow).toBeVisible();
  await expect(editedRow.getByText("inactive")).toBeVisible();
});
```

- [ ] **Step 2: Run it** (needs local Supabase + build + seed)

Run: `npx supabase db reset && npm run seed:dev && npx playwright test tests/e2e/catalog.spec.ts --workers=1`
Expected: PASS (existing catalog tests + the new one).

- [ ] **Step 3: Update the changelog** — add under the current unreleased section of `docs/CHANGELOG.md`:

```markdown
- Inventory items can now be edited (name, category, purchase unit, thresholds, tracking flags, storage notes) and activated/deactivated by `catalog.item.write` holders. Item type and base unit remain locked after creation. Concurrent edits are guarded by row version.
```

- [ ] **Step 4: Format and commit**

```bash
npm run format
git add tests/e2e/catalog.spec.ts docs/CHANGELOG.md
git commit -m "test(catalog): e2e edit + deactivate item; changelog"
```

---

## Final verification (after all tasks)

Run the full gate suite the project uses:

```bash
npm run format:check && npm run lint && npm run typecheck && npm run test && npm run build
npx supabase db reset && npm run test:integration
npx supabase db reset && npm run seed:dev && npm run test:e2e -- --workers=1
```

All green → open a PR into `main` for review before merge.
