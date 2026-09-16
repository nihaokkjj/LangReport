import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "chromium-mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } }
  ],
  webServer: {
    command: "pnpm exec next dev --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_API_URL: "/api",
      NEXT_PUBLIC_DEV_USER_ID: "e2e-user",
      LANGREPORT_NEXT_DIST_DIR: ".next-e2e"
    }
  }
});
