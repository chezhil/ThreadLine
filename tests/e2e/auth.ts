import { Page } from "@playwright/test";

/** Logs the given seeded role in through the real login form. */
export async function loginAs(page: Page, name: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(name);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard/);
}

export const OWNER = { name: process.env.OWNER ?? "owner", password: process.env.OWNER_PW ?? "owner123" };
