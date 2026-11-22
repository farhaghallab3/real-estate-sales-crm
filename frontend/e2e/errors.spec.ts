import type { Page, Route } from "@playwright/test";

import arabic from "../messages/ar.json";
import english from "../messages/en.json";
import type { SupportedLanguage } from "../src/i18n/config";

import { expect, test } from "./fixtures";
import { authState, open } from "./helpers";

// Phase 6: backend errors in the user's language, in the real browser. The failures that cannot be caused safely on the real backend (a 403, a 429, a 500, a dropped
// connection, a message the table does not know) are answered by the browser for ONE request (page.route); nothing reaches the backend, nothing is changed in the
// test data, and the real 401 (wrong password) and 404 (missing lead) go to the real backend. The checks: the message follows the language, validation stays on its own
// field, the server's text of a 5xx never reaches the screen, and an unknown 4xx message is still shown (English as it was, Arabic after a localized sentence).
type Catalogue = Record<string, Record<string, string>>;
const catalogues: Record<SupportedLanguage, Catalogue> = { en: english as unknown as Catalogue, ar: arabic as unknown as Catalogue };
const SECRET = "Traceback (most recent call last): File /app/secret.py password=hunter2";

const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Answers the POST that creates a lead with `respond`, and lets nothing through. */
async function answerLeadCreate(page: Page, respond: (route: Route) => Promise<void>) {
  await page.route(/\/api\/leads\/$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return respond(route);
  });
}

async function submitLeadForm(page: Page, c: Catalogue) {
  await page.getByRole("main").getByRole("button", { name: c.common.addLead, exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(c.common.firstName).fill("Error");
  await dialog.getByLabel(c.common.phone).fill("+20 100 123 4567");
  await dialog.getByRole("button", { name: c.common.addLead, exact: true }).click();
  return dialog;
}

for (const language of ["en", "ar"] as const) {
  const c = catalogues[language];
  const errors = c.errors;

  test.describe(`${language}: sign-in failures`, () => {
    test.use({ uiLanguage: language, storageState: { cookies: [], origins: [] } });

    const submit = async (page: Page, password: string) => {
      await page.goto("/login");
      await page.getByLabel(c.common.email).fill("manager@crm.local");
      await page.getByLabel(c.common.password).fill(password);
      await page.getByRole("button", { name: c.auth.signIn, exact: true }).click();
    };

    test("a wrong password (the real backend answers 401): the sign-in message", async ({ page }) => {
      await submit(page, "definitely-not-the-password");
      await expect(page.getByText(c.auth.incorrectEmailOrPassword)).toBeVisible();
    });

    test("too many attempts (429 with the wait): the rate-limit message with the wait in the language's plural form", async ({ page }) => {
      await page.route(/\/api\/auth\/login\/$/, (route) => json(route, 429, { detail: "Request was throttled. Expected available in 37 seconds." }));
      await submit(page, "anything");
      await expect(page.getByText(language === "en" ? "Too many requests. Please try again in 37 seconds." : "عدد الطلبات كبير جدًا. يُرجى المحاولة بعد 37 ثانية.")).toBeVisible();
    });

    test("no connection: the network message", async ({ page }) => {
      await page.route(/\/api\/auth\/login\/$/, (route) => route.abort("failed"));
      await submit(page, "anything");
      await expect(page.getByText(errors.network)).toBeVisible();
    });

    test("a server error (500 with a stack trace): the old generic sign-in message, never the server's text", async ({ page }) => {
      await page.route(/\/api\/auth\/login\/$/, (route) => route.fulfill({ status: 500, contentType: "text/html", body: `<html>${SECRET}</html>` }));
      await submit(page, "anything");
      await expect(page.getByText(c.auth.unableSignRightNowPlease)).toBeVisible();
      await expect(page.getByText(/hunter2|Traceback/)).toHaveCount(0);
    });
  });

  test.describe(`${language}: form errors`, () => {
    test.use({ uiLanguage: language, storageState: authState("manager"), viewport: { width: 1280, height: 800 } });

    test("a validation error stays on its own field, translated", async ({ page }) => {
      await open(page, "/leads");
      await answerLeadCreate(page, (route) => json(route, 400, { phone: ["This field may not be blank."], email: ["Enter a valid email address."] }));
      const dialog = await submitLeadForm(page, c);
      await expect(dialog.locator("label", { hasText: c.common.phone }).getByRole("alert")).toHaveText(errors.blank);
      await expect(dialog.locator("label", { hasText: c.common.email }).getByRole("alert")).toHaveText(errors.invalidEmail);
      await expect(dialog.locator("label", { hasText: c.common.firstName }).getByRole("alert")).toHaveCount(0);
    });

    test("a business rule (400 with a detail): the form error, translated", async ({ page }) => {
      await open(page, "/leads");
      await answerLeadCreate(page, (route) => json(route, 400, { detail: "Only managers can reassign leads." }));
      const dialog = await submitLeadForm(page, c);
      await expect(dialog.getByRole("alert")).toHaveText(errors.managersReassignLeads);
    });

    test("a permission error (403): the forbidden message, and the dialog stays open", async ({ page }) => {
      await open(page, "/leads");
      await answerLeadCreate(page, (route) => json(route, 403, { detail: "You do not have permission to perform this action." }));
      const dialog = await submitLeadForm(page, c);
      await expect(dialog.getByRole("alert")).toHaveText(errors.forbidden);
      await expect(dialog).toBeVisible();
    });

    test("an unknown message is never hidden: English shows it as before, Arabic shows it after a localized sentence", async ({ page }) => {
      await open(page, "/leads");
      await answerLeadCreate(page, (route) => json(route, 400, { detail: "A brand new rule." }));
      const dialog = await submitLeadForm(page, c);
      await expect(dialog.getByRole("alert")).toHaveText(language === "en" ? "A brand new rule." : "حدث خطأ ما: A brand new rule.");
    });

    test("a server error (500): the generic message only, the server's text never reaches the page", async ({ page }) => {
      await open(page, "/leads");
      await answerLeadCreate(page, (route) => route.fulfill({ status: 500, contentType: "text/html", body: `<html>${SECRET}</html>` }));
      const dialog = await submitLeadForm(page, c);
      await expect(dialog.getByRole("alert")).toHaveText(errors.server);
      expect(await page.locator("body").innerText()).not.toMatch(/hunter2|Traceback|secret\.py/);
    });

    test("no connection while saving: the network message", async ({ page }) => {
      await open(page, "/leads");
      await answerLeadCreate(page, (route) => route.abort("failed"));
      const dialog = await submitLeadForm(page, c);
      await expect(dialog.getByRole("alert")).toHaveText(errors.network);
    });
  });

  test.describe(`${language}: toast and page-level errors`, () => {
    test.use({ uiLanguage: language, storageState: authState("manager"), viewport: { width: 1280, height: 800 } });

    test.describe("as a salesperson (the demo tasks are assigned to the salesperson)", () => {
      test.use({ storageState: authState("sales") });
      test("a refused action shows a toast in the language (403 on completing a task)", async ({ page }) => {
        await open(page, "/tasks");
        await page.route(/\/api\/tasks\/\d+\/(complete|reopen)\/$/, (route) => json(route, 403, { detail: "You do not have permission to perform this action." }));
        await page.getByRole("button", { name: c.tasks.markTaskComplete }).first().click();
        await expect(page.getByRole("status").filter({ hasText: errors.forbidden })).toBeVisible();
      });
    });

    test("a page that cannot load its list: no connection, a server error, too many requests", async ({ page }) => {
      let mode: number | "abort" = "abort";
      await page.route(/\/api\/leads\/(\?.*)?$/, (route) => {
        if (route.request().method() !== "GET") return route.continue();
        if (mode === "abort") return route.abort("failed");
        if (mode === 429) return json(route, 429, { detail: "Request was throttled. Expected available in 5 seconds." });
        return route.fulfill({ status: 500, contentType: "text/html", body: `<html>${SECRET}</html>` });
      });
      const cases: [number | "abort", string][] = [["abort", errors.network], [500, errors.server], [429, language === "en" ? "Too many requests. Please try again in 5 seconds." : "عدد الطلبات كبير جدًا. يُرجى المحاولة بعد 5 ثوانٍ."]];
      for (const [next, expected] of cases) {
        mode = next;
        await page.goto("/leads");
        await expect(page.getByText(expected)).toBeVisible({ timeout: 20000 });
        await expect(page.getByText(/hunter2|Traceback/)).toHaveCount(0);
      }
    });

    test("a lead that does not exist (the real backend answers 404): the not-found message, not the technical text", async ({ page }) => {
      await page.goto("/leads/99999999");
      await expect(page.getByText(errors.notFound)).toBeVisible();
      await expect(page.getByText(/matches the given query/)).toHaveCount(0);
    });
  });
}
