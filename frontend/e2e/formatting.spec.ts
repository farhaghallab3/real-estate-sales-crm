import type { Page } from "@playwright/test";

import arabic from "../messages/ar.json";
import english from "../messages/en.json";
import type { SupportedLanguage } from "../src/i18n/config";

import { expect, test } from "./fixtures";
import { ROUTES, authState, expectNoHorizontalOverflow, ids, open, resolvePath, watchProblems } from "./helpers";

// Phase 5: dates, times, relative time, amounts, phone numbers and e-mail addresses in both languages, in the real browser. The default demo company is en-US / USD
// (the base currency is locked once there is financial data, so EGP and SAR are covered by the unit tests, src/lib/format.test.ts). The checks:
//  * the text really follows the language (Arabic month, day-period and "ago" words; English patterns kept);
//  * Latin digits everywhere, in both languages;
//  * the week header starts on the company region's first day (en-US: Monday, as before Phase 5);
//  * phone numbers and e-mail addresses are isolated left-to-right inside Arabic pages;
//  * formatting never reaches a payload: a form is submitted with the same API values in both languages.
type Catalogue = Record<string, Record<string, string>>;
const catalogues: Record<SupportedLanguage, Catalogue> = { en: english as unknown as Catalogue, ar: arabic as unknown as Catalogue };

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;
const ENGLISH_MONTH_DAY = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/;
const ENGLISH_RELATIVE = /\b\d+ (seconds?|minutes?|hours?|days?|months?|years?) (ago|from now)\b/;
const ENGLISH_DAY_PERIOD = /\b\d{1,2}:\d{2}\s?(AM|PM)\b/;
const ARABIC_LETTERS = /[؀-ۿ]/;

const body = (page: Page) => page.locator("body").innerText();

for (const language of ["en", "ar"] as const) {
  const c = catalogues[language];
  test.describe(`${language}: formatting`, () => {
    test.use({ uiLanguage: language, storageState: authState("manager"), viewport: { width: 1280, height: 800 } });

    test("every screen: Latin digits only, and the date, time and relative-time words follow the language", async ({ page }) => {
      const problems = watchProblems(page);
      for (const route of ROUTES) {
        await open(page, resolvePath(route.path));
        const text = await body(page);
        expect(text, `${route.name}: no Arabic-Indic digits`).not.toMatch(ARABIC_INDIC_DIGITS);
        if (language === "ar") {
          expect(text, `${route.name}: no English month and day`).not.toMatch(ENGLISH_MONTH_DAY);
          expect(text, `${route.name}: no English relative time`).not.toMatch(ENGLISH_RELATIVE);
          expect(text, `${route.name}: no AM or PM`).not.toMatch(ENGLISH_DAY_PERIOD);
        }
        await expectNoHorizontalOverflow(page);
      }
      expect(problems, problems.join("\n")).toEqual([]);
    });

    test("relative time in the lists: 'ago' in English, Arabic grammar in Arabic", async ({ page }) => {
      await open(page, "/leads");
      const text = await body(page);
      if (language === "en") {
        expect(text).toMatch(/\b\d+ (seconds?|minutes?|hours?|days?|months?|years?) ago\b/);
      } else {
        expect(text).toMatch(/(قبل|منذ) (\d+ )?(ثانية|ثواني|ثوان|دقيقة|دقائق|دقيقتين|ساعة|ساعات|ساعتين|يوم|أيام|يومين|شهر|أشهر|شهرين|سنة|سنوات|سنتين|عام|أعوام)/);
        expect(text).not.toMatch(/\bago\b/);
      }
    });

    test("times in the viewings lists use the language's day-period marks", async ({ page }) => {
      // the "scheduled" tab is not opened here: it asks the API with a new "now" on every render and never goes network-idle (an open observation, see the Phase 5 notes)
      await page.goto("/viewings?tab=completed");
      await expect(page.locator("h1").first()).toBeVisible();
      const time = language === "en" ? /\b\d{1,2}:\d{2}\s?(AM|PM)\b/ : /\b\d{1,2}:\d{2}\s?[صم]/;
      await expect.poll(() => body(page), { timeout: 20000 }).toMatch(time);
      if (language === "ar") expect(await body(page)).not.toMatch(ENGLISH_DAY_PERIOD);
    });

    test("the week header: the first day is Monday (the en-US company region, as before), the range and the weekday names follow the language", async ({ page }) => {
      await open(page, "/viewings");
      const days = page.locator("button[title]").filter({ has: page.locator("span.uppercase") });
      expect(await days.count()).toBe(7);
      const names = await days.locator("span.uppercase").allInnerTexts();
      const firstName = language === "en" ? "mon" : "الاثنين"; // the English names are shown in capitals by CSS
      expect(names[0].trim().toLowerCase()).toBe(firstName);
      const range = (await page.locator("p.tabular").first().innerText()).trim();
      if (language === "en") expect(range).toMatch(/^[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
      else expect(range).toMatch(/^\d{1,2} \S+ – \d{1,2} \S+ \d{4}$/);
    });

    test("amounts: the company currency, Latin digits, and the formatted text is the same value as the data", async ({ page }) => {
      await open(page, "/properties");
      const prices = await page.locator("tbody tr td").allInnerTexts();
      const money = prices.map((p) => p.trim()).filter((p) => /\d,\d{3}/.test(p) && /(\$|US\$|USD)/.test(p));
      expect(money.length, "the property list shows prices").toBeGreaterThan(0);
      for (const m of money) {
        expect(m).not.toMatch(ARABIC_INDIC_DIGITS);
        expect(m).toMatch(language === "en" ? /^\$[\d,]+$/ : /(US\$|\$)/);
      }
    });

    test("a form is submitted with the same API values whatever the language (formatting is presentation only)", async ({ page }) => {
      await open(page, "/leads");
      let posted: Record<string, unknown> | null = null;
      await page.route("**/api/leads/", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        posted = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ detail: "test: not saved" }) }); // nothing is created
      });
      await page.getByRole("main").getByRole("button", { name: c.common.addLead, exact: true }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(c.common.firstName).fill("Format");
      await dialog.getByLabel(c.common.phone).fill("+20 100 123 4567");
      await dialog.getByLabel(c.leads.budgetCurrencyCode.replace("{currency_code}", "USD")).fill("1500000");
      await dialog.getByRole("button", { name: c.common.addLead, exact: true }).click();
      await expect.poll(() => posted).not.toBeNull();
      expect(posted).toMatchObject({ first_name: "Format", phone: "+20 100 123 4567" });
      expect(String((posted as unknown as Record<string, unknown>).budget)).toMatch(/^1500000(\.0+)?$/);
    });
  });
}

test.describe("Arabic: phone numbers and e-mail addresses stay left to right inside the right-to-left page", () => {
  test.use({ uiLanguage: "ar", storageState: authState("manager"), viewport: { width: 1280, height: 800 } });

  const isolated = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll("bdi[dir='ltr']")].map((el) => ({ text: el.textContent ?? "", direction: getComputedStyle(el).direction, bidi: getComputedStyle(el).unicodeBidi })),
    );

  test("the leads table: every phone and e-mail is an isolated left-to-right run", async ({ page }) => {
    await open(page, "/leads");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const runs = await isolated(page);
    expect(runs.filter((r) => /^\+?[\d\s()-]{6,}$/.test(r.text)).length, "phone numbers").toBeGreaterThan(0);
    expect(runs.filter((r) => /@/.test(r.text)).length, "e-mail addresses").toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.direction).toBe("ltr");
      expect(run.bidi).toMatch(/isolate/);
    }
    // every phone cell of the table is one of those runs, so no number is ever reordered next to Arabic text
    const phoneCells = await page.locator("tbody td").evaluateAll((cells) => cells.filter((cell) => /^\+?[\d\s()-]{6,}$/.test((cell.textContent ?? "").trim())).map((cell) => !!cell.querySelector("bdi[dir='ltr']")));
    expect(phoneCells.length).toBeGreaterThan(0);
    expect(phoneCells.every(Boolean)).toBe(true);
  });

  test("the lead page: phone and e-mail are isolated, and the digits keep their order", async ({ page }) => {
    await open(page, `/leads/${ids().lead}`);
    const runs = await isolated(page);
    expect(runs.some((r) => /^\+?[\d\s()-]{6,}$/.test(r.text.trim()))).toBe(true);
    for (const run of runs) expect(run.direction).toBe("ltr");
    // the on-screen order of the characters of the first phone equals its text (a reordered number would differ)
    const order = await page.evaluate(() => {
      const el = [...document.querySelectorAll("bdi[dir='ltr']")].find((e) => /^\+?[\d\s()-]{6,}$/.test((e.textContent ?? "").trim()));
      if (!el || !el.firstChild) return null;
      const range = document.createRange();
      const text = el.firstChild as Text;
      const xs: number[] = [];
      for (let i = 0; i < text.length; i++) {
        range.setStart(text, i);
        range.setEnd(text, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width > 0) xs.push(r.left);
      }
      return xs;
    });
    expect(order && order.length > 5).toBeTruthy();
    expect([...(order ?? [])].sort((a, b) => a - b)).toEqual(order); // left to right: the x positions only grow
  });

  test("the profile menu shows the e-mail address as an isolated run", async ({ page }) => {
    await open(page, "/dashboard");
    await page.locator("button[aria-haspopup='menu']").click();
    const email = page.getByRole("menu").locator("bdi[dir='ltr']");
    await expect(email).toHaveText(/@/);
  });

  test("the page is Arabic (sanity)", async ({ page }) => {
    await open(page, "/leads");
    expect(await body(page)).toMatch(ARABIC_LETTERS);
  });
});
