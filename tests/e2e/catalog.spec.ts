import { test, expect, type Page } from "@playwright/test";

/**
 * Catalog permission-gating e2e. Uses the non-step-up staff accounts (only the Super Admin needs
 * the emailed step-up code, which isn't automatable here). Verifies that navigation and catalog
 * pages honour permissions — hiding a control is backed by a server redirect, not just CSS.
 * Requires local Supabase + `npm run seed:dev`.
 */

const PASSWORD = "Zombeans!Dev123";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("inventory staff sees catalog nav but no admin sections", async ({ page }) => {
  await login(page, "inventory@zombeans.dev");

  await expect(page.getByRole("link", { name: "Inventory items" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Products" })).toBeVisible();
  // No admin/config access for ordinary staff.
  await expect(page.getByRole("link", { name: "Branches" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
});

test("inventory staff is redirected away from settings-gated routes", async ({ page }) => {
  await login(page, "inventory@zombeans.dev");

  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/admin/branches");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("inventory staff can open the products page but prices are gated", async ({ page }) => {
  await login(page, "inventory@zombeans.dev");

  await page.getByRole("link", { name: "Products" }).click();
  await expect(page).toHaveURL(/\/catalog\/products$/);
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  // Inventory staff lack price.read: no "Add product" control (they also lack catalog.item.write).
  await expect(page.getByRole("button", { name: /add product/i })).toHaveCount(0);
});

test("branch manager reaches Settings-gated pages? no — only catalog + prices", async ({ page }) => {
  await login(page, "manager@zombeans.dev");

  // Manager has price.read (sees the Products section) but not settings.manage.
  await expect(page.getByRole("link", { name: "Products" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Branches" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

  await page.goto("/admin/branches");
  await expect(page).toHaveURL(/\/dashboard$/);
});
