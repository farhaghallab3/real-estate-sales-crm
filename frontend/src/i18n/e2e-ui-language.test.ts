import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LANGUAGE_COOKIE, SUPPORTED } from "./config";
import { LANGUAGE_COOKIE_MAX_AGE, readLanguageCookie } from "./cookie";
import { EXTERNAL_TEXT, STRINGS } from "../../e2e/strings";
import { UI_LANGUAGE_ENV, languageCookieFor, requireSupportedLanguage, uiLanguageFromEnv } from "../../e2e/ui-language";

// Phase 1.6: the interface-language option of the E2E suite (e2e/ui-language.ts, e2e/fixtures.ts) and the temporary English strings table (e2e/strings.ts).
// Pure checks only: the Playwright suite itself is not run here.
const e2e = (file: string) => readFileSync(new URL(`../../e2e/${file}`, import.meta.url), "utf8");

describe("E2E_UI_LANGUAGE", () => {
  it("is English when unset", () => {
    expect(UI_LANGUAGE_ENV).toBe("E2E_UI_LANGUAGE");
    expect(uiLanguageFromEnv({})).toBe("en");
  });

  it("accepts en explicitly", () => {
    expect(uiLanguageFromEnv({ E2E_UI_LANGUAGE: "en" })).toBe("en");
    expect(requireSupportedLanguage("en")).toBe("en");
  });

  it.each(["ar-EG", "fr", "EN", "En", "en ", " en", "", "english", "en;ar", "__proto__"])("rejects %j explicitly instead of falling back to English", (value) => {
    expect(() => uiLanguageFromEnv({ E2E_UI_LANGUAGE: value })).toThrow(/E2E_UI_LANGUAGE: .* is not a supported interface language \(supported: en, ar\)/);
    expect(() => requireSupportedLanguage(value)).toThrow(/not a supported interface language/);
  });

  it.each([null, undefined, 1, {}, ["en"]])("rejects the non-string %j", (value) => {
    expect(() => requireSupportedLanguage(value)).toThrow(/not a supported interface language/);
  });

  it("only the application's own allow-list decides (English and Arabic since Phase 4)", () => {
    expect([...SUPPORTED]).toEqual(["en", "ar"]);
    expect(requireSupportedLanguage("ar")).toBe("ar");
  });
});

describe("the crm_lang cookie of a run", () => {
  it("follows the cookie contract: name, SameSite=Lax, one year, scoped to the origin", () => {
    const now = Math.floor(Date.now() / 1000);
    const cookie = languageCookieFor("en", "http://127.0.0.1:13100");
    expect(cookie).toMatchObject({ name: LANGUAGE_COOKIE, value: "en", url: "http://127.0.0.1:13100", sameSite: "Lax" });
    expect(cookie.expires).toBeGreaterThanOrEqual(now + LANGUAGE_COOKIE_MAX_AGE - 5);
    expect(cookie.expires).toBeLessThanOrEqual(now + LANGUAGE_COOKIE_MAX_AGE + 5);
  });

  it("is a cookie the application itself reads back as the same language", () => {
    const cookie = languageCookieFor("en", "http://127.0.0.1:13100");
    expect(readLanguageCookie(`${cookie.name}=${cookie.value}`)).toBe("en");
  });

  it.each(["fr", "EN", ""])("refuses to build a cookie for %j", (value) => {
    expect(() => languageCookieFor(value, "http://127.0.0.1:13100")).toThrow(/not a supported interface language/);
  });
});

describe("the temporary strings table (e2e/strings.ts)", () => {
  it("has an entry for every supported language, and every text is filled in", () => {
    expect(Object.keys(STRINGS).sort()).toEqual([...SUPPORTED].sort());
    for (const [language, strings] of Object.entries(STRINGS)) {
      for (const [key, value] of Object.entries(strings)) {
        const text = value instanceof RegExp ? value.source : value;
        expect(text.length, `${language}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("reads every text from the real catalogues and is typed against SupportedLanguage", () => {
    const text = e2e("strings.ts");
    expect(text).toMatch(/READ FROM THE REAL CATALOGUES/);
    expect(text).toContain("messages/ar.json");
    expect(text).toMatch(/Record<SupportedLanguage, UiStrings>/);
  });

  it("keeps the external exceptions apart: Next.js's own error page is not an application string", () => {
    expect("This page could not be found").toMatch(EXTERNAL_TEXT.nextErrorPage);
    expect(e2e("strings.ts")).toMatch(/EXTERNAL/);
    expect(Object.keys(STRINGS.en)).not.toContain("nextErrorPage");
  });

  it("the suite does not use the translation functions (its table is temporary: it will read the catalogue, see strings.ts)", () => {
    for (const file of ["strings.ts", "ui-language.ts", "fixtures.ts"]) {
      const code = e2e(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // code only: the comments say that nothing calls them
      expect(code, file).not.toMatch(/useTranslations|getTranslations/);
    }
  });
});

describe("the fixture and the specs", () => {
  it("fixtures.ts sets crm_lang before navigation (automatic fixture), validates the language and leaves Playwright's own locale alone", () => {
    const text = e2e("fixtures.ts");
    expect(text).toMatch(/uiLanguage: \[uiLanguageFromEnv\(process\.env\), \{ option: true \}\]/);
    expect(text).toMatch(/languageCookie: \[[\s\S]*?\{ auto: true \}/);
    expect(text).toMatch(/context\.addCookies\(\[languageCookieFor\(uiLanguage/);
    expect(text).toMatch(/requireSupportedLanguage\(uiLanguage\)/);
    expect(text).not.toMatch(/\blocale\s*:/);
    expect(readFileSync(new URL("../../playwright.config.ts", import.meta.url), "utf8")).not.toMatch(/\blocale\s*:/); // Playwright's own `locale` option is not set (the word appears only in the name "pseudo-locale")
  });

  it("the migrated specs take their texts from the table and use no positional selector", () => {
    for (const file of ["navigation.spec.ts", "company-settings.spec.ts"]) {
      const text = e2e(file);
      expect(text, file).not.toMatch(/\.first\(\)|\.nth\(|\.last\(\)/);
      expect(text, file).not.toMatch(/getBy(Role|Label|Text)\([^)]*(name: )?"[A-Z][A-Za-z ]+"/); // no literal English name or text in a locator
    }
    expect(e2e("smoke.spec.ts")).toMatch(/EXTERNAL_TEXT\.nextErrorPage/);
  });

  it("the i18n-shell spec keeps its coverage (six tests) and a cookie outside the allow-list is still set there", () => {
    const text = e2e("i18n-shell.spec.ts");
    expect((text.match(/^\s*test\(/gm) ?? []).length).toBe(6);
    expect(text).toContain('value: "fr"');
  });
});
