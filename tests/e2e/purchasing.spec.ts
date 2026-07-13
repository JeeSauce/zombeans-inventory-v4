import { test, expect, type Page } from "@playwright/test";

/**
 * Purchasing permission-gating e2e (Phase 3). Mirrors tests/e2e/catalog.spec.ts: uses the
 * non-step-up staff accounts, checks enforcement via server-side redirects and page access
 * (viewport-agnostic), and checks desktop sidebar visibility separately (desktop-only).
 * Requires local Supabase + `npm run seed:dev`.
 *
 * Permission facts (see supabase/migrations/0004_roles_permissions_seed.sql):
 * - manager@zombeans.dev (branch_manager): has supplier.read, purchase.create; does NOT have
 *   purchase.receive.
 * - inventory@zombeans.dev: has purchase.receive; does NOT have supplier.read or purchase.create.
 */

const PASSWORD = "Zombeans!Dev123";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("inventory staff can receive purchase orders but is gated from suppliers", async ({
  page,
}) => {
  await login(page, "inventory@zombeans.dev");

  // purchase.receive → the receiving page renders.
  await page.goto("/purchasing/receiving");
  await expect(page.getByRole("heading", { name: "Receiving" })).toBeVisible();

  // No supplier.read → suppliers redirects to the dashboard (real control, not just CSS).
  await page.goto("/purchasing/suppliers");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("branch manager can manage purchase orders but is gated from receiving", async ({ page }) => {
  await login(page, "manager@zombeans.dev");

  // purchase.create → the orders page renders.
  await page.goto("/purchasing/orders");
  await expect(page.getByRole("heading", { name: "Purchase orders" })).toBeVisible();

  // No purchase.receive → receiving redirects to the dashboard.
  await page.goto("/purchasing/receiving");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("desktop sidebar shows purchasing links for inventory staff by permission", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sidebar is desktop-only; mobile uses a menu");
  await login(page, "inventory@zombeans.dev");

  await expect(page.getByRole("link", { name: "Receiving" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Suppliers" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Purchase orders" })).toHaveCount(0);
});

test("desktop sidebar shows purchasing links for branch manager by permission", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "sidebar is desktop-only; mobile uses a menu");
  await login(page, "manager@zombeans.dev");

  await expect(page.getByRole("link", { name: "Suppliers" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Purchase orders" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Receiving" })).toHaveCount(0);
});
