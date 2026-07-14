import { createHmac } from "node:crypto";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Zombeans!Dev123";
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const STEPUP_PEPPER = process.env.STEPUP_CODE_PEPPER ?? "local-dev-stepup-pepper-change-me";
let db: Client;

async function login(page: Page, email: string, destination = "/dashboard") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${destination}$`), { timeout: 15_000 });
}

async function completeLocalSuperAdminStepUp(page: Page) {
  await login(page, "superadmin@zombeans.dev", "/verify");
  const result = await db.query<{ id: string }>(
    `select id from auth.users where email='superadmin@zombeans.dev'`,
  );
  const value = createHmac("sha256", STEPUP_PEPPER)
    .update(`stepup:${result.rows[0]!.id}`)
    .digest("hex");
  await page
    .context()
    .addCookies([{ name: "zb_stepup", value, url: "http://localhost:3000", httpOnly: true }]);
}

test.beforeAll(async () => {
  db = new Client({ connectionString: DB_URL });
  await db.connect();
});
test.afterAll(async () => db.end());

test("inventory staff sees operational reports, can export CSV, and cannot open financial/admin surfaces", async ({
  page,
}) => {
  await login(page, "inventory@zombeans.dev");
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  await expect(page.getByText("Inventory balances", { exact: true })).toBeVisible();
  await expect(page.getByText("Inventory valuation", { exact: true })).toHaveCount(0);
  await page.goto("/reports/inventory-balances");
  await expect(
    page.getByRole("heading", { name: "Inventory balances", exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "CSV" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(
    /^inventory-balances-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  await page.goto("/reports/inventory-valuation");
  await expect(page).toHaveURL(/\/reports$/);
  await page.goto("/admin/recycle-bin");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/admin/backups");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("invalid report filters produce a warning and safe defaults", async ({ page }) => {
  await login(page, "manager@zombeans.dev");
  await page.goto("/reports/stock-movements?start=2026-07-15&end=2026-07-14");
  await expect(page.getByText("Invalid filters were ignored", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stock movements", exact: true })).toBeVisible();
});

test("verified Super Admin sees financial reports, recycle bin, and honest backup status", async ({
  page,
}) => {
  await completeLocalSuperAdminStepUp(page);
  await page.goto("/reports");
  await expect(page.getByText("Inventory valuation", { exact: true })).toBeVisible();
  await page.goto("/reports/inventory-valuation");
  await expect(page.getByText("Financial report", { exact: true })).toBeVisible();
  await page.goto("/admin/recycle-bin");
  await expect(page.getByRole("heading", { name: "Recycle bin", exact: true })).toBeVisible();
  await expect(page.getByText("Retention is dependency-aware", { exact: true })).toBeVisible();
  await page.goto("/admin/backups");
  await expect(page.getByRole("heading", { name: "Backups", exact: true })).toBeVisible();
  await expect(page.getByText("No backup runs recorded", { exact: true })).toBeVisible();
});
