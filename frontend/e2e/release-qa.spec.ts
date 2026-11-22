import fs from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import arabic from "../messages/ar.json";
import english from "../messages/en.json";
import { LANGUAGE_COOKIE, type SupportedLanguage } from "../src/i18n/config";

import { expect, test } from "./fixtures";
import { ROUTES, VIEWPORTS, authState, expectNoHorizontalOverflow, open, resolvePath } from "./helpers";

// Final localization QA: what the phase specs do not cover as a whole. Persistence of the choice, accessible names and attribute text in both languages, the font
// transfer over representative screens, the browser's confirm dialogs, and an expired session. (The phase specs already cover lang/dir, RTL geometry, dates, amounts,
// phone and e-mail isolation, form validation and API errors; they run in the same suite.)
type Catalogue = Record<string, Record<string, unknown>>;
const catalogues: Record<SupportedLanguage, Catalogue> = { en: english as unknown as Catalogue, ar: arabic as unknown as Catalogue };
const plainEnglish = Object.values(english as unknown as Catalogue)
  .flatMap((ns) => Object.values(ns))
  .filter((m): m is string => typeof m === "string" && !/[{}<>]/.test(m) && (m.includes(" ") || m.length >= 8));

async function setLanguageCookie(page: Page, baseURL: string | undefined, value: string) {
  await page.context().addCookies([{ name: LANGUAGE_COOKIE, value, url: new URL(baseURL ?? "http://127.0.0.1").origin, sameSite: "Lax" }]);
}

// ---- 1. persistence ---------------------------------------------------------------------------------------------------------------------------------
test.describe("the language choice persists", () => {
  test.use({ storageState: authState("manager"), viewport: { width: 1280, height: 800 } });

  test("switch to Arabic from the profile menu: it survives a reload, other pages, a new tab and a new navigation; the cookie follows the contract", async ({ page, context, baseURL }) => {
    await setLanguageCookie(page, baseURL, "en");
    await open(page, "/dashboard");
    await page.locator("button[aria-haspopup='menu']").click();
    await page.getByRole("menuitemradio", { name: "العربية" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    for (const route of ["/leads", "/properties", "/deals"]) {
      await open(page, route);
      await expect(page.locator("html")).toHaveAttribute("lang", "ar");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    }
    const second = await context.newPage();
    await second.goto("/tasks");
    await expect(second.locator("html")).toHaveAttribute("lang", "ar");
    await second.close();
    const cookie = (await context.cookies()).find((c) => c.name === LANGUAGE_COOKIE);
    expect(cookie?.value).toBe("ar");
    expect(cookie?.path).toBe("/");
    expect(cookie?.sameSite).toBe("Lax");
    expect(cookie?.httpOnly).toBe(false);
    const year = 365 * 24 * 3600;
    expect((cookie?.expires ?? 0) - Date.now() / 1000).toBeGreaterThan(year - 3600);
    // and back to English
    await page.locator("button[aria-haspopup='menu']").click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("with no saved language the default is English; a saved language beats the company language and the browser language", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, storageState: authState("manager"), locale: "ar-EG", extraHTTPHeaders: { "accept-language": "ar-EG,ar;q=0.9" } });
    const page = await context.newPage();
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "en"); // the company language ranks above the browser's
    await context.addCookies([{ name: LANGUAGE_COOKIE, value: "ar", url: new URL(baseURL ?? "http://127.0.0.1").origin, sameSite: "Lax" }]);
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    await context.close();
  });
});

// ---- 2. accessible names and attribute text, both languages, three viewports -------------------------------------------------------------------------
async function audit(page: Page, english: string[]) {
  return page.evaluate((englishMessages) => {
    const set = new Set(englishMessages);
    const name = (el: Element): string => {
      const aria = el.getAttribute("aria-label")?.trim();
      if (aria) return aria;
      const by = el.getAttribute("aria-labelledby");
      if (by) {
        const text = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
        if (text) return text;
      }
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        const labels = el.labels ? [...el.labels].map((l) => l.textContent ?? "").join(" ").trim() : "";
        if (labels) return labels;
        return (el.getAttribute("title") ?? "").trim();
      }
      const text = (el.textContent ?? "").trim();
      if (text) return text;
      const img = el.querySelector("img[alt]");
      if (img && img.getAttribute("alt")?.trim()) return img.getAttribute("alt")!.trim();
      return (el.getAttribute("title") ?? "").trim();
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && (r.width > 0 || r.height > 0);
    };
    const unnamed: string[] = [];
    for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=menuitem], [role=tab]")) {
      if (!visible(el)) continue;
      if (!name(el)) unnamed.push(`${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 2).join(".")}`);
    }
    const leaks: string[] = [];
    for (const el of document.querySelectorAll("[aria-label], [title], [placeholder], img[alt]")) {
      for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
        const value = el.getAttribute(attr)?.trim();
        if (value && set.has(value)) leaks.push(`${attr}=${value}`);
      }
    }
    return {
      unnamed,
      leaks: [...new Set(leaks)],
      h1: document.querySelectorAll("h1").length,
      lang: document.documentElement.lang,
      title: document.title,
      imagesWithoutAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length,
    };
  }, english);
}

for (const vp of VIEWPORTS) {
  test.describe(`accessibility audit at ${vp.name} ${vp.width}px`, () => {
    test.use({ storageState: authState("manager"), viewport: { width: vp.width, height: vp.height } });

    test("Arabic has no English attribute text, no more unnamed controls than English, one heading, no overflow", async ({ page, baseURL }) => {
      const result: Record<string, { en: string[]; ar: string[] }> = {};
      for (const route of ROUTES) {
        await setLanguageCookie(page, baseURL, "en");
        await open(page, resolvePath(route.path));
        const en = await audit(page, []);
        await setLanguageCookie(page, baseURL, "ar");
        await open(page, resolvePath(route.path));
        const ar = await audit(page, plainEnglish);
        result[route.name] = { en: en.unnamed, ar: ar.unnamed };
        expect(ar.leaks, `${route.name}: English text in aria-label, title, placeholder or alt`).toEqual([]);
        expect(ar.unnamed.length, `${route.name}: unnamed controls (Arabic ${ar.unnamed.join(", ")}; English ${en.unnamed.join(", ")})`).toBeLessThanOrEqual(en.unnamed.length);
        expect(ar.h1, `${route.name}: headings`).toBe(en.h1);
        expect(ar.imagesWithoutAlt).toBeLessThanOrEqual(en.imagesWithoutAlt);
        expect(ar.lang).toBe("ar");
        expect(ar.title.length, `${route.name}: document title`).toBeGreaterThan(0);
        await expectNoHorizontalOverflow(page);
      }
      // evidence in the report: a control without a name is an existing gap if English has it too
      test.info().annotations.push({ type: "unnamed-controls", description: JSON.stringify(result) });
      fs.writeFileSync(path.join(__dirname, ".auth", `qa-unnamed-${vp.width}.json`), JSON.stringify(result, null, 1)); // evidence for the QA report (the folder is git-ignored)
    });
  });
}

// ---- 3. font transfer over representative screens ------------------------------------------------------------------------------------------------------
const SCREENS = ["/dashboard", "/leads", "/leads/{lead}", "/properties", "/properties/{property}", "/pipeline", "/deals", "/deals/{deal}", "/viewings", "/tasks", "/commissions", "/documents", "/reports", "/settings"];
const BUDGET = 200 * 1024; // ADR-0002

for (const language of ["en", "ar"] as const) {
  test.describe(`${language}: font files over representative screens`, () => {
    test.use({ storageState: authState("manager"), viewport: { width: 1280, height: 800 } });

    test(language === "en" ? "English requests no font file at all" : `Arabic transfers at most ${BUDGET / 1024} KB of font files across ${SCREENS.length} screens`, async ({ page, baseURL }) => {
      await setLanguageCookie(page, baseURL, language);
      const fonts = new Map<string, number>();
      page.on("requestfinished", async (request) => {
        if (!/\.(woff2?|ttf|otf)(\?|$)/i.test(request.url())) return;
        const sizes = await request.sizes().catch(() => null);
        fonts.set(request.url(), sizes?.responseBodySize ?? 0);
      });
      for (const screen of SCREENS) await open(page, resolvePath(screen));
      await page.waitForTimeout(500);
      const total = [...fonts.values()].reduce((a, b) => a + b, 0);
      test.info().annotations.push({ type: "font-transfer", description: `${language}: ${fonts.size} files, ${(total / 1024).toFixed(1)} KB` });
      fs.writeFileSync(path.join(__dirname, ".auth", `qa-fonts-${language}.json`), JSON.stringify({ files: fonts.size, bytes: total, list: Object.fromEntries(fonts) }, null, 1));
      if (language === "en") expect([...fonts.keys()]).toEqual([]);
      else {
        expect(fonts.size, "the Arabic font files are requested").toBeGreaterThan(0);
        expect(total, `${[...fonts.entries()].map(([u, s]) => `${u.split("/").pop()}=${s}`).join(", ")}`).toBeLessThanOrEqual(BUDGET);
      }
    });
  });
}

// ---- 4. confirm dialogs and an expired session, both languages --------------------------------------------------------------------------------------
for (const language of ["en", "ar"] as const) {
  const c = catalogues[language];

  test.describe(`${language}: dialogs and session`, () => {
    test.use({ uiLanguage: language, storageState: authState("manager"), viewport: { width: 1280, height: 800 } });

    test("the cancel-viewing confirmation is in the interface language", async ({ page }) => {
      await page.goto("/viewings?tab=scheduled");
      await expect(page.locator("h1").first()).toBeVisible();
      const cancel = page.getByRole("button", { name: (c.viewings as Record<string, string>).cancelViewing }).first();
      await expect(cancel).toBeVisible({ timeout: 20000 });
      let message = "";
      page.once("dialog", (dialog) => {
        message = dialog.message();
        void dialog.dismiss(); // nothing is cancelled
      });
      await cancel.click();
      await expect.poll(() => message).not.toBe("");
      if (language === "ar") {
        expect(message).toMatch(/[؀-ۿ]/);
        expect(message).not.toMatch(/Cancel the viewing/);
      } else expect(message).toMatch(/^Cancel the viewing with /);
    });

    test("an expired session (401 everywhere, refresh refused): back to the sign-in page in the same language, tokens cleared, no technical text", async ({ page }) => {
      await open(page, "/leads");
      await page.route(/\/api\//, (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Given token not valid for any token type", code: "token_not_valid" }) }));
      await page.reload();
      await expect(page).toHaveURL(/\/login/, { timeout: 20000 });
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expect(page.getByRole("heading", { name: (c.auth as Record<string, string>).signIn })).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem("crm.access"))).toBeNull();
      expect(await page.locator("body").innerText()).not.toMatch(/token_not_valid|Given token|Traceback/);
    });
  });
}

// ---- 5. dialogs and pickers in Arabic: no English text in the dialog, its options or its placeholders -----------------------------------------------------
test.describe("Arabic dialogs have no English interface text", () => {
  test.use({ uiLanguage: "ar", storageState: authState("manager"), viewport: { width: 1280, height: 800 } });
  const ar = catalogues.ar;

  for (const dialog of [
    { name: "add lead", route: "/leads", button: (ar.common as Record<string, string>).addLead },
    { name: "add property", route: "/properties", button: (ar.common as Record<string, string>).addProperty },
    { name: "new task", route: "/tasks", button: (ar.common as Record<string, string>).newTask },
  ]) {
    test(`the ${dialog.name} dialog`, async ({ page }) => {
      await open(page, dialog.route);
      await page.getByRole("main").getByRole("button", { name: dialog.button, exact: true }).first().click();
      const box = page.getByRole("dialog");
      await expect(box).toBeVisible();
      const leaks = await box.evaluate((el, english) => {
        const set = new Set(english);
        const found: string[] = [];
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = (n.nodeValue ?? "").replace(/\s+/g, " ").trim();
          if (set.has(text)) found.push(text);
        }
        for (const node of el.querySelectorAll("[placeholder], [aria-label], [title]")) {
          for (const attr of ["placeholder", "aria-label", "title"]) {
            const value = node.getAttribute(attr)?.trim();
            if (value && set.has(value)) found.push(`${attr}=${value}`);
          }
        }
        return [...new Set(found)];
      }, plainEnglish);
      expect(leaks, "English catalogue text inside the Arabic dialog").toEqual([]);
    });
  }
});
