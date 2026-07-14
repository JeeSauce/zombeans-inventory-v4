import { defineConfig, devices } from "@playwright/test";

/** E2E config. Runs against a locally built production app; CI starts the server automatically. */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // Browser specs share seeded users and database fixtures; serialize to avoid cross-test mutation.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The transport also verifies that Supabase is loopback; this flag is rejected for hosted URLs.
    env: { E2E_ALLOW_CONSOLE_EMAIL: "true" },
  },
});
