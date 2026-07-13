import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Zombeans!Dev123";
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let db: Client;
let prefix = "";
let branchId = "";
let negativeItemId = "";
let transferItemId = "";
let approvalTransferId = "";
let receivingTransferId = "";

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

test.describe("Phase 6 stock permissions and alerts", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({}, testInfo) => {
    db = new Client({ connectionString: DB_URL });
    await db.connect();
    prefix = `STOCKE2E-${testInfo.project.name.toUpperCase()}-${randomUUID().slice(0, 8)}`;
    const profiles = await db.query<{ id: string; email: string }>(
      `select id, email from public.profiles
       where email in ('inventory@zombeans.dev', 'manager@zombeans.dev')`,
    );
    const inventoryId = profiles.rows.find(
      (profile) => profile.email === "inventory@zombeans.dev",
    )!.id;
    const managerId = profiles.rows.find((profile) => profile.email === "manager@zombeans.dev")!.id;
    const unitId = (await db.query(`select id from public.units where code = 'g'`)).rows[0]!.id;
    const mainId = (await db.query(`select id from public.branches where is_main`)).rows[0]!.id;
    branchId = (
      await db.query<{ id: string }>(
        `insert into public.branches (key, name, created_by, updated_by)
         values ($1, $2, $3, $3) returning id`,
        [`${prefix.toLowerCase()}-branch`, `${prefix} Branch`, inventoryId],
      )
    ).rows[0]!.id;
    negativeItemId = (
      await db.query<{ id: string }>(
        `insert into public.inventory_items
           (name, sku, item_type, base_unit_id, weighted_avg_cost, created_by, updated_by)
         values ($1, $2, 'sub_product', $3, 12.5, $4, $4) returning id`,
        [`${prefix} Negative Mix`, `${prefix}-NEG`, unitId, inventoryId],
      )
    ).rows[0]!.id;
    transferItemId = (
      await db.query<{ id: string }>(
        `insert into public.inventory_items
           (name, sku, item_type, base_unit_id, batch_tracked, expiry_tracked,
            weighted_avg_cost, created_by, updated_by)
         values ($1, $2, 'sub_product', $3, true, true, 15, $4, $4) returning id`,
        [`${prefix} Transfer Mix`, `${prefix}-TRF`, unitId, inventoryId],
      )
    ).rows[0]!.id;
    await asUser(inventoryId, (client) =>
      client.query(`select public.post_stock_out($1, 'E2E emergency usage', null, $2, $3::jsonb)`, [
        branchId,
        randomUUID(),
        JSON.stringify([{ item_id: negativeItemId, qty: 3 }]),
      ]),
    );
    await db.query(
      `insert into public.inventory_lots
         (item_id, branch_id, lot_number, expiration_date, qty_remaining, unit_cost)
       values ($1, $2, $3, (now() at time zone 'Asia/Manila')::date + 10, 8, 15)`,
      [transferItemId, mainId, `${prefix}-LOT`],
    );
    await db.query(
      `insert into public.inventory_balances (item_id, branch_id, qty_on_hand) values ($1, $2, 8)`,
      [transferItemId, mainId],
    );
    async function prepare(): Promise<string> {
      const result = await asUser(inventoryId, (client) =>
        client.query<{ result: { id: string } }>(
          `select public.prepare_transfer($1, $2, null, 'E2E transfer', $3, $4::jsonb) result`,
          [mainId, branchId, randomUUID(), JSON.stringify([{ item_id: transferItemId, qty: 3 }])],
        ),
      );
      return result.rows[0]!.result.id;
    }
    approvalTransferId = await prepare();
    receivingTransferId = await prepare();
    await asUser(managerId, (client) =>
      client.query(`select public.approve_transfer($1)`, [receivingTransferId]),
    );
    await db.end();
  });

  test.afterAll(async () => {
    const cleanup = new Client({ connectionString: DB_URL });
    await cleanup.connect();
    await cleanup.query(`set session_replication_role = replica`);
    try {
      await cleanup.query(`delete from public.inventory_alerts where item_id = any($1::uuid[])`, [
        [negativeItemId, transferItemId],
      ]);
      await cleanup.query(
        `delete from public.transfer_discrepancies where transfer_id = any($1::uuid[])`,
        [[approvalTransferId, receivingTransferId]],
      );
      await cleanup.query(
        `delete from public.transfer_lot_allocations where transfer_line_id in (
           select id from public.transfer_lines where transfer_id = any($1::uuid[])
         )`,
        [[approvalTransferId, receivingTransferId]],
      );
      await cleanup.query(
        `delete from public.stock_transactions where transfer_id = any($1::uuid[])
         or id in (
           select txn_id from public.stock_transaction_lines where item_id = any($2::uuid[])
         )`,
        [
          [approvalTransferId, receivingTransferId],
          [negativeItemId, transferItemId],
        ],
      );
      await cleanup.query(`delete from public.transfer_lines where transfer_id = any($1::uuid[])`, [
        [approvalTransferId, receivingTransferId],
      ]);
      await cleanup.query(`delete from public.transfers where id = any($1::uuid[])`, [
        [approvalTransferId, receivingTransferId],
      ]);
      await cleanup.query(`delete from public.inventory_lots where item_id = any($1::uuid[])`, [
        [negativeItemId, transferItemId],
      ]);
      await cleanup.query(`delete from public.inventory_balances where item_id = any($1::uuid[])`, [
        [negativeItemId, transferItemId],
      ]);
      await cleanup.query(`delete from public.inventory_items where id = any($1::uuid[])`, [
        [negativeItemId, transferItemId],
      ]);
      await cleanup.query(`delete from public.branches where id = $1`, [branchId]);
    } finally {
      await cleanup.query(`set session_replication_role = origin`);
      await cleanup.end();
    }
  });

  test("inventory staff sees posting controls and the exact Critical negative balance", async ({
    page,
  }, testInfo) => {
    await login(page, "inventory@zombeans.dev");
    await page.goto("/stock");
    await expect(page.getByRole("heading", { name: "Stock operations" })).toBeVisible();
    await expect(page.getByRole("button", { name: /post stock-in/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /post stock-out/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Critical negative inventory" })).toBeVisible();
    await expect(page.getByText(`${prefix} Negative Mix`, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/-3(?:\.0+)?/).first()).toBeVisible();
    await expect(page.getByText(/unit cost|cost snapshot/i)).toHaveCount(0);
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("menuitem", { name: "Stock" })).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: "Stock" })).toBeVisible();
    }
  });

  test("branch manager approves dispatch but cannot use direct stock controls", async ({
    page,
  }) => {
    await login(page, "manager@zombeans.dev");
    await page.goto("/stock");
    await expect(page.getByRole("heading", { name: "Stock operations" })).toBeVisible();
    await expect(page.getByRole("button", { name: /post stock-in/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /post stock-out/i })).toHaveCount(0);
    await page.goto(`/stock/transfers/${approvalTransferId}`);
    await expect(page.getByRole("button", { name: /approve and dispatch/i })).toBeVisible();
    await page.getByRole("button", { name: /approve and dispatch/i }).click();
    await expect(page.getByText(/approved and dispatched from source inventory/i)).toBeVisible();
    await expect(page.getByText(/unit cost|cost snapshot/i)).toHaveCount(0);
  });

  test("inventory staff receives an in-transit transfer", async ({ page }) => {
    await login(page, "inventory@zombeans.dev");
    await page.goto(`/stock/transfers/${receivingTransferId}`);
    await expect(page.getByText("Receive transfer", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: /confirm receipt/i }).click();
    await expect(page.getByText("received", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/accounted 3/i)).toBeVisible();
    await expect(page.getByText(/unit cost|cost snapshot/i)).toHaveCount(0);
  });

  test("production staff is gated from stock routes and navigation", async ({ page }, testInfo) => {
    await login(page, "production@zombeans.dev");
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("menuitem", { name: "Stock" })).toHaveCount(0);
      await page.keyboard.press("Escape");
    } else {
      await expect(page.getByRole("link", { name: "Stock" })).toHaveCount(0);
    }
    await page.goto("/stock");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
