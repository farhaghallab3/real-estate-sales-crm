import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LANGUAGE_COOKIE_MAX_AGE, readLanguageCookie, serializeLanguageCookie } from "./cookie";

const HTTP = { https: false, production: false };
// The code without its comments (the doc comments name document.cookie on purpose).
const source = readFileSync(new URL("./cookie.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("serializeLanguageCookie", () => {
  it("writes exactly one cookie with Path=/, one year and SameSite=Lax, and no Secure over plain HTTP outside production", () => {
    expect(serializeLanguageCookie("en", HTTP)).toBe("crm_lang=en; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(LANGUAGE_COOKIE_MAX_AGE).toBe(365 * 24 * 60 * 60);
  });

  it.each([
    [{ https: true, production: false }, true],
    [{ https: false, production: true }, true],
    [{ https: true, production: true }, true],
    [{ https: false, production: false }, false],
  ])("Secure for context %j is %s", (context, secure) => {
    expect(serializeLanguageCookie("en", context)?.split("; ").includes("Secure")).toBe(secure);
  });

  it("is never HttpOnly (the browser writes it) and carries no Domain or Expires", () => {
    const cookie = serializeLanguageCookie("en", { https: true, production: true }) ?? "";
    expect(cookie).not.toMatch(/HttpOnly|Domain|Expires/i);
  });

  it("names only crm_lang, so assigning it to document.cookie cannot overwrite another cookie", () => {
    const names = (serializeLanguageCookie("en", HTTP) ?? "").split("; ").map((p) => p.split("=")[0]);
    expect(names.filter((n) => !["Path", "Max-Age", "SameSite", "Secure"].includes(n))).toEqual(["crm_lang"]);
  });

  it.each(["ar-EG", "fr", "EN", "en ", " en", "", "en; Path=/evil", "en\r\nSet-Cookie: x=1", "__proto__", null, undefined, 1, {}, ["en"]])(
    "stores nothing for the unsupported value %j",
    (value) => {
      expect(serializeLanguageCookie(value, HTTP)).toBeNull();
    },
  );

  it("accepts Arabic with the application's allow-list and follows an explicit narrower one", () => {
    expect(serializeLanguageCookie("ar", HTTP, ["en", "ar"])).toBe("crm_lang=ar; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(serializeLanguageCookie("ar", HTTP)).toBe("crm_lang=ar; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(serializeLanguageCookie("ar", HTTP, ["en"])).toBeNull();
  });
});

describe("readLanguageCookie", () => {
  it("reads the saved language among unrelated cookies", () => {
    expect(readLanguageCookie("crm_lang=en")).toBe("en");
    expect(readLanguageCookie("a=1; crm_lang=en; b=2")).toBe("en");
    expect(readLanguageCookie("a=1;crm_lang=en;b=2")).toBe("en");
    expect(readLanguageCookie("  crm_lang = en  ")).toBe("en");
  });

  it.each(["", "a=1; b=2", "crm_lang", "crm_lang=", "crm_lang=fr", "crm_lang=EN", "crm_lang=en;x", "crm_lang=%65n", "crm_lang=en en"])(
    "returns null for %j (missing, empty, tampered or unsupported)",
    (header) => {
      // `crm_lang=en;x` still holds a valid first pair: it is the one case here that reads as en
      expect(readLanguageCookie(header)).toBe(header === "crm_lang=en;x" ? "en" : null);
    },
  );

  it("ignores cookies whose name only contains or starts with crm_lang", () => {
    expect(readLanguageCookie("xcrm_lang=en; crm_lang2=en; crm_lang_old=en; CRM_LANG=en")).toBeNull();
  });

  it("uses the first crm_lang cookie when there are two, as a browser does", () => {
    expect(readLanguageCookie("crm_lang=fr; crm_lang=en")).toBeNull();
    expect(readLanguageCookie("crm_lang=en; crm_lang=fr")).toBe("en");
  });

  it.each([null, undefined, 0, {}, ["crm_lang=en"]])("returns null for the non-string %j", (value) => {
    expect(readLanguageCookie(value)).toBeNull();
  });

  it("round-trips with the serializer and honours an explicit allow-list", () => {
    const cookie = serializeLanguageCookie("ar", HTTP, ["en", "ar"]) ?? "";
    expect(readLanguageCookie(cookie, ["en", "ar"])).toBe("ar");
    expect(readLanguageCookie(cookie)).toBe("ar");
    expect(readLanguageCookie(cookie, ["en"])).toBeNull();
  });
});

describe("cookie.ts is pure", () => {
  it("touches no browser global and no environment variable", () => {
    expect(source).not.toMatch(/\bwindow\b|\bdocument\b|\blocation\b|process\.env|\bnavigator\b/);
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });
});
