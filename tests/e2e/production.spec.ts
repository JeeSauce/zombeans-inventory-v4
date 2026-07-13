import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Zombeans!Dev123";
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let db: Client;
let prefix = "";
let draftOrderId = "";
let confirmOrderId = "";
let templateId = "";
let recipeId = "";
let recipeVersionId = "";
let inputItemId = "";
let outputItemId = "";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function asUser<T>(userId: string, fn: (client: Client) => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await db.query("set local role authenticated");
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

test.describe("Phase 5 production permissions", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({}, testInfo) => {
    db = new Client({ connectionString: DB_URL });
    await db.connect();
    prefix = `PRODE2E-${testInfo.project.name.toUpperCase()}-${randomUUID().slice(0, 8)}`;

    const profiles = await db.query<{ id: string; email: string }>(
      `select id, email from public.profiles
       where email in ('superadmin@zombeans.dev', 'production@zombeans.dev')`,
    );
    const superId = profiles.rows.find(
      (profile) => profile.email === "superadmin@zombeans.dev",
    )!.id;
    const productionId = profiles.rows.find(
      (profile) => profile.email === "production@zombeans.dev",
    )!.id;
    const unitId = (await db.query(`select id from public.units where code = 'g'`)).rows[0]!.id;
    const branchId = (await db.query(`select id from public.branches where is_main`)).rows[0]!.id;

    inputItemId = (
      await db.query<{ id: string }>(
        `insert into public.inventory_items
           (name, sku, item_type, base_unit_id, weighted_avg_cost, created_by, updated_by)
         values ($1, $2, 'raw_ingredient', $3, 12, $4, $4) returning id`,
        [`${prefix} Beans`, `${prefix}-IN`, unitId, superId],
      )
    ).rows[0]!.id;
    outputItemId = (
      await db.query<{ id: string }>(
        `insert into public.inventory_items
           (name, sku, item_type, base_unit_id, created_by, updated_by)
         values ($1, $2, 'sub_product', $3, $4, $4) returning id`,
        [`${prefix} Concentrate`, `${prefix}-OUT`, unitId, superId],
      )
    ).rows[0]!.id;
    recipeId = (
      await db.query<{ id: string }>(
        `insert into public.recipes
           (name, kind, output_item_id, created_by, updated_by)
         values ($1, 'production', $2, $3, $3) returning id`,
        [`${prefix} Recipe`, outputItemId, superId],
      )
    ).rows[0]!.id;
    recipeVersionId = (
      await db.query<{ id: string }>(
        `insert into public.recipe_versions
           (recipe_id, version_number, output_qty, output_unit_id, created_by, updated_by)
         values ($1, 1, 10, $2, $3, $3) returning id`,
        [recipeId, unitId, superId],
      )
    ).rows[0]!.id;
    await db.query(
      `insert into public.recipe_lines
         (recipe_version_id, input_item_id, qty, created_by, updated_by)
       values ($1, $2, 2, $3, $3)`,
      [recipeVersionId, inputItemId, superId],
    );
    await asUser(superId, (client) =>
      client.query(`select public.activate_recipe_version($1)`, [recipeVersionId]),
    );
    templateId = (
      await db.query<{ id: string }>(
        `insert into public.production_templates
           (name, recipe_id, default_expiry_days, created_by, updated_by)
         values ($1, $2, 7, $3, $3) returning id`,
        [`${prefix} Template`, recipeId, superId],
      )
    ).rows[0]!.id;

    const draft = await asUser(productionId, (client) =>
      client.query<{ result: { id: string } }>(
        `select public.create_production_order($1, 1, $2, null) result`,
        [templateId, randomUUID()],
      ),
    );
    draftOrderId = draft.rows[0]!.result.id;
    const confirmation = await asUser(productionId, async (client) => {
      const created = await client.query<{ result: { id: string } }>(
        `select public.create_production_order($1, 1, $2, null) result`,
        [templateId, randomUUID()],
      );
      const orderId = created.rows[0]!.result.id;
      await client.query(
        `update public.production_orders set
           status = 'in_progress', started_at = now(), started_by = $2, updated_by = $2
         where id = $1`,
        [orderId, productionId],
      );
      const input = await client.query<{ id: string }>(
        `select id from public.production_order_inputs where production_order_id = $1`,
        [orderId],
      );
      await client.query(
        `select public.record_production_actuals(
           $1, 9, $2, (now() at time zone 'Asia/Manila')::date,
           (now() at time zone 'Asia/Manila')::date + 7, null, $3::jsonb
         )`,
        [
          orderId,
          `${prefix}-BATCH`,
          JSON.stringify([
            {
              id: input.rows[0]!.id,
              actual_consumed_qty: 2,
              waste_qty: 0,
              notes: null,
            },
          ]),
        ],
      );
      return orderId;
    });
    confirmOrderId = confirmation;

    await db.query(
      `insert into public.inventory_lots
         (item_id, branch_id, lot_number, expiration_date, qty_remaining, unit_cost)
       values ($1, $2, $3, (now() at time zone 'Asia/Manila')::date + 30, 20, 12)`,
      [inputItemId, branchId, `${prefix}-RAW`],
    );
    await db.query(
      `insert into public.inventory_balances (item_id, branch_id, qty_on_hand)
       values ($1, $2, 20)`,
      [inputItemId, branchId],
    );
    await db.end();
  });

  test.afterAll(async () => {
    const cleanup = new Client({ connectionString: DB_URL });
    await cleanup.connect();
    // Session-local replica mode avoids global ALTER TABLE locks when desktop/mobile workers tear
    // down concurrently. Every delete remains scoped to this worker's generated fixture IDs.
    await cleanup.query(`set lock_timeout = '5s'`);
    await cleanup.query(`set statement_timeout = '10s'`);
    await cleanup.query(`set session_replication_role = replica`);
    try {
      await cleanup.query(
        `delete from public.stock_transaction_lines where txn_id in (
           select id from public.stock_transactions where production_order_id = any($1::uuid[])
         )`,
        [[draftOrderId, confirmOrderId]],
      );
      await cleanup.query(
        `delete from public.stock_transactions where production_order_id = any($1::uuid[])`,
        [[draftOrderId, confirmOrderId]],
      );
      await cleanup.query(
        `delete from public.production_order_inputs where production_order_id = any($1::uuid[])`,
        [[draftOrderId, confirmOrderId]],
      );
      await cleanup.query(`delete from public.production_orders where id = any($1::uuid[])`, [
        [draftOrderId, confirmOrderId],
      ]);
      await cleanup.query(`delete from public.production_templates where id = $1`, [templateId]);
      await cleanup.query(`delete from public.inventory_lots where item_id = any($1::uuid[])`, [
        [inputItemId, outputItemId],
      ]);
      await cleanup.query(`delete from public.inventory_balances where item_id = any($1::uuid[])`, [
        [inputItemId, outputItemId],
      ]);
      await cleanup.query(`delete from public.cost_snapshots where recipe_version_id = $1`, [
        recipeVersionId,
      ]);
      await cleanup.query(`delete from public.recipe_lines where recipe_version_id = $1`, [
        recipeVersionId,
      ]);
      await cleanup.query(`delete from public.recipe_versions where id = $1`, [recipeVersionId]);
      await cleanup.query(`delete from public.recipes where id = $1`, [recipeId]);
      await cleanup.query(`delete from public.inventory_items where id = any($1::uuid[])`, [
        [inputItemId, outputItemId],
      ]);
    } finally {
      await cleanup.query(`set session_replication_role = origin`);
      await cleanup.end();
    }
  });

  test("production staff can create and record but cannot confirm or see cost", async ({
    page,
  }) => {
    await login(page, "production@zombeans.dev");
    await page.goto("/production");
    await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
    await expect(page.getByRole("link", { name: /new production order/i })).toBeVisible();
    await expect(page.getByText(/unit cost|cost snapshot/i)).toHaveCount(0);

    await page.goto(`/production/${draftOrderId}`);
    await expect(page.getByRole("button", { name: /start production/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /confirm and post/i })).toHaveCount(0);
    await page.getByRole("button", { name: /start production/i }).click();
    await expect(page.getByRole("button", { name: /submit for confirmation/i })).toBeVisible();
    await expect(page.getByText(/unit cost|cost snapshot/i)).toHaveCount(0);
  });

  test("branch manager can confirm an ordinary production order", async ({ page }) => {
    await login(page, "manager@zombeans.dev");
    await page.goto("/production");
    await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
    await expect(page.getByRole("link", { name: /new production order/i })).toHaveCount(0);

    await page.goto(`/production/${confirmOrderId}`);
    await expect(page.getByRole("button", { name: /confirm and post/i })).toBeVisible();
    await page.getByRole("button", { name: /confirm and post/i }).click();
    await expect(
      page.getByText(/inputs, waste, output lot, balances, and ledger entries/i),
    ).toBeVisible();
    await expect(page.getByText(/unit cost|cost snapshot/i)).toHaveCount(0);
  });

  test("inventory staff is gated from production", async ({ page }) => {
    await login(page, "inventory@zombeans.dev");
    await page.goto("/production");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("desktop navigation exposes production only to participating roles", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "sidebar is desktop-only");
    await login(page, "manager@zombeans.dev");
    await expect(page.getByRole("link", { name: "Production" })).toBeVisible();
  });
});
