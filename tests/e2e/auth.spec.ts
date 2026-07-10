import { test, expect } from "@playwright/test";

/**
 * Auth e2e — happy and failure paths. Runs against the built app (see playwright.config.ts),
 * which must have local Supabase running with the dev seed applied (`npm run seed:dev`).
 */

const PASSWORD = "Zombeans!Dev123";

test("unauthenticated access to a protected route redirects to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("wrong password shows an error and stays on login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("inventory@zombeans.dev");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/incorrect email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("inventory staff logs in and reaches the dashboard (no step-up)", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("inventory@zombeans.dev");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Inventory Staff")).toBeVisible();
  // Ordinary staff never sees admin navigation.
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);
});

test("super admin is gated to step-up verification after password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("superadmin@zombeans.dev");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Password alone must NOT grant a privileged session — held at /verify.
  await expect(page).toHaveURL(/\/verify$/);
  await expect(page.getByText(/verify it/i)).toBeVisible();
  // The dashboard is unreachable without completing step-up.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/verify$/);
});
