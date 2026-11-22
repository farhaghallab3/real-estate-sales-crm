import { describe, expect, it } from "vitest";

import { SUPPORTED } from "./config";
import { isSupported, negotiate, resolveLocale, type ResolveInput } from "./resolve";

// The whole matrix needs `ar` to be a supported language, which it is not in the app until Phase 4: tests pass it explicitly.
const ALL = ["en", "ar"] as const;

describe("resolveLocale: priority profile > cookie > company > browser > default (ADR-0001 2.2)", () => {
  const cases: [string, ResolveInput, string][] = [
    ["profile beats cookie, company and browser (ar)", { userLanguage: "ar", cookie: "en", companyLanguage: "en", acceptLanguage: "en" }, "ar"],
    ["profile beats cookie, company and browser (en)", { userLanguage: "en", cookie: "ar", companyLanguage: "ar", acceptLanguage: "ar" }, "en"],
    ["cookie beats company and browser (ar)", { userLanguage: null, cookie: "ar", companyLanguage: "en", acceptLanguage: "en" }, "ar"],
    ["cookie beats company and browser (en)", { userLanguage: undefined, cookie: "en", companyLanguage: "ar", acceptLanguage: "ar" }, "en"],
    ["company beats browser (ar)", { companyLanguage: "ar", acceptLanguage: "en" }, "ar"],
    ["company beats browser (en)", { companyLanguage: "en", acceptLanguage: "ar" }, "en"],
    ["browser decides when nothing else does (ar)", { acceptLanguage: "ar-EG,ar;q=0.9,en;q=0.8" }, "ar"],
    ["browser decides when nothing else does (en)", { acceptLanguage: "en-US,en;q=0.9" }, "en"],
    ["default when there is no information", {}, "en"],
    ["default when every field is null", { userLanguage: null, cookie: null, companyLanguage: null, acceptLanguage: null }, "en"],
    ["an unsupported profile language falls through to the cookie", { userLanguage: "fr", cookie: "ar" }, "ar"],
    ["unsupported profile and cookie fall through to the company", { userLanguage: "fr", cookie: "de", companyLanguage: "ar" }, "ar"],
    ["everything unsupported falls through to the browser", { userLanguage: "fr", cookie: "de", companyLanguage: "es", acceptLanguage: "ar" }, "ar"],
    ["everything unsupported and a browser we do not serve gives the default", { userLanguage: "fr", cookie: "de", companyLanguage: "es", acceptLanguage: "fr" }, "en"],
  ];
  it.each(cases)("%s", (_name, input, expected) => {
    expect(resolveLocale(input, ALL)).toBe(expected);
  });
});

describe("resolveLocale: untrusted values (tampered cookie, bad input) are ignored, never trusted or thrown on", () => {
  const bad: unknown[] = [
    "AR", // exact match only: no case folding
    " ar",
    "ar ",
    "ar-EG",
    "ar;en",
    "ar\n",
    "ar\u0000",
    "<script>alert(1)</script>",
    "x".repeat(10_000),
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "",
    0,
    true,
    {},
    [],
    ["ar"],
    Symbol.iterator,
    null,
    undefined,
  ];

  it.each(bad.map((v) => [typeof v === "symbol" ? "Symbol" : JSON.stringify(v)?.slice(0, 40) ?? String(v), v] as const))(
    "a tampered cookie %s falls through to the next source",
    (_label, value) => {
      expect(resolveLocale({ cookie: value, companyLanguage: "ar" }, ALL)).toBe("ar"); // ignored: the company language decides
      expect(resolveLocale({ cookie: value, companyLanguage: "en", acceptLanguage: "ar" }, ALL)).toBe("en");
      expect(resolveLocale({ cookie: value }, ALL)).toBe("en"); // nothing left: the default
    },
  );

  it.each(bad.map((v) => [typeof v === "symbol" ? "Symbol" : JSON.stringify(v)?.slice(0, 40) ?? String(v), v] as const))(
    "a bad profile language %s is ignored",
    (_label, value) => {
      expect(resolveLocale({ userLanguage: value, cookie: "ar" }, ALL)).toBe("ar");
    },
  );

  it("never returns anything that is not in the allow-list or the default", () => {
    for (const v of bad) for (const w of bad) {
      const out = resolveLocale({ userLanguage: v, cookie: w, companyLanguage: v, acceptLanguage: w }, ALL);
      expect(["en", "ar"]).toContain(out);
    }
  });
});

describe("resolveLocale: the application's own allow-list (English and Arabic since Phase 4)", () => {
  it("is English when nothing supported is asked for, and follows the supported languages otherwise, when `supported` is omitted", () => {
    expect(resolveLocale()).toBe("en");
    expect(resolveLocale({})).toBe("en");
    expect(resolveLocale({ cookie: "fr", companyLanguage: "de", acceptLanguage: "es" })).toBe("en");
    expect(resolveLocale({ userLanguage: "ar" })).toBe("ar");
    expect(resolveLocale({ cookie: "ar", companyLanguage: "en", acceptLanguage: "en" })).toBe("ar");
    expect(resolveLocale({ acceptLanguage: "ar,en;q=0.1" })).toBe("ar");
  });
  it("uses SUPPORTED as the default for the optional argument", () => {
    expect(resolveLocale({ cookie: "ar" })).toBe(resolveLocale({ cookie: "ar" }, SUPPORTED));
    expect(resolveLocale({ cookie: "en" })).toBe("en");
  });
  it("a narrower list narrows that call only: the list is a parameter of the call, not state", () => {
    expect(resolveLocale({ cookie: "ar" }, ["en"])).toBe("en");
    expect(resolveLocale({ cookie: "ar" }, ALL)).toBe("ar");
    expect(resolveLocale({ cookie: "ar" })).toBe("ar");
  });
});

describe("resolveLocale: purity", () => {
  it("does not mutate its inputs and is deterministic", () => {
    const input = Object.freeze({ userLanguage: null, cookie: "ar", companyLanguage: "en", acceptLanguage: "en" });
    const supported = Object.freeze(["en", "ar"]);
    const first = resolveLocale(input, supported);
    expect(resolveLocale(input, supported)).toBe(first);
    expect(first).toBe("ar");
    expect(supported).toEqual(["en", "ar"]);
  });
});

describe("isSupported", () => {
  it("matches exactly, and only strings", () => {
    expect(isSupported("en")).toBe(true);
    expect(isSupported("ar")).toBe(true);
    expect(isSupported("fr")).toBe(false);
    expect(isSupported("ar", ["en"])).toBe(false);
    expect(isSupported("ar", ALL)).toBe(true);
    expect(isSupported("AR", ALL)).toBe(false);
    expect(isSupported(["en"], ALL)).toBe(false);
    expect(isSupported(null, ALL)).toBe(false);
  });
});

describe("negotiate (Accept-Language)", () => {
  const cases: [string, unknown, string | null][] = [
    ["a plain language", "ar", "ar"],
    ["case is ignored", "AR-eg", "ar"],
    ["a region falls back to its language", "ar-SA", "ar"],
    ["a longer tag falls back step by step", "en-GB-oxendict", "en"],
    ["the browser's typical Arabic header", "ar-EG,ar;q=0.9,en;q=0.8", "ar"],
    ["the browser's typical English header", "en-US,en;q=0.9,ar;q=0.8", "en"],
    ["the highest q wins, not the first", "en;q=0.5,ar;q=0.9", "ar"],
    ["unsupported languages are skipped", "fr-FR,fr;q=0.9,en;q=0.8", "en"],
    ["a script subtag of an unsupported language is skipped", "zh-Hant-TW,ar;q=0.5", "ar"],
    ["nothing supported gives null", "fr", null],
    ["several unsupported give null", "fr,de;q=0.5", null],
    ["equal q keeps the header order (en first)", "en,ar", "en"],
    ["equal q keeps the header order (ar first)", "ar,en", "ar"],
    ["q=0 means not acceptable", "ar;q=0,en", "en"],
    ["only an excluded language gives null", "ar;q=0", null],
    ["an excluded language does not block the other", "en;q=0, ar;q=0.1", "ar"],
    ["a wildcard picks the first supported language", "*", "en"],
    ["a wildcard with lower q loses to an explicit match", "*;q=0.5,ar;q=0.9", "ar"],
    ["a wildcard skips an excluded language", "en;q=0,*", "ar"],
    ["spaces around separators are tolerated", "ar ; q = 0.8 , en ; q = 0.7", "ar"],
    ["empty entries are tolerated", ",,,ar,,,", "ar"],
    ["a q above 1 is invalid and the entry is ignored", "ar;q=1.5,en;q=0.2", "en"],
    ["a non-numeric q is invalid and the entry is ignored", "ar;q=abc,en", "en"],
    ["a q with four decimals is invalid and the entry is ignored", "ar;q=0.1234,en", "en"],
    ["a q without a leading digit is invalid and the entry is ignored", "ar;q=.5,en", "en"],
    ["an underscore tag is malformed and ignored", "ar_EG", null],
    ["a malformed entry does not hide a good one", "ar_EG,en;q=0.4", "en"],
    ["an empty header gives null", "", null],
    ["a blank header gives null", "   ", null],
    ["a header cut by the length limit does not see what comes after it", "fr,".repeat(400) + "ar", null],
    ["a header with more entries than the limit does not see the extra ones", Array(50).fill("fr").join(",") + ",ar", null],
    ["a very long single tag is not a language", "x".repeat(5000), null],
    ["a number is not a header", 123, null],
    ["null is not a header", null, null],
    ["undefined is not a header", undefined, null],
    ["an object is not a header", {}, null],
  ];
  it.each(cases)("%s", (_name, header, expected) => {
    expect(negotiate(header, ALL)).toBe(expected);
  });

  it("serves what the allow-list contains", () => {
    expect(negotiate("ar,en;q=0.5")).toBe("ar");
    expect(negotiate("fr")).toBeNull();
    expect(negotiate("en-US")).toBe("en");
    expect(negotiate("ar,en;q=0.5", ["en"])).toBe("en");
    expect(negotiate("ar", ["en"])).toBeNull();
  });
});
