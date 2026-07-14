import { createHmac } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
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
  await expect(page).toHaveURL(new RegExp(`${destination}$`), { timeout: 15_000 });
}

async function completeLocalSuperAdminStepUp(page: Page) {
  await login(page, "superadmin@zombeans.dev", "/verify");
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const result = await db.query<{ id: string }>(
      `select id from auth.users where email = 'superadmin@zombeans.dev'`,
    );
    const marker = createHmac("sha256", STEPUP_PEPPER)
      .update(`stepup:${result.rows[0]!.id}`)
      .digest("hex");
    await page.context().addCookies([
      {
        name: "zb_stepup",
        value: marker,
        url: new URL(page.url()).origin,
        httpOnly: true,
      },
    ]);
  } finally {
    await db.end();
  }
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.flatMap((node) => node.target),
    }));
  expect(blocking).toEqual([]);
}

const roleRoutes = [
  { email: "inventory@zombeans.dev", path: "/dashboard", heading: /welcome back/i },
  { email: "production@zombeans.dev", path: "/production", heading: "Production" },
  {
    email: "manager@zombeans.dev",
    path: "/purchasing/orders",
    heading: "Purchase orders",
  },
] as const;

for (const route of roleRoutes) {
  test(`${route.email.split("@")[0]} ${route.path} has no serious WCAG A/AA violations`, async ({
    page,
  }) => {
    await login(page, route.email);
    await page.goto(route.path);
    await expect(
      page.getByRole("main").getByRole("heading", { name: route.heading }),
    ).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
  });
}

test("verified Super Admin costing has no serious WCAG A/AA violations", async ({ page }) => {
  await completeLocalSuperAdminStepUp(page);
  await page.goto("/costing");
  await expect(page.getByRole("heading", { name: "Costing dashboard" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("keyboard users can skip directly to the main landmark", async ({ page }) => {
  await login(page, "inventory@zombeans.dev");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("mobile operational routes do not overflow and expose coarse-pointer targets", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The mobile project owns viewport and touch-target verification.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await login(page, "manager@zombeans.dev");

  for (const path of ["/dashboard", "/purchasing/orders", "/offline-pos"]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();

    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.scrollWidth, `${path} horizontally overflows`).toBeLessThanOrEqual(
      viewport.clientWidth,
    );

    const undersized = await page
      .locator('button, [role="button"], input, select, textarea, nav a')
      .evaluateAll((elements) =>
        elements.flatMap((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const visible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== "hidden" &&
            style.display !== "none";
          return visible && rect.height < 43.5
            ? [{ target: element.outerHTML.slice(0, 180), height: rect.height }]
            : [];
        }),
      );
    expect(undersized, `${path} has undersized touch targets`).toEqual([]);
  }

  const transitionDuration = await page
    .getByRole("button", { name: "Open navigation" })
    .evaluate((element) => window.getComputedStyle(element).transitionDuration);
  expect(Number.parseFloat(transitionDuration)).toBeLessThanOrEqual(0.001);
});
