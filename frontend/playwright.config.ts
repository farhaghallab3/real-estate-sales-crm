import { defineConfig } from "@playwright/test";

// The stack (throw-away PostgreSQL + the real backend image + the production build of this frontend) is started by e2e/stack.mjs,
// which sets E2E_BASE_URL and the test password. Run everything with:  npm run e2e
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:13100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // the product's own suite, against the normal production build
    { name: "chromium", use: { browserName: "chromium" }, testIgnore: /pseudo\.spec\.ts$/ },
    // the pseudo-locale layout tests, against the separate test build made with I18N_PSEUDO=1 (e2e/stack.mjs starts it; E2E_BASE_URL then points to it)
    { name: "pseudo", use: { browserName: "chromium" }, testMatch: /pseudo\.spec\.ts$/ },
  ],
});
