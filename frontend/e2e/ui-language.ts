import { DEFAULT, LANGUAGE_COOKIE, SUPPORTED, type SupportedLanguage } from "../src/i18n/config";
import { LANGUAGE_COOKIE_MAX_AGE, serializeLanguageCookie } from "../src/i18n/cookie";
import { isSupported } from "../src/i18n/resolve";

// The interface language of an E2E run (Phase 1.6). Pure: no Playwright import, so it is unit-tested with Vitest (src/i18n/e2e-ui-language.test.ts).

/** The environment variable that selects the language of a run. */
export const UI_LANGUAGE_ENV = "E2E_UI_LANGUAGE";

/** The language itself, or an explicit error: an unsupported value is never replaced by a default behind the tester's back. */
export function requireSupportedLanguage(value: unknown, source = "uiLanguage"): SupportedLanguage {
  if (!isSupported(value)) {
    throw new Error(`${source}: ${JSON.stringify(value)} is not a supported interface language (supported: ${SUPPORTED.join(", ")})`);
  }
  return value as SupportedLanguage;
}

/** `E2E_UI_LANGUAGE`: unset means English; any set value (even an empty one) must be exactly a supported language. */
export function uiLanguageFromEnv(env: Record<string, string | undefined>): SupportedLanguage {
  const raw = env[UI_LANGUAGE_ENV];
  return raw === undefined ? DEFAULT : requireSupportedLanguage(raw, UI_LANGUAGE_ENV);
}

/** The `crm_lang` cookie for Playwright's `context.addCookies`, checked against the application's own serializer so that the test cookie cannot drift from the cookie contract. */
export function languageCookieFor(language: unknown, baseURL: string) {
  const code = requireSupportedLanguage(language);
  const url = new URL(baseURL);
  if (serializeLanguageCookie(code, { https: url.protocol === "https:", production: false }) === null) throw new Error(`no cookie can be written for ${code}`);
  return { name: LANGUAGE_COOKIE, value: code, url: url.origin, sameSite: "Lax" as const, expires: Math.floor(Date.now() / 1000) + LANGUAGE_COOKIE_MAX_AGE };
}
