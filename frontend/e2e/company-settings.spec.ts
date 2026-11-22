import fs from "node:fs";

import { request as pwRequest } from "@playwright/test";

import { expect, test } from "./fixtures";
import { authState, open, watchProblems } from "./helpers";

// Phase 1.3b regression: saving the company settings re-renders the server layout (router.refresh()), so the document title follows the
// new company name while <html lang dir> stays en/ltr (English is the only supported language). Runs against the throw-away stack only.
test.describe("company settings save", () => {
  test.use({ storageState: authState("admin") });

  test("a saved company name reaches the document title now and after a reload, and lang/dir stay en/ltr", async ({ page, baseURL, ui }) => {
    const problems = watchProblems(page);
    const html = page.locator("html");
    const nameInput = page.getByLabel(ui.companyName);
    const unique = `E2E Co ${Date.now()}`;

    await open(page, "/settings");
    await expect(page.getByRole("heading", { name: ui.companyCard })).toBeVisible();
    await expect(nameInput).not.toHaveValue(""); // the form is filled from the saved settings: typing earlier would be overwritten
    const original = await nameInput.inputValue();
    expect(original).not.toBe(unique);
    await expect(html).toHaveAttribute("lang", "en");
    await expect(html).toHaveAttribute("dir", "ltr");

    try {
      await nameInput.fill(unique);
      await page.getByRole("button", { name: ui.saveCompanySettings }).click();
      await expect(page.getByRole("status").filter({ hasText: ui.companySettingsSaved })).toBeVisible(); // the toast region

      // router.refresh(): the title is rendered by the server layout and must follow without a reload
      await expect(page).toHaveTitle(new RegExp(`^${unique} — `));
      await expect(html).toHaveAttribute("lang", "en");
      await expect(html).toHaveAttribute("dir", "ltr");

      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); // the settings screen has exactly one page title
      await expect(page).toHaveTitle(new RegExp(`^${unique} — `));
      await expect(page.getByLabel(ui.companyName)).toHaveValue(unique);
      await expect(html).toHaveAttribute("lang", "en");
      await expect(html).toHaveAttribute("dir", "ltr");
      expect(problems, problems.join("\n")).toEqual([]);
    } finally {
      // put the throw-away company back as it was, so no other test sees the test name
      const token = JSON.parse(fs.readFileSync(authState("admin"), "utf8")).origins[0].localStorage[0].value as string;
      const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
      await api.patch("/api/company/settings/", { data: { company_name: original } });
      await api.dispose();
    }
  });
});
