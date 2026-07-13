import { createHmac } from "node:crypto";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Zombeans!Dev123";
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const STEPUP_PEPPER = process.env.STEPUP_CODE_PEPPER ?? "local-dev-stepup-pepper-change-me";

async function login(page: Page, email: string, destination = "/dashboard") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
}

async function completeLocalSuperAdminStepUp(page: Page) {
  await login(page, "superadmin@zombeans.dev", "/verify");
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ id: string }>(
      `select id from auth.users where email = 'superadmin@zombeans.dev'`,
    );
    const userId = rows[0]!.id;
    const marker = createHmac("sha256", STEPUP_PEPPER).update(`stepup:${userId}`).digest("hex");
    await page
      .context()
      .addCookies([
        { name: "zb_stepup", value: marker, url: "http://localhost:3000", httpOnly: true },
      ]);
  } finally {
    await db.end();
  }
}

test("recipe readers can open recipes without seeing costing", async ({ page }) => {
  await login(page, "production@zombeans.dev");

  await page.goto("/recipes");
  await expect(page.getByRole("heading", { name: "Recipes" })).toBeVisible();
  await expect(page.getByRole("button", { name: /new recipe/i })).toHaveCount(0);

  await page.goto("/costing");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("inventory staff is gated from recipes", async ({ page }) => {
  await login(page, "inventory@zombeans.dev");
  await page.goto("/recipes");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("verified Super Admin can open the protected costing dashboard", async ({ page }) => {
  await completeLocalSuperAdminStepUp(page);
  await page.goto("/costing");
  await expect(page.getByRole("heading", { name: "Costing dashboard" })).toBeVisible();
  await expect(
    page.getByRole("main").getByText("Average food cost", { exact: true }),
  ).toBeVisible();
  await page.goto("/recipes");
  await expect(page.getByRole("button", { name: /new recipe/i })).toBeVisible();
});

test("desktop recipe navigation follows permissions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sidebar is desktop-only; mobile uses a menu");
  await login(page, "manager@zombeans.dev");
  await expect(page.getByRole("link", { name: "Recipes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Costing" })).toHaveCount(0);
});
