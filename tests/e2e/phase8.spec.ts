import { createHmac, randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "Zombeans!Dev123";
const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const STEPUP_PEPPER = process.env.STEPUP_CODE_PEPPER ?? "local-dev-stepup-pepper-change-me";

let db: Client;
let managerId = "";
let marker = "";

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
  const value = createHmac("sha256", STEPUP_PEPPER)
    .update(`stepup:${result.rows[0]!.id}`)
    .digest("hex");
  await page
    .context()
    .addCookies([{ name: "zb_stepup", value, url: "http://localhost:3000", httpOnly: true }]);
}

test.beforeAll(async ({}, testInfo) => {
  db = new Client({ connectionString: DB_URL });
  await db.connect();
  marker = `P8 ${testInfo.project.name} ${randomUUID().slice(0, 8)}`;
  managerId = (
    await db.query<{ id: string }>(
      `select id from public.profiles where email = 'manager@zombeans.dev'`,
    )
  ).rows[0]!.id;
  await db.query(
    `select public.raise_notification(
      'failed_production', $1, 'A failed production order needs review.',
      'phase8_e2e', null, $2, $3, null, null, $4
    )`,
    [
      `${marker} Critical`,
      marker,
      `phase8:e2e:${testInfo.project.name}:${randomUUID()}`,
      managerId,
    ],
  );
});

test.afterAll(async () => {
  await db.end();
});

test("dashboard cost cards are role-gated while operational cards remain visible", async ({
  page,
}) => {
  await login(page, "inventory@zombeans.dev");
  await expect(page.getByText("Low stock", { exact: true })).toBeVisible();
  await expect(page.getByText("Total inventory value", { exact: true })).toHaveCount(0);

  await page.context().clearCookies();
  await completeLocalSuperAdminStepUp(page);
  await page.goto("/dashboard");
  await expect(page.getByText("Total inventory value", { exact: true })).toBeVisible();
});

test("inventory staff sees the calendar as read-only on desktop and mobile", async ({ page }) => {
  await login(page, "inventory@zombeans.dev");
  await page.goto("/calendar");
  await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
  await expect(page.getByText("Read-only calendar", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create calendar event" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Month" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Week" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agenda" })).toBeVisible();
});

test("branch manager creates an Asia/Manila calendar event", async ({ page }) => {
  const title = `${marker} Calendar`;
  await login(page, "manager@zombeans.dev");
  await page.goto("/calendar");
  const form = page.getByRole("button", { name: "Create event" }).locator("xpath=ancestor::form");
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Location").fill("Phase 8 test kitchen");
  await form.getByRole("button", { name: "Create event" }).click();
  await expect(
    page.locator('[data-slot="card-title"]').getByText(title, { exact: true }),
  ).toBeVisible();
});

test("branch manager creates a separate popup engagement", async ({ page }) => {
  const title = `${marker} Popup`;
  await login(page, "manager@zombeans.dev");
  await page.goto("/popups");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Location").fill("Phase 8 weekend market");
  await page.getByRole("button", { name: "Create engagement" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});

test("acknowledging a Critical notification does not hide it", async ({ page }) => {
  const title = `${marker} Critical`;
  await login(page, "manager@zombeans.dev");
  await page.goto("/notifications");
  const card = page.locator('[data-slot="card"]').filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByText("Critical", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Acknowledge" }).click();
  await expect(card.getByText(/^Acknowledged /)).toBeVisible();
  await expect(card).toBeVisible();
});
