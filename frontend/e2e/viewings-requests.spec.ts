import type { Page } from "@playwright/test";

import arabic from "../messages/ar.json";
import english from "../messages/en.json";
import type { SupportedLanguage } from "../src/i18n/config";

import { expect, test } from "./fixtures";
import { authState, open } from "./helpers";

// Regression: the viewings "Scheduled" tab put a new Date() into its query on every render, so the query key changed on every render and the list was requested
// again and again (the page never went network-idle). An unchanged view must request its data once; a genuine change (another tab, another week) must request again.
type Catalogue = Record<string, Record<string, unknown>>;
const catalogues: Record<SupportedLanguage, Catalogue> = { en: english as unknown as Catalogue, ar: arabic as unknown as Catalogue };

/** The GET requests for the viewings list seen so far, with their query strings. */
function watchViewingRequests(page: Page) {
  const seen: URLSearchParams[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "GET" && /\/api\/viewings\/$/.test(url.pathname)) seen.push(url.searchParams);
  });
  return seen;
}

for (const language of ["en", "ar"] as const) {
  const c = catalogues[language];
  const common = c.common as Record<string, string>; // the tab labels
  const viewings = c.viewings as Record<string, string>;

  test.describe(`${language}: viewings requests`, () => {
    test.use({ uiLanguage: language, storageState: authState("manager"), viewport: { width: 1280, height: 800 } });

    test("the Scheduled tab: an unchanged view requests its list once and goes network-idle", async ({ page }) => {
      const seen = watchViewingRequests(page);
      await open(page, "/viewings?tab=scheduled"); // open() waits for network idle: it timed out before the fix
      const afterLoad = seen.length;
      expect(afterLoad, "the list was requested").toBeGreaterThanOrEqual(1);
      expect(afterLoad, "and not again and again").toBeLessThanOrEqual(2);
      await page.waitForTimeout(4000);
      expect(seen.length, "an unchanged view makes no further request").toBe(afterLoad);
      expect(new Set(seen.map((s) => s.get("start_after"))).size, "always the same 'upcoming from' instant").toBe(1);
      expect(seen[0].get("status")).toBe("scheduled");
    });

    test("the Week tab: an unchanged view requests once; moving to the next week requests again with other dates", async ({ page }) => {
      const seen = watchViewingRequests(page);
      await open(page, "/viewings");
      const afterLoad = seen.length;
      expect(afterLoad).toBeGreaterThanOrEqual(1);
      expect(afterLoad).toBeLessThanOrEqual(2);
      await page.waitForTimeout(3000);
      expect(seen.length).toBe(afterLoad);
      const firstStart = seen[0].get("start_after");
      await page.getByRole("button", { name: viewings.nextWeek }).click();
      await expect.poll(() => seen.length, { message: "a genuine change requests again" }).toBeGreaterThan(afterLoad);
      expect(seen[seen.length - 1].get("start_after")).not.toBe(firstStart);
      const afterChange = seen.length;
      await page.waitForTimeout(3000);
      expect(seen.length, "and then it is quiet again").toBe(afterChange);
    });

    test("switching tabs requests the new list (status filter), and coming back to Scheduled asks again from a fresh moment", async ({ page }) => {
      const seen = watchViewingRequests(page);
      await open(page, "/viewings?tab=scheduled");
      const firstNow = seen[0].get("start_after");
      await page.getByRole("tab", { name: common.completed }).click();
      await expect.poll(() => seen.some((s) => s.get("status") === "completed")).toBe(true);
      await page.waitForTimeout(1500);
      await page.getByRole("tab", { name: common.upcoming }).click();
      await expect.poll(() => seen.filter((s) => s.get("status") === "scheduled").length).toBeGreaterThanOrEqual(2);
      const lastScheduled = [...seen].reverse().find((s) => s.get("status") === "scheduled");
      expect(lastScheduled?.get("start_after")).not.toBe(firstNow);
      const settled = seen.length;
      await page.waitForTimeout(3000);
      expect(seen.length, "quiet again after the change").toBe(settled);
    });
  });
}

test.describe("scheduling still works on a quiet Scheduled tab", () => {
  test.use({ storageState: authState("manager"), viewport: { width: 1280, height: 800 } });

  test("the schedule dialog opens from the week view (booking functionality is unchanged)", async ({ page, ui }) => {
    await open(page, "/viewings");
    await page.getByRole("button", { name: english.common.scheduleViewing, exact: true }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: ui.cancel, exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
