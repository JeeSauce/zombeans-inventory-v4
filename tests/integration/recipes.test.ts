import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, assignRole, cleanupUsers, connect, createUser } from "./helpers/db";

const EMAIL_PATTERN = "%@recipe-phase4.test";

let admin: Client;
let acting: Client;

const ids = {
  super: "",
  manager: "",
  production: "",
  inventory: "",
  unit_g: "",
  unit_pc: "",
  raw: "",
  sub: "",
  finished: "",
  packaging: "",
  container: "",
  subB: "",
  product: "",
  modifier: "",
  priceOnlyModifierOption: "",
  productionRecipe: "",
  productionV1: "",
  productionLineRaw: "",
  saleRecipe: "",
  saleV1: "",
  saleSnapshot: "",
  productionRecipeB: "",
  productionBV1: "",
  productionV2Cycle: "",
  productionV3: "",
};

async function runAsUserAndCommit<T>(
  userId: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  await acting.query("begin");
  try {
    await acting.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await acting.query("set local role authenticated");
    const result = await fn(acting);
    await acting.query("commit");
    return result;
  } catch (error) {
    await acting.query("rollback");
    throw error;
  }
}

async function insertItem(
  name: string,
  sku: string,
  itemType: string,
  unitId: string,
  weightedAvgCost: number,
  isConsumable = true,
): Promise<string> {
  const result = await admin.query(
    `insert into public.inventory_items
       (name, sku, item_type, base_unit_id, weighted_avg_cost, is_consumable, created_by, updated_by)
     values ($1, $2, $3::public.item_type, $4, $5, $6, $7, $7)
     returning id`,
    [name, sku, itemType, unitId, weightedAvgCost, isConsumable, ids.super],
  );
  return result.rows[0].id as string;
}

async function insertRecipe(
  name: string,
  kind: "production" | "sale",
  outputItemId: string,
  productId?: string,
): Promise<string> {
  const result = await admin.query(
    `insert into public.recipes
       (name, kind, output_item_id, product_id, created_by, updated_by)
     values ($1, $2::public.recipe_kind, $3, $4, $5, $5)
     returning id`,
    [name, kind, outputItemId, productId ?? null, ids.super],
  );
  return result.rows[0].id as string;
}

async function insertVersion(
  recipeId: string,
  versionNumber: number,
  outputQty: number,
  outputUnitId: string,
): Promise<string> {
  const result = await admin.query(
    `insert into public.recipe_versions
       (recipe_id, version_number, output_qty, output_unit_id, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $5)
     returning id`,
    [recipeId, versionNumber, outputQty, outputUnitId, ids.super],
  );
  return result.rows[0].id as string;
}

async function insertLine(
  versionId: string,
  itemId: string,
  qty: number,
  isPackaging = false,
): Promise<string> {
  const result = await admin.query(
    `insert into public.recipe_lines
       (recipe_version_id, input_item_id, qty, is_packaging, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $5)
     returning id`,
    [versionId, itemId, qty, isPackaging, ids.super],
  );
  return result.rows[0].id as string;
}

async function activate(versionId: string): Promise<Record<string, unknown>> {
  const result = await runAsUserAndCommit(ids.super, (client) =>
    client.query<{ result: Record<string, unknown> }>(
      `select public.activate_recipe_version($1) as result`,
      [versionId],
    ),
  );
  return result.rows[0]!.result;
}

beforeAll(async () => {
  admin = await connect();
  acting = await connect();

  ids.super = await createUser(admin, "super@recipe-phase4.test");
  ids.manager = await createUser(admin, "manager@recipe-phase4.test");
  ids.production = await createUser(admin, "production@recipe-phase4.test");
  ids.inventory = await createUser(admin, "inventory@recipe-phase4.test");
  await assignRole(admin, ids.super, "super_admin");
  await assignRole(admin, ids.manager, "branch_manager");
  await assignRole(admin, ids.production, "production");
  await assignRole(admin, ids.inventory, "inventory");

  const units = await admin.query(`select code, id from public.units where code in ('g', 'pc')`);
  for (const row of units.rows) {
    if (row.code === "g") ids.unit_g = row.id as string;
    if (row.code === "pc") ids.unit_pc = row.id as string;
  }

  ids.raw = await insertItem("Recipe Test Raw", "RECIPETEST-RAW", "raw_ingredient", ids.unit_g, 10);
  ids.sub = await insertItem("Recipe Test Mix", "RECIPETEST-SUB", "sub_product", ids.unit_g, 0);
  ids.finished = await insertItem("Recipe Test Drink", "RECIPETEST-DRINK", "drink", ids.unit_pc, 0);
  ids.packaging = await insertItem(
    "Recipe Test Cup",
    "RECIPETEST-CUP",
    "packaging",
    ids.unit_pc,
    2,
  );
  ids.container = await insertItem(
    "Recipe Test Reusable Bottle",
    "RECIPETEST-CONTAINER",
    "container",
    ids.unit_pc,
    250,
    false,
  );
  ids.subB = await insertItem(
    "Recipe Test Mix B",
    "RECIPETEST-SUB-B",
    "sub_product",
    ids.unit_g,
    0,
  );

  const product = await admin.query(
    `insert into public.products (item_id, product_kind, created_by, updated_by)
     values ($1, 'drink', $2, $2) returning id`,
    [ids.finished, ids.super],
  );
  ids.product = product.rows[0].id as string;

  const modifier = await admin.query(
    `insert into public.modifiers (product_id, name, created_by, updated_by)
     values ($1, 'Recipe Test Size', $2, $2) returning id`,
    [ids.product, ids.super],
  );
  ids.modifier = modifier.rows[0].id as string;
  const modifierOption = await admin.query(
    `insert into public.modifier_options
       (modifier_id, name, affects, price_delta, created_by, updated_by)
     values ($1, 'Recipe Test Price Only', 'price', 5, $2, $2) returning id`,
    [ids.modifier, ids.super],
  );
  ids.priceOnlyModifierOption = modifierOption.rows[0].id as string;

  ids.productionRecipe = await insertRecipe("Recipe Test Mix Production", "production", ids.sub);
  ids.productionV1 = await insertVersion(ids.productionRecipe, 1, 100, ids.unit_g);
  ids.productionLineRaw = await insertLine(ids.productionV1, ids.raw, 50);
  await activate(ids.productionV1);

  ids.saleRecipe = await insertRecipe("Recipe Test Drink Sale", "sale", ids.finished, ids.product);
  ids.saleV1 = await insertVersion(ids.saleRecipe, 1, 1, ids.unit_pc);
  await insertLine(ids.saleV1, ids.sub, 10);
  await insertLine(ids.saleV1, ids.packaging, 1, true);
  await insertLine(ids.saleV1, ids.container, 1, true);
  const saleActivation = await activate(ids.saleV1);
  ids.saleSnapshot = saleActivation.snapshot_id as string;
}, 60_000);

afterAll(async () => {
  if (admin) {
    await admin.query(
      `alter table public.cost_snapshots disable trigger cost_snapshots_append_only`,
    );
    try {
      await admin.query(
        `delete from public.cost_snapshots
         where recipe_version_id in (
           select rv.id from public.recipe_versions rv
           join public.recipes r on r.id = rv.recipe_id
           join public.inventory_items i on i.id = r.output_item_id
           where i.sku like 'RECIPETEST-%'
         )`,
      );
    } finally {
      await admin.query(
        `alter table public.cost_snapshots enable trigger cost_snapshots_append_only`,
      );
    }
    await admin.query(
      `alter table public.recipe_versions disable trigger guard_activated_recipe_version`,
    );
    await admin.query(
      `alter table public.recipe_lines disable trigger guard_activated_recipe_lines`,
    );
    try {
      await admin.query(
        `delete from public.recipes where output_item_id in
         (select id from public.inventory_items where sku like 'RECIPETEST-%')`,
      );
    } finally {
      await admin.query(
        `alter table public.recipe_versions enable trigger guard_activated_recipe_version`,
      );
      await admin.query(
        `alter table public.recipe_lines enable trigger guard_activated_recipe_lines`,
      );
    }
    await admin.query(`delete from public.inventory_items where sku like 'RECIPETEST-%'`);
    await cleanupUsers(admin, EMAIL_PATTERN);
    await admin.end();
  }
  if (acting) await acting.end();
});

describe("Phase 4 recipe authorization", () => {
  it("allows recipe readers to see composition but hides recipes from inventory staff", async () => {
    const manager = await asUser(acting, ids.manager, (client) =>
      client.query<{ n: number }>(`select count(*)::int n from public.recipes where id = $1`, [
        ids.saleRecipe,
      ]),
    );
    const inventory = await asUser(acting, ids.inventory, (client) =>
      client.query<{ n: number }>(`select count(*)::int n from public.recipes where id = $1`, [
        ids.saleRecipe,
      ]),
    );
    expect(manager.rows[0]!.n).toBe(1);
    expect(inventory.rows[0]!.n).toBe(0);
  });

  it("enforces critical scenario 1 at the function and table layers", async () => {
    await expect(
      asUser(acting, ids.manager, (client) =>
        client.query(`select public.calculate_recipe_cost($1)`, [ids.saleV1]),
      ),
    ).rejects.toThrow(/cost\.read required/i);
    await expect(
      asUser(acting, ids.production, (client) =>
        client.query(`select public.recipe_cost_snapshot($1)`, [ids.saleV1]),
      ),
    ).rejects.toThrow(/cost\.read required/i);
    await expect(
      asUser(acting, ids.super, (client) =>
        client.query(`select total_cost from public.cost_snapshots where id = $1`, [
          ids.saleSnapshot,
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe("Phase 4 recursive recipe costing", () => {
  it("rejects invalid production outputs and non-inventory modifier targets", async () => {
    await expect(
      insertRecipe("Recipe Test Invalid Raw Output", "production", ids.raw),
    ).rejects.toThrow(/prepared or sellable item/i);
    await expect(
      admin.query(
        `insert into public.recipes
           (name, kind, output_item_id, modifier_option_id, created_by, updated_by)
         values ('Recipe Test Invalid Modifier', 'modifier', $1, $2, $3, $3)`,
        [ids.finished, ids.priceOnlyModifierOption, ids.super],
      ),
    ).rejects.toThrow(/inventory-affecting option/i);
  });

  it("costs raw → sub-product → sale recipe and excludes a reusable container", async () => {
    const result = await asUser(acting, ids.super, (client) =>
      client.query<{ cost: Record<string, unknown> }>(
        `select public.calculate_recipe_cost($1) as cost`,
        [ids.saleV1],
      ),
    );
    const cost = result.rows[0]!.cost;
    expect(Number(cost.ingredient_cost)).toBe(50);
    expect(Number(cost.packaging_cost)).toBe(2);
    expect(Number(cost.total_cost)).toBe(52);
    expect(Number(cost.unit_cost)).toBe(52);
  });

  it("rejects a cycle when activating a replacement production version", async () => {
    ids.productionRecipeB = await insertRecipe(
      "Recipe Test Mix B Production",
      "production",
      ids.subB,
    );
    ids.productionBV1 = await insertVersion(ids.productionRecipeB, 1, 100, ids.unit_g);
    await insertLine(ids.productionBV1, ids.sub, 10);
    await activate(ids.productionBV1);

    ids.productionV2Cycle = await insertVersion(ids.productionRecipe, 2, 100, ids.unit_g);
    await insertLine(ids.productionV2Cycle, ids.subB, 10);

    await expect(
      asUser(acting, ids.super, (client) =>
        client.query(`select public.activate_recipe_version($1)`, [ids.productionV2Cycle]),
      ),
    ).rejects.toThrow(/cycle detected/i);

    const active = await admin.query(
      `select id from public.recipe_versions where recipe_id = $1 and is_active`,
      [ids.productionRecipe],
    );
    expect(active.rows).toHaveLength(1);
    expect(active.rows[0]!.id).toBe(ids.productionV1);

    ids.productionV3 = await insertVersion(ids.productionRecipe, 3, 100, ids.unit_g);
    await insertLine(ids.productionV3, ids.raw, 50);
    await activate(ids.productionV3);
    const retired = await admin.query<{ id: string; is_active: boolean }>(
      `select id, is_active from public.recipe_versions
       where recipe_id = $1 and id in ($2, $3) order by version_number`,
      [ids.productionRecipe, ids.productionV1, ids.productionV3],
    );
    expect(retired.rows).toEqual([
      { id: ids.productionV1, is_active: false },
      { id: ids.productionV3, is_active: true },
    ]);
  });

  it("enforces the Phase 4 scenario 9 gate against raw inputs in sale recipes", async () => {
    const draft = await insertVersion(ids.saleRecipe, 2, 1, ids.unit_pc);
    await expect(insertLine(draft, ids.raw, 1)).rejects.toThrow(/cannot directly consume raw/i);
    await expect(insertLine(draft, ids.finished, 1)).rejects.toThrow(
      /prepared items and packaging/i,
    );
  });
});

describe("critical scenario 8 — immutable historical costs", () => {
  it("keeps the activation snapshot unchanged after source cost changes", async () => {
    const before = await asUser(acting, ids.super, (client) =>
      client.query<{ unit_cost: string | number }>(
        `select * from public.recipe_cost_snapshot($1)`,
        [ids.saleV1],
      ),
    );
    expect(Number(before.rows[0]!.unit_cost)).toBe(52);

    await admin.query(`update public.inventory_items set weighted_avg_cost = 20 where id = $1`, [
      ids.raw,
    ]);

    const live = await asUser(acting, ids.super, (client) =>
      client.query<{ cost: { unit_cost: string | number } }>(
        `select public.calculate_recipe_cost($1) as cost`,
        [ids.saleV1],
      ),
    );
    expect(Number(live.rows[0]!.cost.unit_cost)).toBe(102);

    const after = await asUser(acting, ids.super, (client) =>
      client.query<{ unit_cost: string | number }>(
        `select * from public.recipe_cost_snapshot($1)`,
        [ids.saleV1],
      ),
    );
    expect(Number(after.rows[0]!.unit_cost)).toBe(52);
    await expect(
      admin.query(`update public.cost_snapshots set unit_cost = 999 where id = $1`, [
        ids.saleSnapshot,
      ]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      admin.query(`update public.recipe_lines set qty = 999 where id = $1`, [
        ids.productionLineRaw,
      ]),
    ).rejects.toThrow(/immutable/i);
  });
});
