import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Zombeans!Dev123";
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
let db: Client;

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

test.beforeAll(async ({}, testInfo) => {
  db = new Client({ connectionString: DB_URL });
  await db.connect();
  const manager = await db.query<{ id: string }>(
    `select id from public.profiles where email = 'manager@zombeans.dev'`,
  );
  const unit = await db.query<{ id: string }>(`select id from public.units where code = 'g'`);
  const marker = `P10E2E-${testInfo.project.name.toUpperCase()}-${randomUUID().slice(0, 8)}`;
  await db.query(
    `insert into public.inventory_items
       (name, sku, item_type, base_unit_id, weighted_avg_cost, created_by, updated_by)
     values ($1, $2, 'sub_product', $3, 4.25, $4, $4)`,
    [`${marker} POS item`, marker, unit.rows[0]!.id, manager.rows[0]!.id],
  );
});
test.afterAll(async () => db.end());

test("inventory staff gets device drafts and barcode lookup without review or POS import", async ({
  page,
}) => {
  await login(page, "inventory@zombeans.dev");
  await page.goto("/offline-pos");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Offline & POS staging" })).toBeVisible();
  await expect(main.getByText("Offline drafts and sync queue", { exact: true })).toBeVisible();
  await expect(main.getByText("Barcode lookup", { exact: true })).toBeVisible();
  await expect(main.getByText("Conflict review", { exact: true })).toHaveCount(0);
  await expect(main.getByText("Loyverse staging and CSV import", { exact: true })).toHaveCount(0);
  await expect(main.getByRole("textbox", { name: "Barcode", exact: true })).toBeVisible();
  await expect(main.getByText(/No drafts are stored on this device/i)).toBeVisible();
});

test("manager previews and explicitly confirms one staged POS row", async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(
    Boolean(isMobile),
    "Desktop path covers file upload and confirmation; mobile is below.",
  );
  const suffix = `${testInfo.project.name}-${Date.now()}`.toLowerCase();
  const externalId = `e2e-phase10-${suffix}`;
  const externalLineId = `line-phase10-${suffix}`;
  const before = await db.query<{ count: string }>(
    `select count(*)::text from public.stock_transactions where type in ('pos_sale','pos_refund')`,
  );

  await login(page, "manager@zombeans.dev");
  await page.goto("/offline-pos");
  const main = page.getByRole("main");
  await expect(main.getByText("Conflict review", { exact: true })).toBeVisible();
  await expect(main.getByText("Loyverse staging and CSV import", { exact: true })).toBeVisible();

  await page.getByLabel("External ID").fill(externalId);
  await page.getByLabel("External name").fill("Phase 10 Playwright item");
  await page.getByLabel("Mapping reason").fill("Playwright staging coverage");
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByText(new RegExp(`Loyverse ${externalId} .*mapped`))).toBeVisible();

  const csv = [
    "external_reference,external_line_id,occurred_at,type,entity_type,external_id,quantity",
    `SALE-E2E,${externalLineId},${new Date().toISOString()},sale,item,${externalId},1`,
  ].join("\n");
  await page.getByLabel("UTF-8 Loyverse CSV").setInputFiles({
    name: "phase10-e2e.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Generate preview" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /previewed 1 rows: 1 valid/i }),
  ).toBeVisible({
    timeout: 15_000,
  });
  const afterPreview = await db.query<{ count: string }>(
    `select count(*)::text from public.stock_transactions where type in ('pos_sale','pos_refund')`,
  );
  expect(afterPreview.rows[0]!.count).toBe(before.rows[0]!.count);

  await page.getByRole("button", { name: "Confirm posting" }).first().click();
  await expect(page.getByRole("heading", { name: /Post POS-.* to inventory/ })).toBeVisible();
  await page.getByLabel("Confirmation reason").fill("Reviewed Playwright preview and mapping");
  await page.getByRole("button", { name: "Confirm inventory posting" }).click();
  await expect(main.getByText("confirmed", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(async () => {
      const result = await db.query<{ count: string }>(
        `select count(*)::text from public.stock_transactions where type in ('pos_sale','pos_refund')`,
      );
      return Number(result.rows[0]!.count) - Number(before.rows[0]!.count);
    })
    .toBe(1);
});

test("mobile manager can reach all Phase 10 surfaces with labelled controls", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Mobile project verifies the compact workspace separately.");
  await login(page, "manager@zombeans.dev");
  await page.goto("/offline-pos");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Offline & POS staging" })).toBeVisible();
  await expect(main.getByText("Conflict review", { exact: true })).toBeVisible();
  await expect(main.getByRole("textbox", { name: "Barcode", exact: true })).toBeVisible();
  await expect(main.getByLabel("UTF-8 Loyverse CSV")).toBeVisible();
  await expect(main.getByRole("button", { name: "Generate preview" })).toBeVisible();
});
