import { expect, test } from "./fixtures";

import { authState, expectNoHorizontalOverflow, open, watchProblems } from "./helpers";

test.describe("sign-in", () => {
  for (const vp of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    test(`the sign-in page fits a ${vp.width}px screen`, async ({ page }) => {
      await page.setViewportSize(vp);
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test("a wrong password shows a clear error and stays on the page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("manager@crm.local");
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("a signed-out visitor is sent to the sign-in page", async ({ page }) => {
    await page.goto("/leads");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("phone navigation", () => {
  test.use({ storageState: authState("manager"), viewport: { width: 375, height: 812 } });

  test("the menu opens, reaches a screen and closes", async ({ page }) => {
    const problems = watchProblems(page);
    await open(page, "/dashboard");
    await page.getByRole("button", { name: "Open menu" }).click();
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    await nav.getByRole("link", { name: /Leads/ }).click();
    await expect(page).toHaveURL(/\/leads/);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("the Add lead form fits the screen and its submit button is reachable", async ({ page }) => {
    await open(page, "/leads");
    await page.getByRole("button", { name: "Add lead" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box && box.x >= -1 && box.x + box.width <= 376, "the dialog is wider than the screen").toBeTruthy();
    await dialog.getByRole("button", { name: "Add lead" }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole("button", { name: "Add lead" })).toBeInViewport();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe("who sees the company settings", () => {
  test.describe("admin", () => {
    test.use({ storageState: authState("admin") });
    test("the Company card is shown", async ({ page }) => {
      await open(page, "/settings");
      await expect(page.getByRole("heading", { name: "Company" })).toBeVisible();
    });
  });
  for (const role of ["manager", "sales"] as const) {
    test.describe(role, () => {
      test.use({ storageState: authState(role) });
      test("the Company card is hidden", async ({ page }) => {
        await open(page, "/settings");
        await expect(page.getByRole("heading", { name: "Company" })).toHaveCount(0);
      });
    });
  }
});

// The guard itself: a request to any host outside the local stack is blocked and fails the test (test.fail() = this test PASSES only if it fails).
test.describe("local-only guard", () => {
  test.use({ storageState: authState("manager") });
  test.fail("a request to an outside host is blocked and fails the test", async ({ page }) => {
    await open(page, "/dashboard");
    await page.evaluate(() => fetch("https://example.invalid/should-never-leave-the-machine").catch(() => null));
  });
});
