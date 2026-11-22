import type { Page } from "@playwright/test";

import { pseudoLocalize } from "../scripts/pseudo-locale.mjs";
import { LANGUAGE_COOKIE } from "../src/i18n/config";
import english from "../messages/en.json";

import { expect, test } from "./fixtures";
import { ROUTES, VIEWPORTS, authState, expectNoHorizontalOverflow, ids, open, resolvePath, watchProblems } from "./helpers";

// Phase 1.7b: the pseudo-locale layout tests. They run in their own Playwright project against the separate test build made with I18N_PSEUDO=1
// (e2e/stack.mjs), where the language `en-XA` exists: every message of the REAL English catalogue made accented and about 35% longer, in memory (the
// catalogue file is not touched). A message that starts with ⟦ and ends with ⟧ is one catalogue message, so a message whose closing mark is not fully
// visible has been cut off. Every authenticated route and /login, at 375, 768 and 1280 px.
const PSEUDO = "en-XA";
const en = english as unknown as { common: Record<string, string>; leads: Record<string, string>; properties: Record<string, string>; tasks: Record<string, string>; shell: Record<string, string> };
const pseudoName = (message: string) => pseudoLocalize(message);

test.beforeEach(async ({ context, baseURL }) => {
  // the fixture has set the English cookie; this replaces it (same name, same origin) with the pseudo-locale
  await context.addCookies([{ name: LANGUAGE_COOKIE, value: PSEUDO, url: new URL(baseURL ?? "http://127.0.0.1").origin, sameSite: "Lax" }]);
});

/** Catalogue messages whose closing mark is outside the part of the page that is shown: cut by a hiding ancestor, by a line clamp, or by the screen. */
async function cutOffMessages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cut: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? "";
      const at = text.lastIndexOf("⟧");
      const el = node.parentElement;
      if (at < 0 || !el) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 1);
      const mark = range.getBoundingClientRect();
      if (mark.width === 0 && mark.height === 0) continue; // not rendered (a hidden branch)
      const label = text.trim().slice(0, 60);
      // 1. beyond the screen (text inside a region the user can scroll sideways, such as a wide table, is reachable and is not cut off)
      let scrollable = false;
      for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) if (/(auto|scroll)/.test(getComputedStyle(a).overflowX)) scrollable = true;
      if (!scrollable && (mark.right > window.innerWidth + 1 || mark.left < -1)) cut.push(`beyond the screen: ${label}`);
      // 2. hidden by an ancestor that clips (a scroller that the user can scroll is not clipping)
      for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        const box = a.getBoundingClientRect();
        const clipsX = /(hidden|clip)/.test(s.overflowX);
        const clipsY = /(hidden|clip)/.test(s.overflowY);
        if (clipsX && (mark.right > box.right + 1 || mark.left < box.left - 1)) { cut.push(`clipped sideways by <${a.tagName.toLowerCase()}>: ${label}`); break; }
        if (clipsY && (mark.bottom > box.bottom + 1 || mark.top < box.top - 1)) { cut.push(`clipped vertically by <${a.tagName.toLowerCase()}>: ${label}`); break; }
      }
    }
    return [...new Set(cut)];
  });
}

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
      if ((text.includes(" ") || text.length >= 8) && set.has(text)) leaks.push(text); // one short word may be data (a record's own text), a sentence or a long label is not
    }
    return [...new Set(leaks)];
  }, messages);
}

const plainMessages = Object.values(english as unknown as Record<string, Record<string, string>>)
  .flatMap((ns) => Object.values(ns))
  .filter((m) => typeof m === "string" && !/[{}<>]/.test(m));

async function expectPseudoPage(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("lang", PSEUDO);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  // the text really is the pseudo-locale: marked messages and accented letters
  const text = await page.locator("body").innerText();
  expect(text, "the page shows pseudo-localized messages").toContain("⟦");
  expect(text).toMatch(/[áéíóúçñ]/i);
}

async function expectNothingCut(page: Page) {
  expect(await cutOffMessages(page), "catalogue messages that are cut off").toEqual([]);
  await expectNoHorizontalOverflow(page);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, storageState: authState("manager") });

    for (const route of ROUTES) {
      test(`${route.name}: pseudo-localized, nothing cut off, no overflow, no English leak`, async ({ page }) => {
        const problems = watchProblems(page);
        await open(page, resolvePath(route.path));
        await expectPseudoPage(page);
        await expectNothingCut(page);
        expect(await englishLeaks(page, plainMessages), "English catalogue text shown without going through the catalogue").toEqual([]);
        expect(problems, problems.join("\n")).toEqual([]);
      });
    }

    test("long records (a long Arabic name, an unbroken Latin token) with the pseudo-localized interface: nothing cut off, no overflow", async ({ page }) => {
      const { longLead, longProperty } = ids();
      for (const route of ["/leads", `/leads/${longLead}`, "/properties", `/properties/${longProperty}`]) {
        await open(page, route);
        await expectPseudoPage(page);
        await expectNothingCut(page);
      }
    });

    test("the menu bar: the profile menu and the notifications link are shown whole", async ({ page }) => {
      await open(page, "/dashboard");
      await page.locator("button[aria-haspopup='menu']").click();
      await expect(page.getByRole("menu")).toBeVisible();
      await expectNothingCut(page);
      const menu = await page.getByRole("menu").boundingBox();
      expect(menu && menu.x >= -1 && menu.x + menu.width <= vp.width + 1, "the menu fits the screen").toBeTruthy();
    });

    test("navigation: every main link is reachable and its label is shown whole", async ({ page }) => {
      await open(page, "/dashboard");
      if (vp.width < 768) await page.getByRole("button", { name: pseudoName(en.shell.openMenu ?? "Open menu") }).click();
      const nav = page.getByRole("navigation").first();
      await expect(nav).toBeVisible();
      const links = nav.getByRole("link");
      expect(await links.count()).toBeGreaterThanOrEqual(10);
      await expectNothingCut(page);
      for (const index of [0, 1, 2]) await expect(links.nth(index)).toBeInViewport();
    });

    for (const dialog of [
      { name: "Add lead", route: "/leads", button: en.common.addLead },
      { name: "Add property", route: "/properties", button: en.common.addProperty },
      { name: "New task", route: "/tasks", button: en.common.newTask },
    ]) {
      test(`the ${dialog.name} dialog: fits the screen, buttons reachable, nothing cut off`, async ({ page }) => {
        await open(page, dialog.route);
        await page.getByRole("main").getByRole("button", { name: pseudoName(dialog.button), exact: true }).first().click();
        const box = page.getByRole("dialog");
        await expect(box).toBeVisible();
        await expect(box).toContainText("⟦");
        const rect = await box.boundingBox();
        expect(rect && rect.x >= -1 && rect.x + rect.width <= vp.width + 1, "the dialog fits the screen width").toBeTruthy();
        const buttons = box.getByRole("button");
        const last = buttons.last();
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport();
        await expectNothingCut(page);
      });
    }
  });
}

test.describe("the sign-in page (public)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const vp of VIEWPORTS) {
    test(`${vp.name} ${vp.width}px: pseudo-localized, nothing cut off, no overflow`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/login");
      await page.waitForLoadState("networkidle");
      await expectPseudoPage(page);
      await expectNothingCut(page);
      expect(await englishLeaks(page, plainMessages)).toEqual([]);
    });
  }
});
