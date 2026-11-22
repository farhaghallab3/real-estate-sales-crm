import { expect, test } from "./fixtures";

import { open, watchProblems } from "./helpers";

// Phase 1.3b / Phase 4: the language shell. English and Arabic are supported: a request resolves to en/ltr or ar/rtl by the documented precedence
// (saved language, then company language, then browser), anything else falls back to English, and the provider hydrates without a warning.
const shell = (page: import("@playwright/test").Page) => page.locator("html");

test.describe("language shell", () => {
  test("the login page renders lang=en dir=ltr and hydrates without problems", async ({ page }) => {
    const problems = watchProblems(page);
    await open(page, "/login");
    await expect(shell(page)).toHaveAttribute("lang", "en");
    await expect(shell(page)).toHaveAttribute("dir", "ltr");
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("the initial HTML (before any script runs) already carries lang and dir", async ({ request }) => {
    const html = await (await request.get("/login")).text();
    expect(html).toMatch(/<html[^>]*\blang="en"/);
    expect(html).toMatch(/<html[^>]*\bdir="ltr"/);
  });

  test.describe("Arabic browser requests", () => {
    test.use({ extraHTTPHeaders: { "accept-language": "ar-EG,ar;q=0.9,en;q=0.5" } });

    test("an Arabic Accept-Language does not override the company language (English): the browser language ranks last", async ({ playwright, baseURL }) => {
      // a fresh request context: the fixture's own one already carries the saved English language
      const fresh = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "accept-language": "ar-EG,ar;q=0.9,en;q=0.5" } });
      const html = await (await fresh.get("/login")).text();
      await fresh.dispose();
      expect(html).toMatch(/<html[^>]*\blang="en"/);
      expect(html).toMatch(/<html[^>]*\bdir="ltr"/);
    });

    test("a saved English language (the crm_lang cookie) beats an Arabic Accept-Language", async ({ request }) => {
      const html = await (await request.get("/login", { headers: { cookie: "crm_lang=en" } })).text();
      expect(html).toMatch(/<html[^>]*\blang="en"/);
      expect(html).toMatch(/<html[^>]*\bdir="ltr"/);
    });
  });

  test("a saved Arabic language (the crm_lang cookie) renders ar/rtl and hydrates without problems", async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "crm_lang", value: "ar", url: baseURL ?? "http://localhost:3000" }]);
    const problems = watchProblems(page);
    await open(page, "/login");
    await expect(shell(page)).toHaveAttribute("lang", "ar");
    await expect(shell(page)).toHaveAttribute("dir", "rtl");
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("a crm_lang cookie outside the allow-list is ignored", async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "crm_lang", value: "fr", url: baseURL ?? "http://localhost:3000" }]);
    const problems = watchProblems(page);
    await open(page, "/login");
    await expect(shell(page)).toHaveAttribute("lang", "en");
    await expect(shell(page)).toHaveAttribute("dir", "ltr");
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
