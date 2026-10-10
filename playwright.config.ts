import { defineConfig, devices } from "@playwright/test";

// Smoke coverage only: one golden-path check per module, running against a
// server already started and seeded (same convention as the BASE=... .mjs
// scripts) — not a from-scratch dev server, since the app needs a seeded DB.
//
//   BASE=http://localhost:3000 npx playwright test
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.BASE ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
