import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: process.env.FILLRATE_TEST_BASE_URL ?? "http://127.0.0.1:3101",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
});
