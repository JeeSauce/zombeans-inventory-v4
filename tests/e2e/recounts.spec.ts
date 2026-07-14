import { createHmac, randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Zombeans!Dev123";
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const STEPUP_PEPPER = process.env.STEPUP_CODE_PEPPER ?? "local-dev-stepup-pepper-change-me";

let db: Client;
let prefix = "";
let branchId = "";
let branchName = "";
let itemId = "";
let itemName = "";
let inventoryId = "";

async function login(page: Page, email: string, destination = "/dashboard") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
}

async function completeLocalSuperAdminStepUp(page: Page) {
  await login(page, "superadmin@zombeans.dev", "/verify");
  const result = await db.query<{ id: string }>(
    `select id from auth.users where email = 'superadmin@zombeans.dev'`,
  );
  const marker = createHmac("sha256", STEPUP_PEPPER)
    .update(`stepup:${result.rows[0]!.id}`)
    .digest("hex");
  await page
    .context()
    .addCookies([
      { name: "zb_stepup", value: marker, url: "http://localhost:3000", httpOnly: true },
    ]);
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

function formForButton(page: Page, name: RegExp | string) {
  return page.getByRole("button", { name }).locator("xpath=ancestor::form");
}

function cardForButton(page: Page, marker: string, name: RegExp | string) {
  return page
    .locator('[data-slot="card"]')
    .filter({ hasText: marker })
    .filter({ has: page.getByRole("button", { name }) })
    .first();
}

function cardWithText(page: Page, marker: string, text: RegExp | string) {
  return page
    .locator('[data-slot="card"]')
    .filter({ hasText: marker })
    .filter({ hasText: text })
    .first();
}

function sessionCards(page: Page, marker: string, typeLabel: string) {
  return page
    .locator('[data-slot="card"]')
    .filter({ hasText: marker })
    .filter({ hasText: typeLabel });
}

function completedSessionCard(page: Page, marker: string, typeLabel: string) {
  return sessionCards(page, marker, typeLabel).filter({ hasText: "Recount complete" }).first();
}

function cardFormForButton(page: Page, marker: string, name: RegExp | string) {
  return cardForButton(page, marker, name)
    .getByRole("button", { name })
    .locator("xpath=ancestor::form");
}

test.describe("Phase 7 recounts and daily operations", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({}, testInfo) => {
    db = new Client({ connectionString: DB_URL });
    await db.connect();
    prefix = `RCTE2E-${testInfo.project.name.toUpperCase()}-${randomUUID().slice(0, 8)}`;
    branchName = `${prefix} Branch`;
    itemName = `${prefix} Mix`;
    const profiles = await db.query<{ id: string; email: string }>(
      `select id, email from public.profiles
       where email in ('inventory@zombeans.dev', 'superadmin@zombeans.dev')`,
    );
    inventoryId = profiles.rows.find((profile) => profile.email === "inventory@zombeans.dev")!.id;
    const superId = profiles.rows.find(
      (profile) => profile.email === "superadmin@zombeans.dev",
    )!.id;
    const unitId = (await db.query(`select id from public.units where code = 'g'`)).rows[0]!.id;
    branchId = (
      await db.query<{ id: string }>(
        `insert into public.branches (key, name, created_by, updated_by)
         values ($1, $2, $3, $3) returning id`,
        [`${prefix.toLowerCase()}-branch`, branchName, superId],
      )
    ).rows[0]!.id;
    await db.query(
      `insert into public.user_branch_assignments (profile_id, branch_id)
       values ($1, $2) on conflict do nothing`,
      [inventoryId, branchId],
    );
    itemId = (
      await db.query<{ id: string }>(
        `insert into public.inventory_items (
           name, sku, item_type, base_unit_id, trackable, weighted_avg_cost, created_by, updated_by
         ) values ($1, $2, 'sub_product', $3, true, 10, $4, $4) returning id`,
        [itemName, `${prefix}-MIX`, unitId, superId],
      )
    ).rows[0]!.id;
    await asUser(inventoryId, (client) =>
      client.query(`select public.post_stock_in($1, $2, null, $3, $4::jsonb)`, [
        branchId,
        "E2E opening stock",
        randomUUID(),
        JSON.stringify([{ item_id: itemId, qty: 10 }]),
      ]),
    );
  });

  test.afterAll(async () => {
    if (!db) return;
    await db.query(`set session_replication_role = replica`);
    try {
      await db.query(
        `delete from public.variance_adjustments where session_id in (
        select id from public.recount_sessions where branch_id = $1
      )`,
        [branchId],
      );
      await db.query(
        `delete from public.recount_lines where session_id in (
        select id from public.recount_sessions where branch_id = $1
      )`,
        [branchId],
      );
      await db.query(`delete from public.recount_sessions where branch_id = $1`, [branchId]);
      await db.query(`delete from public.inventory_alerts where branch_id = $1`, [branchId]);
      await db.query(
        `delete from public.stock_transactions where source_branch_id = $1 or dest_branch_id = $1`,
        [branchId],
      );
      await db.query(`delete from public.inventory_lots where branch_id = $1`, [branchId]);
      await db.query(`delete from public.inventory_balances where branch_id = $1`, [branchId]);
      await db.query(
        `delete from public.day_close_events where closure_id in (
        select id from public.daily_operational_closures where branch_id = $1
      )`,
        [branchId],
      );
      await db.query(`delete from public.daily_operational_closures where branch_id = $1`, [
        branchId,
      ]);
      await db.query(`delete from public.audit_logs where branch_id = $1`, [branchId]);
      await db.query(`delete from public.inventory_items where id = $1`, [itemId]);
      await db.query(`delete from public.branches where id = $1`, [branchId]);
    } finally {
      await db.query(`set session_replication_role = origin`);
      await db.end();
    }
  });

  test("Inventory Staff completes an ordinary start count and compensating adjustment", async ({
    page,
  }, testInfo) => {
    await login(page, "inventory@zombeans.dev");
    await page.goto("/daily-ops");
    await expect(page.getByRole("heading", { name: "Daily operations" })).toBeVisible();
    const openForm = formForButton(page, /open start-of-day recount/i);
    await openForm.getByLabel("Branch").selectOption(branchId);
    await openForm.getByRole("button", { name: /open start-of-day recount/i }).click();
    await expect(page.getByText(/ready for physical counts/i)).toBeVisible();

    await page.getByLabel(`Physical quantity for ${itemName}`).fill("9.5");
    await cardFormForButton(page, itemName, "Submit physical counts")
      .getByRole("button", { name: "Submit physical counts" })
      .click();
    const adjustmentForm = cardFormForButton(page, itemName, "Post compensating adjustment");
    await expect(adjustmentForm).toBeVisible();
    await adjustmentForm.getByLabel("Adjustment reason type").selectOption("counting_error");
    await adjustmentForm.getByLabel("Verified explanation").fill("E2E verified count difference");
    await adjustmentForm.getByRole("button", { name: "Post compensating adjustment" }).click();
    await expect(completedSessionCard(page, itemName, "Start Of Day")).toBeVisible();
    await expect(page.getByText(/unit cost|variance value|₱/i)).toHaveCount(0);
    await expect(page.getByText(branchId)).toHaveCount(0);

    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("menuitem", { name: "Daily Ops" })).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: "Daily Ops" })).toBeVisible();
    }
  });

  test("an unusual cycle count is visibly held for Super Admin", async ({ page }) => {
    await login(page, "inventory@zombeans.dev");
    await page.goto("/daily-ops");
    const openForm = formForButton(page, /open cycle count/i);
    await openForm.getByLabel("Branch").selectOption(branchId);
    await openForm.getByLabel("Item to count").selectOption(itemId);
    await openForm.getByRole("button", { name: /open cycle count/i }).click();
    await page.getByLabel(`Physical quantity for ${itemName}`).fill("8");
    const cycleCard = cardForButton(page, itemName, "Submit physical counts");
    await cycleCard.getByRole("button", { name: "Submit physical counts" }).click();
    await expect(
      cardWithText(page, itemName, "Super Admin review required").getByText(
        "Super Admin review required",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /post super admin adjustment/i })).toHaveCount(0);
  });

  test("Super Admin resolves unusual variance and Branch Manager posts an ordinary cycle count", async ({
    page,
  }) => {
    await completeLocalSuperAdminStepUp(page);
    await page.goto("/daily-ops");
    const unusualForm = cardFormForButton(page, itemName, "Post Super Admin adjustment");
    await unusualForm.getByLabel("Adjustment reason type").selectOption("counting_error");
    await unusualForm
      .getByLabel("Verified explanation")
      .fill("Super Admin approved unusual E2E variance");
    await unusualForm.getByRole("button", { name: "Post Super Admin adjustment" }).click();
    await expect(completedSessionCard(page, itemName, "Cycle")).toBeVisible();

    await page.context().clearCookies();
    await login(page, "manager@zombeans.dev");
    await page.goto("/daily-ops");
    const openForm = formForButton(page, /open cycle count/i);
    await openForm.getByLabel("Branch").selectOption(branchId);
    await openForm.getByLabel("Item to count").selectOption(itemId);
    await openForm.getByRole("button", { name: /open cycle count/i }).click();
    await page.getByLabel(`Physical quantity for ${itemName}`).fill("7.9");
    await cardFormForButton(page, itemName, "Submit physical counts")
      .getByRole("button", { name: "Submit physical counts" })
      .click();
    const ordinaryForm = cardFormForButton(page, itemName, "Post compensating adjustment");
    await ordinaryForm.getByLabel("Adjustment reason type").selectOption("counting_error");
    await ordinaryForm
      .getByLabel("Verified explanation")
      .fill("Manager verified ordinary variance");
    await ordinaryForm.getByRole("button", { name: "Post compensating adjustment" }).click();
    await expect(
      sessionCards(page, itemName, "Cycle").filter({ hasText: "Recount complete" }),
    ).toHaveCount(2);
  });

  test("Branch Manager closes the day and Inventory Staff receives a loud closed-day error", async ({
    page,
  }) => {
    await login(page, "manager@zombeans.dev");
    await page.goto("/daily-ops");
    await cardForButton(page, branchName, `Close ${branchName}`)
      .getByRole("button", { name: `Close ${branchName}` })
      .click();
    await expect(cardWithText(page, branchName, "Day closed")).toBeVisible();

    await page.context().clearCookies();
    await login(page, "inventory@zombeans.dev");
    await page.goto("/stock");
    const stockForm = formForButton(page, /post stock-in/i);
    await stockForm.getByLabel("Branch").selectOption(branchId);
    await stockForm.getByLabel("Inventory item").selectOption(itemId);
    await stockForm.getByLabel("Quantity (base unit)").fill("1");
    await stockForm.getByLabel("Source / reason").fill("Closed-day E2E attempt");
    await stockForm.getByRole("button", { name: /post stock-in/i }).click();
    await expect(stockForm.getByRole("alert")).toContainText(/business day .* is closed/i);
  });

  test("Super Admin reopen requires a reason and shows later attributed changes", async ({
    page,
  }) => {
    await completeLocalSuperAdminStepUp(page);
    await page.goto("/daily-ops");
    const reopenForm = cardFormForButton(page, branchName, "Reopen business day");
    await reopenForm.getByRole("button", { name: "Reopen business day" }).click();
    await expect(reopenForm.locator("textarea:invalid")).toHaveCount(1);
    await reopenForm.getByLabel("Required reopen reason").fill("E2E approved correction window");
    await reopenForm.getByRole("button", { name: "Reopen business day" }).click();
    await expect(cardWithText(page, branchName, "E2E approved correction window")).toBeVisible();

    const posted = await asUser(inventoryId, (client) =>
      client.query<{ txn_id: string }>(
        `select public.post_stock_in($1, $2, null, $3, $4::jsonb) txn_id`,
        [
          branchId,
          "E2E post-reopen change",
          randomUUID(),
          JSON.stringify([{ item_id: itemId, qty: 1 }]),
        ],
      ),
    );
    const reference = (
      await db.query<{ reference: string }>(
        `select reference from public.stock_transactions where id = $1`,
        [posted.rows[0]!.txn_id],
      )
    ).rows[0]!.reference;
    await page.reload();
    await expect(cardWithText(page, branchName, "Later attributed changes")).toBeVisible();
    await expect(page.getByRole("main").getByText(reference, { exact: false })).toBeVisible();
    await expect(page.getByText(/unit cost|variance value|₱/i)).toHaveCount(0);
  });

  test("Production Staff has no Daily Ops route or navigation", async ({ page }, testInfo) => {
    await login(page, "production@zombeans.dev");
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(page.getByRole("menuitem", { name: "Daily Ops" })).toHaveCount(0);
      await page.keyboard.press("Escape");
    } else {
      await expect(page.getByRole("link", { name: "Daily Ops" })).toHaveCount(0);
    }
    await page.goto("/daily-ops");
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
