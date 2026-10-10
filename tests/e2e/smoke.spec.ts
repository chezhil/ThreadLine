import { test, expect } from "@playwright/test";
import { loginAs, OWNER } from "./auth";

// One golden-path check per module. This is deliberately a smoke suite, not
// full coverage: the business logic (costing, reversals, status transitions,
// races, hostile input) already has deep coverage in scripts/verify-*.ts,
// which run against the API directly. These tests exist to catch the UI
// failing to render or wire up to a working API, which the API-level scripts
// can't see.

test("login redirects to the owner dashboard", async ({ page }) => {
  await loginAs(page, OWNER.name, OWNER.password);
  await expect(page.getByRole("heading", { name: "Owner dashboard" })).toBeVisible();
});

test("module 1 — orders list loads and the new-order drawer opens", async ({ page }) => {
  await loginAs(page, OWNER.name, OWNER.password);
  await page.goto("/orders");
  await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
  await page.getByRole("button", { name: "New order" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("module 2 — floor board loads", async ({ page }) => {
  await loginAs(page, OWNER.name, OWNER.password);
  await page.goto("/production/floor-board");
  await expect(page.getByRole("heading", { name: "Live floor board" })).toBeVisible();
});

test("module 3 — rolls registry and dispatch load", async ({ page }) => {
  await loginAs(page, OWNER.name, OWNER.password);
  await page.goto("/quality/rolls");
  await expect(page.getByRole("heading", { name: "Fabric Rolls & QR Registry" })).toBeVisible();
  await page.goto("/dispatch");
  await expect(page.getByRole("heading", { name: "Dispatch & Truck Loading" })).toBeVisible();
});

test("module 4 — payments page loads and totals render", async ({ page }) => {
  await loginAs(page, OWNER.name, OWNER.password);
  await page.goto("/accounts/payments");
  await expect(page.getByRole("heading", { name: "Buyer payments" })).toBeVisible();
  await expect(page.getByText("Outstanding (all invoices)", { exact: false })).toBeVisible();
});

test("module 4 — archiving a worker and restoring it round-trips through the real API", async ({ page }) => {
  await loginAs(page, OWNER.name, OWNER.password);
  await page.goto("/accounts/workers");
  const row = page.getByRole("row", { name: /Ganesan S/ });
  await expect(row).toBeVisible();

  // Archiving drops the row out of the default (non-archived) view.
  await row.getByRole("button", { name: "Archive" }).click();
  await expect(row).toHaveCount(0);

  // "Show archived" brings it back, flagged, with Restore in place of Archive.
  await page.getByLabel("Show archived").check();
  // The badge's DOM text is lowercase "archived"; CSS only capitalizes it visually.
  await expect(row.getByText("archived", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Restore" })).toBeVisible();
  await row.getByRole("button", { name: "Restore" }).click();
  await expect(row.getByText("archived", { exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Archive" })).toBeVisible();
});
