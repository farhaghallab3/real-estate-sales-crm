import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { VIEWPORTS, authState, expectNoHorizontalOverflow, ids, open } from "./helpers";

// Phase 2 Gate A: the RTL engine. The interface is still English-only (Arabic is not enabled), so the Arabic look is forced the way the existing
// responsive tests force it, by setting lang="ar" dir="rtl" on <html> after load; the English LTR side of every assertion is checked in the same test
// (the English interface must not move). Geometry is measured, not screenshotted.
test.use({ storageState: authState("manager") });

type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };
const rect = (target: Locator): Promise<Rect> =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  });

/** The rectangle of the TEXT inside an element (padding excluded). */
const textRect = (target: Locator): Promise<Rect> =>
  target.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  });

const flipOf = (target: Locator): Promise<number> => target.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform === "none" ? undefined : getComputedStyle(el).transform).a);

async function show(page: Page, dir: "ltr" | "rtl") {
  await page.evaluate((d) => {
    document.documentElement.lang = d === "rtl" ? "ar" : "en";
    document.documentElement.dir = d;
  }, dir);
}

const TOL = 2; // sub-pixel and scrollbar tolerance, in px

for (const vp of VIEWPORTS) {
  for (const dir of ["ltr", "rtl"] as const) {
    test.describe(`${vp.name} ${vp.width}px, ${dir}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });
      const rtl = dir === "rtl";

      if (vp.width >= 768) {
        test("the sidebar sits at the inline start and the content does not overlap it", async ({ page }) => {
          await open(page, "/dashboard");
          await show(page, dir);
          const side = await rect(page.getByRole("complementary"));
          const main = await rect(page.getByRole("main"));
          if (rtl) {
            expect(side.right).toBeGreaterThanOrEqual(vp.width - TOL);
            expect(main.right).toBeLessThanOrEqual(side.left + TOL);
          } else {
            expect(side.left).toBeLessThanOrEqual(TOL);
            expect(main.left).toBeGreaterThanOrEqual(side.right - TOL);
          }
        });

        test("the collapse arrow points toward the edge the sidebar is on", async ({ page }) => {
          await open(page, "/dashboard");
          await show(page, dir);
          const arrow = page.getByRole("complementary").locator("svg.lucide-chevrons-left");
          expect(await flipOf(arrow)).toBe(rtl ? -1 : 1);
        });
      } else {
        test("the mobile drawer opens from the inline start", async ({ page, ui }) => {
          await open(page, "/dashboard");
          await show(page, dir);
          await page.getByRole("button", { name: ui.openMenu }).click();
          const drawer = await rect(page.getByRole("navigation", { name: ui.mainNavigation }).locator("xpath=ancestor::aside"));
          if (rtl) expect(drawer.right).toBeGreaterThanOrEqual(vp.width - TOL);
          else expect(drawer.left).toBeLessThanOrEqual(TOL);
        });
      }

      test("the profile menu is anchored to the inline end of its button and opens toward the inline start", async ({ page }) => {
        await open(page, "/dashboard");
        await show(page, dir);
        const trigger = page.locator("button[aria-haspopup='menu']");
        await trigger.click();
        const button = await rect(trigger);
        const menu = await rect(page.getByRole("menu"));
        if (rtl) expect(Math.abs(menu.left - button.left)).toBeLessThanOrEqual(TOL);
        else expect(Math.abs(menu.right - button.right)).toBeLessThanOrEqual(TOL);
        expect(menu.left).toBeGreaterThanOrEqual(-TOL);
        expect(menu.right).toBeLessThanOrEqual(vp.width + TOL);
      });

      test("toasts are placed at the inline end: bottom-right in English, bottom-left in RTL", async ({ page }) => {
        await open(page, "/dashboard");
        await show(page, dir);
        const region = await rect(page.getByTestId("toast-region"));
        if (rtl) expect(region.left).toBeLessThanOrEqual(16 + TOL);
        else expect(region.right).toBeGreaterThanOrEqual(vp.width - 16 - TOL);
        expect(region.bottom).toBeGreaterThanOrEqual(page.viewportSize()!.height - 16 - TOL);
      });

      test("directional icons are mirrored in RTL, other icons are not", async ({ page }) => {
        await open(page, "/leads");
        await show(page, dir);
        const flipped = rtl ? -1 : 1;
        expect(await flipOf(page.getByRole("main").locator("svg.lucide-chevron-left").first())).toBe(flipped); // pagination: previous
        expect(await flipOf(page.getByRole("main").locator("svg.lucide-chevron-right").first())).toBe(flipped); // pagination: next
        expect(await flipOf(page.getByRole("main").locator("svg.lucide-search").first())).toBe(1); // the magnifier is not directional
        await open(page, `/leads/${ids().lead}`);
        await show(page, dir);
        expect(await flipOf(page.getByRole("main").locator("svg.lucide-arrow-left").first())).toBe(flipped); // "back to the list"
      });

      test("numeric columns stay aligned to the end of the cell, text columns to the start", async ({ page }) => {
        await open(page, "/leads");
        await show(page, dir);
        // The cells under test are chosen by the very contract being tested, not by position: a numeric cell carries the logical end alignment (`text-end`, the
        // Budget column), and a text column header is a plain header with neither that class nor a sort button (the Phone column: its text is the whole content,
        // so the measured text rectangle is the text and not a full-width button).
        const numeric = page.locator("td.text-end").first();
        const cell = await rect(numeric);
        const text = await textRect(numeric);
        const head = page.locator("th:not(.text-end):not(:has(button))").first();
        const headCell = await rect(head);
        const headText = await textRect(head);
        // a numeric header (Budget: it has a sort button, which is only as wide as its text) hugs the same edge as its numbers
        const numericHead = page.locator("th.text-end").first();
        const numericHeadCell = await rect(numericHead);
        const numericHeadText = await textRect(numericHead);
        if (rtl) {
          expect(numericHeadText.left - numericHeadCell.left).toBeLessThan(numericHeadCell.right - numericHeadText.right);
        } else {
          expect(numericHeadCell.right - numericHeadText.right).toBeLessThan(numericHeadText.left - numericHeadCell.left);
        }
        if (rtl) {
          expect(text.left - cell.left).toBeLessThan(cell.right - text.right); // the number hugs the left edge: the END of the cell in RTL
          expect(headCell.right - headText.right).toBeLessThan(headText.left - headCell.left); // the heading hugs the right edge: the START
        } else {
          expect(cell.right - text.right).toBeLessThan(text.left - cell.left);
          expect(headText.left - headCell.left).toBeLessThan(headCell.right - headText.right);
        }
      });

      test("the search icon and the select arrow padding follow the direction", async ({ page, ui }) => {
        await open(page, "/leads");
        await show(page, dir);
        const input = page.getByRole("textbox", { name: ui.searchLeads });
        const field = await rect(input);
        const icon = await rect(input.locator("xpath=../*[name()='svg']"));
        if (rtl) expect(Math.abs(field.right - icon.right - 10)).toBeLessThanOrEqual(TOL + 1);
        else expect(Math.abs(icon.left - field.left - 10)).toBeLessThanOrEqual(TOL + 1);
        const select = page.getByRole("combobox", { name: ui.sourceFilter });
        const padding = await select.evaluate((el) => {
          const s = getComputedStyle(el);
          return { left: parseFloat(s.paddingLeft), right: parseFloat(s.paddingRight) };
        });
        if (rtl) expect(padding.left).toBeGreaterThan(padding.right);
        else expect(padding.right).toBeGreaterThan(padding.left);
      });

      test("the dialog close button is at the inline end, and Tab moves the focus in the visual order", async ({ page, ui }) => {
        await open(page, "/leads");
        await show(page, dir);
        await page.getByRole("main").getByRole("button", { name: ui.addLead, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const box = await rect(dialog);
        const close = await rect(dialog.getByRole("button", { name: ui.closeDialog }));
        const middle = (box.left + box.right) / 2;
        if (rtl) expect(close.left + close.width / 2).toBeLessThan(middle);
        else expect(close.left + close.width / 2).toBeGreaterThan(middle);
        // footer: Cancel comes first in the DOM, so the focus must move away from it toward where "Add lead" is drawn
        const cancel = dialog.getByRole("button", { name: ui.cancel });
        const add = dialog.getByRole("button", { name: ui.addLead, exact: true });
        await cancel.focus();
        await page.keyboard.press("Tab");
        await expect(add).toBeFocused();
        const cancelRect = await rect(cancel);
        const addRect = await rect(add);
        if (rtl) expect(addRect.left).toBeLessThan(cancelRect.left);
        else expect(addRect.left).toBeGreaterThan(cancelRect.left);
      });

      test("no horizontal overflow on the main screens", async ({ page }) => {
        for (const route of ["/dashboard", "/leads", "/pipeline", "/settings"]) {
          await open(page, route);
          await show(page, dir);
          await expectNoHorizontalOverflow(page);
        }
      });
    });
  }
}

test.describe("Arabic typography (only under lang=ar) and the English regression", () => {
  const read = (page: Page) =>
    page.evaluate(() => {
      const th = document.querySelector("th.uppercase") as HTMLElement;
      const small = document.querySelector(".text-2xs") as HTMLElement;
      const body = getComputedStyle(document.body);
      return {
        transform: getComputedStyle(th).textTransform,
        spacing: getComputedStyle(th).letterSpacing,
        smallSize: parseFloat(getComputedStyle(small).fontSize),
        lineHeightRatio: parseFloat(body.lineHeight) / parseFloat(body.fontSize),
        features: getComputedStyle(document.documentElement).fontFeatureSettings,
      };
    });

  test("English is unchanged: upper-cased spaced headings, 11 px small text, the Latin font features", async ({ page }) => {
    await open(page, "/leads");
    const en = await read(page);
    expect(en.transform).toBe("uppercase");
    expect(en.spacing).not.toBe("normal");
    expect(en.smallSize).toBe(11);
    expect(en.lineHeightRatio).toBeLessThan(1.6);
    expect(en.features).toContain("cv11");
  });

  test("under lang=ar: no upper-casing, no letter-spacing, a larger small size, a taller line-height, no Latin font features", async ({ page }) => {
    await open(page, "/leads");
    await show(page, "rtl");
    const ar = await read(page);
    expect(ar.transform).toBe("none");
    expect(ar.spacing).toBe("normal");
    expect(ar.smallSize).toBeGreaterThanOrEqual(13);
    expect(ar.lineHeightRatio).toBeGreaterThanOrEqual(1.6);
    expect(ar.features).toBe("normal");
  });
});
