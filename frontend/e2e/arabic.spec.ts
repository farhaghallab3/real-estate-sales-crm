import type { Page } from "@playwright/test";

import arabic from "../messages/ar.json";
import english from "../messages/en.json";
import { LANGUAGE_COOKIE } from "../src/i18n/config";

import { expect, test } from "./fixtures";
import { ROUTES, VIEWPORTS, authState, expectNoHorizontalOverflow, ids, open, resolvePath, watchProblems } from "./helpers";

// Phase 4: the Arabic interface in a real browser. Every authenticated route and /login, at 375, 768 and 1280 px, with the saved language `ar`: lang/dir, the
// Arabic font, Arabic text from the catalogue, no English interface text left, no console problem (a missing message is logged by next-intl), the RTL geometry,
// and the language switcher in both directions. (The English suites are the regression check of the English side; this file never changes the product's language
// outside its own browser contexts.)
type Catalogue = Record<string, Record<string, string>>;
const ar = arabic as unknown as Catalogue;
const en = english as unknown as Catalogue;
const AR = "ar";

test.beforeEach(async ({ context, baseURL }) => {
  // the fixture has set the English cookie; this replaces it (same name, same origin) with Arabic
  await context.addCookies([{ name: LANGUAGE_COOKIE, value: AR, url: new URL(baseURL ?? "http://127.0.0.1").origin, sameSite: "Lax" }]);
});

/** Text shown on the page that is exactly an English catalogue message: a literal that bypassed the catalogue (data such as names is not in the catalogue). */
async function englishLeaks(page: Page, messages: string[]): Promise<string[]> {
  return page.evaluate((all) => {
    const set = new Set(all);
    const leaks: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || getComputedStyle(el).display === "none") continue;
      const text = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
      if ((text.includes(" ") || text.length >= 8) && set.has(text)) leaks.push(text);
    }
    return [...new Set(leaks)];
  }, messages);
}

// English messages that must not appear in the Arabic interface: every plain one (no placeholders)
const plainEnglish = Object.values(en)
  .flatMap((ns) => Object.values(ns))
  .filter((m) => typeof m === "string" && !/[{}<>]/.test(m));

async function expectArabicPage(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const text = await page.locator("body").innerText();
  expect(text, "the page shows Arabic text").toMatch(/[؀-ۿ]/);
  // the Arabic font family is the one applied (ADR-0002); the face itself is downloaded only for Arabic text
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain("IBM Plex Sans Arabic");
  expect(await page.evaluate(() => document.documentElement.lang === "ar" && document.documentElement.dir === "rtl")).toBe(true);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, storageState: authState("manager") });

    for (const route of ROUTES) {
      test(`${route.name}: Arabic, rtl, no overflow, no English interface text, no problems`, async ({ page }) => {
        const problems = watchProblems(page);
        await open(page, resolvePath(route.path));
        await expectArabicPage(page);
        await expectNoHorizontalOverflow(page);
        expect(await englishLeaks(page, plainEnglish), "English catalogue text shown in the Arabic interface").toEqual([]);
        expect(problems, problems.join("\n")).toEqual([]);
      });
    }

    test("long records (a long Arabic name, an unbroken Latin token): no overflow", async ({ page }) => {
      const { longLead, longProperty } = ids();
      for (const route of ["/leads", `/leads/${longLead}`, "/properties", `/properties/${longProperty}`]) {
        await open(page, route);
        await expectArabicPage(page);
        await expectNoHorizontalOverflow(page);
      }
    });

    test("RTL geometry: the navigation is on the right edge, the page content starts at the right", async ({ page }) => {
      await open(page, "/dashboard");
      if (vp.width < 768) {
        await page.getByRole("button", { name: ar.shell.openMenu }).click();
        const nav = page.getByRole("navigation").first();
        await expect(nav).toBeVisible();
        const box = await nav.boundingBox();
        expect(box && box.x + box.width / 2 > vp.width / 2, "the drawer opens from the right").toBeTruthy();
      } else {
        const nav = page.getByRole("navigation").first();
        const box = await nav.boundingBox();
        expect(box && box.x + box.width / 2 > vp.width / 2, "the sidebar is on the right").toBeTruthy();
        const main = await page.getByRole("main").boundingBox();
        expect(main && main.x + main.width / 2 < vp.width / 2 + 1, "the content sits to the left of the sidebar").toBeTruthy();
      }
    });

    for (const dialog of [
      { name: "add lead", route: "/leads", button: ar.common.addLead },
      { name: "add property", route: "/properties", button: ar.common.addProperty },
      { name: "new task", route: "/tasks", button: ar.common.newTask },
    ]) {
      test(`the ${dialog.name} dialog opens in Arabic, fits the screen and its buttons are reachable`, async ({ page }) => {
        await open(page, dialog.route);
        await page.getByRole("main").getByRole("button", { name: dialog.button, exact: true }).first().click();
        const box = page.getByRole("dialog");
        await expect(box).toBeVisible();
        const rect = await box.boundingBox();
        expect(rect && rect.x >= -1 && rect.x + rect.width <= vp.width + 1, "the dialog fits the screen width").toBeTruthy();
        const last = box.getByRole("button").last();
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport();
        await expectNoHorizontalOverflow(page);
      });
    }
  });
}

test.describe("the sign-in page (public)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const vp of VIEWPORTS) {
    test(`${vp.name} ${vp.width}px: Arabic, rtl, no overflow, no English interface text`, async ({ page }) => {
      const problems = watchProblems(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
      await expectArabicPage(page);
      await expectNoHorizontalOverflow(page);
      await expect(page.getByRole("heading", { name: ar.auth.signIn })).toBeVisible();
      expect(await englishLeaks(page, plainEnglish)).toEqual([]);
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
});

test.describe("the language switcher", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the sign-in page: English to Arabic and back, the choice is saved in the crm_lang cookie", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: LANGUAGE_COOKIE, value: "en", url: new URL(baseURL ?? "http://127.0.0.1").origin, sameSite: "Lax" }]);
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const group = page.getByRole("group", { name: en.shell.language });
    await expect(group.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    await group.getByRole("button", { name: "العربية" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    expect((await context.cookies()).find((c) => c.name === LANGUAGE_COOKIE)?.value).toBe("ar");
    await expect(page.getByRole("heading", { name: ar.auth.signIn })).toBeVisible();
    await page.getByRole("group", { name: ar.shell.language }).getByRole("button", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    expect((await context.cookies()).find((c) => c.name === LANGUAGE_COOKIE)?.value).toBe("en");
  });

  test.describe("signed in", () => {
    test.use({ storageState: authState("manager") });

    test("the profile menu: switch to Arabic, the page is Arabic after the refresh, it stays Arabic on another page, then back to English", async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: LANGUAGE_COOKIE, value: "en", url: new URL(baseURL ?? "http://127.0.0.1").origin, sameSite: "Lax" }]);
      const problems = watchProblems(page);
      await open(page, "/dashboard");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await page.locator("button[aria-haspopup='menu']").click();
      const arabicItem = page.getByRole("menuitemradio", { name: "العربية" });
      await expect(page.getByRole("menuitemradio", { name: "English" })).toHaveAttribute("aria-checked", "true");
      await arabicItem.click();
      await expect(page.locator("html")).toHaveAttribute("lang", "ar");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.getByRole("navigation").first().getByRole("link", { name: ar.shell.navLeads })).toBeVisible();
      await open(page, "/leads");
      await expect(page.locator("html")).toHaveAttribute("lang", "ar");
      await expectArabicPage(page);
      // and back to English from the same menu
      await page.locator("button[aria-haspopup='menu']").click();
      await expect(page.getByRole("menuitemradio", { name: "العربية" })).toHaveAttribute("aria-checked", "true");
      await page.getByRole("menuitemradio", { name: "English" }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
      await expect(page.getByRole("navigation").first().getByRole("link", { name: /Leads/ })).toBeVisible();
      expect(problems, problems.join("\n")).toEqual([]);
    });
  });
});
