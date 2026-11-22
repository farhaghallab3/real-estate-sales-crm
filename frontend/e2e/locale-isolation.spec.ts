import { LANGUAGE_COOKIE } from "../src/i18n/config";

import { expect, test } from "./fixtures";

// Phase 1.7b isolation, in the product's own suite (the NORMAL build): the pseudo-locale does not exist here. Asking for it, by cookie or by header,
// changes nothing: the page is English, with no pseudo-locale marks. (The pseudo-locale itself is tested in pseudo.spec.ts, against its own build.)
test("the pseudo-locale cookie is ignored by the normal build: English, left to right, no pseudo-locale marks", async ({ context, page, baseURL }) => {
  await context.addCookies([{ name: LANGUAGE_COOKIE, value: "en-XA", url: new URL(baseURL ?? "http://127.0.0.1").origin, sameSite: "Lax" }]);
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/[⟦⟧]/);
  expect(text).toContain("Sign in");
});

test("a request for en-XA (cookie or Accept-Language) gets the English page from the normal build", async ({ playwright, baseURL }) => {
  const requests: Record<string, string>[] = [{ cookie: `${LANGUAGE_COOKIE}=en-XA` }, { "accept-language": "en-XA,en;q=0.5" }];
  for (const headers of requests) {
    const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: headers });
    const html = await (await api.get("/login")).text();
    expect(html).toMatch(/<html[^>]*\blang="en"/);
    expect(html).not.toMatch(/[⟦⟧]/);
    await api.dispose();
  }
});
