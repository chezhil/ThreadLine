import { test, expect, type Page } from "@playwright/test";
import { loginAs, OWNER } from "./auth";

// App-shell and account features: brand link, collapsible sidebar, account
// menu, profile & settings, theme, command menu, shortcuts, tab icon.

const savePrefs = (page: Page, prefs: Record<string, unknown>) =>
  page.evaluate(
    (body) => fetch("/api/me/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.status),
    prefs,
  );

/** The shell's keyboard handlers exist only once the page has hydrated. */
const ready = (page: Page) => page.locator('[data-ready="1"]').waitFor();

test.beforeEach(async ({ page }) => {
  await loginAs(page, OWNER.name, OWNER.password);
  expect(await savePrefs(page, { theme: "light", sidebarCollapsed: false, textSize: "default", reduceMotion: false })).toBe(200);
  await page.goto("/orders");
  await ready(page);
});

test("tab icon is ThreadLine's, not the Next.js default", async ({ page }) => {
  const icons = await page.locator('link[rel~="icon"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  expect(icons.some((h) => /icon\.svg/.test(h ?? ""))).toBe(true);
  expect((await page.request.get("/favicon.ico")).status()).not.toBe(200);
  expect((await page.request.get("/icon.svg")).status()).toBe(200);
});

test("clicking the logo or the ThreadLine ERP name goes to the dashboard", async ({ page }) => {
  await page.getByRole("link", { name: /ThreadLine ERP/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/orders");
  await page.locator("aside").getByRole("link", { name: /ThreadLine ERP/ }).locator("svg").first().click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("the sidebar collapses to icons, stays collapsed after a reload, and expands again", async ({ page }) => {
  const aside = page.locator("aside");
  await expect(aside).toHaveAttribute("data-collapsed", "false");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(aside).toHaveAttribute("data-collapsed", "true");
  await expect(aside.getByText("Orders & Buyers")).toHaveCount(0);
  await expect(aside.getByRole("link", { name: /Orders & Buyers/ })).toBeVisible(); // still reachable as an icon
  await page.waitForTimeout(700); // preference save is debounced
  await page.reload();
  await ready(page);
  await expect(page.locator("aside")).toHaveAttribute("data-collapsed", "true");
  await page.keyboard.press("["); // keyboard shortcut toggles it back
  await expect(page.locator("aside")).toHaveAttribute("data-collapsed", "false");
});

test("sign out moved from the sidebar into the account menu", async ({ page }) => {
  await expect(page.locator("aside").getByText("Sign out")).toHaveCount(0);
  await page.getByRole("button", { name: /Account menu/ }).click();
  await expect(page.getByRole("menuitem", { name: "View profile" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("profile page: edit details and see them in the menu", async ({ page }) => {
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "View profile" }).click();
  await expect(page.getByRole("heading", { name: "Profile & settings" })).toBeVisible();
  const name = `Test Owner ${Date.now() % 1000}`;
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Phone").fill("abc");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Enter a valid phone number")).toBeVisible();
  await page.getByLabel("Phone").fill("+91 98765 43210");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(`Account menu for ${name}`) })).toBeVisible();
  // put it back
  await page.getByLabel("Full name").fill("");
  await page.getByLabel("Phone").fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
});

test("settings tabs are linkable and switch without a reload", async ({ page }) => {
  await page.goto("/profile?tab=security");
  await expect(page.getByRole("heading", { name: "Password" })).toBeVisible();
  await page.getByRole("button", { name: /Preferences/ }).click();
  await expect(page).toHaveURL(/tab=preferences/);
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Password" })).toBeVisible();
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/profile\?tab=preferences/);
});

test("dark theme applies at once and survives a reload", async ({ page }) => {
  await page.goto("/profile?tab=preferences");
  const frame = page.locator("[data-theme]").first();
  await page.getByRole("radio", { name: /Dark/ }).first().click();
  await expect(frame).toHaveAttribute("data-theme", "dark");
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector("[data-theme]")!).backgroundColor);
  expect(bg).toBe("rgb(15, 18, 22)");
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator("[data-theme]").first()).toHaveAttribute("data-theme", "dark");
});

test("command menu opens with Ctrl+K, filters, and navigates", async ({ page }) => {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Command menu" });
  await expect(dialog).toBeVisible();
  await page.keyboard.type("floor");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/production\/floor-board/);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("zzzzqq");
  await expect(page.getByText(/Nothing matches/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("keyboard shortcuts: ? shows help, g then a key navigates, typing is never hijacked", async ({ page }) => {
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/profile");
  await ready(page);
  await page.getByLabel("Full name").click();
  await page.keyboard.type("g?[d");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/profile/);
  await expect(page.getByLabel("Full name")).toHaveValue("g?[d");
});

test("larger text size scales the interface", async ({ page }) => {
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  await page.goto("/profile?tab=preferences");
  await page.getByRole("radio", { name: "Large" }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).not.toBe(before);
});

// Every role gets the same shell; the logo goes to *their* home and the
// command menu only offers pages they may open.
for (const [name, pw, home] of [
  ["storekeeper", "store123", /inventory/],
  ["floor", "floor123", /floor-board/],
  ["qc", "qc123", /quality\/qc/],
] as const) {
  test(`${name}: logo goes to their home, profile opens, command menu is role-aware`, async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto("/login");
    await page.getByLabel("Username").fill(name);
    await page.getByLabel("Password").fill(pw);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(home);
    await ready(page);
    await page.locator("aside").getByRole("link", { name: /ThreadLine ERP/ }).click();
    await expect(page).toHaveURL(home);
    await page.getByRole("button", { name: /Account menu/ }).click();
    await page.getByRole("menuitem", { name: "View profile" }).click();
    await expect(page.getByRole("heading", { name: "Profile & settings" })).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Command menu" })).toBeVisible();
    await expect(page.getByRole("option", { name: /Dashboard/ })).toHaveCount(0);
    await page.close();
  });
}
