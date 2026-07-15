import { createHmac } from "node:crypto";
import { Client } from "pg";
import { test, expect, type Page } from "@playwright/test";

/**
 * Catalog permission-gating e2e. Uses the non-step-up staff accounts (only the Super Admin needs
 * the emailed step-up code, which isn't automatable here). Enforcement is checked by server-side
 * redirects and page access (viewport-agnostic); the desktop sidebar visibility is a separate,
 * desktop-only check. Requires local Supabase + `npm run seed:dev`.
 */

const PASSWORD = "Zombeans!Dev123";
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const STEPUP_PEPPER = process.env.STEPUP_CODE_PEPPER ?? "local-dev-stepup-pepper-change-me";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("inventory staff can view the catalog but is gated from admin config", async ({ page }) => {
  await login(page, "inventory@zombeans.dev");

  // catalog.item.read → catalog pages render.
  await page.goto("/catalog/products");
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  await page.goto("/catalog/items");
  await expect(page.getByRole("heading", { name: "Inventory items" })).toBeVisible();
  // No catalog.item.write → no create controls.
  await expect(page.getByRole("button", { name: /add item/i })).toHaveCount(0);

  // No settings.manage → settings/branches redirect to the dashboard (real control, not just CSS).
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/admin/branches");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("branch manager can view products but is gated from admin config", async ({ page }) => {
  await login(page, "manager@zombeans.dev");

  await page.goto("/catalog/products");
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();

  await page.goto("/admin/branches");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("desktop sidebar hides admin sections from inventory staff", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sidebar is desktop-only; mobile uses a menu");
  await login(page, "inventory@zombeans.dev");

  await expect(page.getByRole("link", { name: "Products", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Inventory items", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Branches", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0);
});

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
  const label = `E2E ${Date.now()}`;
  await page.getByRole("button", { name: /add item/i }).click();
  await page.getByLabel("Name").fill(label);
  await page.getByLabel("Base unit").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Create item" }).click();
  const row = page.getByRole("row", { name: new RegExp(label) });
  await expect(row).toBeVisible();

  // Edit: rename + deactivate.
  await row.getByRole("button", { name: `Edit ${label}` }).click();
  await page.getByLabel("Name").fill(`${label} edited`);
  await page.getByLabel(/Active/).uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();

  const editedRow = page.getByRole("row", { name: new RegExp(`${label} edited`) });
  await expect(editedRow).toBeVisible();
  await expect(editedRow.getByText("inactive")).toBeVisible();
});
