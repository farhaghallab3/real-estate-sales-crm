import { expect, test as base } from "@playwright/test";

import type { SupportedLanguage } from "../src/i18n/config";

import { STRINGS, type UiStrings } from "./strings";
import { languageCookieFor, requireSupportedLanguage, uiLanguageFromEnv } from "./ui-language";

/** Every test runs behind a guard: the browser may only talk to the local test stack. A request to any other host is blocked and fails the
 *  test, so a misconfigured build (for example one that points at a real API) can never send traffic, credentials or test data anywhere else.
 *
 *  `uiLanguage` is the interface language of the run (option; default from E2E_UI_LANGUAGE, else English; an unsupported value fails explicitly).
 *  The `crm_lang` cookie is set before any navigation, and `ui` holds the texts the tests look for in that language (see strings.ts). */
export const test = base.extend<{ localOnly: void; languageCookie: void; uiLanguage: SupportedLanguage; ui: UiStrings }>({
  uiLanguage: [uiLanguageFromEnv(process.env), { option: true }],
  ui: [
    async ({ uiLanguage }, use) => {
      await use(STRINGS[requireSupportedLanguage(uiLanguage)]);
    },
    { scope: "test" },
  ],
  languageCookie: [
    async ({ context, baseURL, uiLanguage }, use) => {
      await context.addCookies([languageCookieFor(uiLanguage, baseURL ?? "http://127.0.0.1")]);
      await use();
    },
    { auto: true },
  ],
  localOnly: [
    async ({ context, baseURL }, use) => {
      const allowed = new URL(baseURL ?? "http://127.0.0.1").origin;
      const blocked: string[] = [];
      await context.route(
        (url) => !/^(data|blob|about):/.test(url.href) && url.origin !== allowed,
        (route) => {
          blocked.push(route.request().url());
          return route.abort("blockedbyclient");
        },
      );
      await use();
      expect(blocked, "the page tried to reach a host outside the local test stack").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
