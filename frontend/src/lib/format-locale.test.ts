import { describe, expect, it } from "vitest";

import { formattingLocale, type NumberingSystem } from "./format-locale";

// Test amount (ADR-0001 2.4). The expected output below was generated with Node 24.13 (ICU 77.1, CLDR 47) and checked identical on Node 22.23.5
// (ICU 78.3, CLDR 48) for every row of the table; the one known difference between those two runtimes is a leading bidi mark in the compact format.
const AMOUNT = 1234567.891;

// Only two kinds of difference are tolerated when whole strings are compared, because they are layout, not content:
// bidi control marks (LRM, RLM, ALM) and the no-break / narrow no-break space. Digits, separators, currency and wording are never normalized.
const normalize = (s: string) => s.replace(/[‎‏؜]/g, "").replace(/[  ]/g, " ");

// The seven currencies of the Arabic MVP (backend CURRENCIES): region of the company, decimals, and what each language shows for the currency.
const CURRENCIES = [
  { code: "EGP", locale: "ar-EG", region: "EG", decimals: 2, ar: "ج.م." },
  { code: "SAR", locale: "ar-SA", region: "SA", decimals: 2, ar: "ر.س." },
  { code: "AED", locale: "ar-AE", region: "AE", decimals: 2, ar: "د.إ." },
  { code: "QAR", locale: "ar-QA", region: "QA", decimals: 2, ar: "ر.ق." },
  { code: "KWD", locale: "ar-KW", region: "KW", decimals: 3, ar: "د.ك." },
  { code: "BHD", locale: "ar-BH", region: "BH", decimals: 3, ar: "د.ب." },
  { code: "OMR", locale: "ar-OM", region: "OM", decimals: 3, ar: "ر.ع." },
] as const;

const format = (locale: Intl.Locale, currency: string, options: Intl.NumberFormatOptions = {}) =>
  new Intl.NumberFormat(locale, { style: "currency", currency, ...options });

describe("formattingLocale: derivation (ADR-0001 2.4)", () => {
  const cases: [string, string, string | null | undefined, string][] = [
    ["English UI in an Egyptian company", "en", "ar-EG", "en-EG-u-ca-gregory-nu-latn"],
    ["Arabic UI in an Egyptian company", "ar", "ar-EG", "ar-EG-u-ca-gregory-nu-latn"],
    ["Arabic UI in a Saudi company", "ar", "ar-SA", "ar-SA-u-ca-gregory-nu-latn"],
    ["Arabic UI in an Emirati company", "ar", "ar-AE", "ar-AE-u-ca-gregory-nu-latn"],
    ["English UI in an Emirati company", "en", "ar-AE", "en-AE-u-ca-gregory-nu-latn"],
    ["the UI language and the company language are independent", "ar", "en-US", "ar-US-u-ca-gregory-nu-latn"],
    ["a UI language with a region keeps the language only", "en-GB", "ar-EG", "en-EG-u-ca-gregory-nu-latn"],
    ["the language is case-insensitive", "AR", "ar-EG", "ar-EG-u-ca-gregory-nu-latn"],
    ["a company locale without a region gives no region", "en", "ar", "en-u-ca-gregory-nu-latn"],
    ["no company locale gives no region", "en", undefined, "en-u-ca-gregory-nu-latn"],
    ["null company locale gives no region", "ar", null, "ar-u-ca-gregory-nu-latn"],
    ["an empty company locale gives no region", "en", "", "en-u-ca-gregory-nu-latn"],
    ["an invalid company locale gives no region", "en", "not a locale!!", "en-u-ca-gregory-nu-latn"],
    ["an invalid UI language becomes English and keeps the region", "!!", "ar-EG", "en-EG-u-ca-gregory-nu-latn"],
    ["an empty UI language becomes English and keeps the region", "", "ar-SA", "en-SA-u-ca-gregory-nu-latn"],
  ];
  it.each(cases)("%s", (_name, language, company, expected) => {
    expect(formattingLocale(language, company).toString()).toBe(expected);
  });

  it("always uses Latin digits by default and the Gregorian calendar", () => {
    for (const lang of ["en", "ar"]) for (const c of CURRENCIES) {
      const l = formattingLocale(lang, c.locale);
      expect(l.numberingSystem).toBe("latn");
      expect(l.calendar).toBe("gregory");
      expect(l.region).toBe(c.region);
      expect(l.language).toBe(lang);
    }
  });

  it("takes the numbering system from the company setting", () => {
    expect(formattingLocale("ar", "ar-EG", "arab").toString()).toBe("ar-EG-u-ca-gregory-nu-arab");
    expect(formattingLocale("en", "ar-EG", "arab").numberingSystem).toBe("arab");
  });

  it("never throws: an invalid numbering system becomes latn", () => {
    expect(formattingLocale("ar", "ar-EG", "not-a-system" as NumberingSystem).toString()).toBe("ar-EG-u-ca-gregory-nu-latn");
  });

  it("never throws on non-string input", () => {
    expect(formattingLocale(undefined as unknown as string, 123 as unknown as string).toString()).toBe("en-u-ca-gregory-nu-latn");
  });
});

describe("formattingLocale: the seven currencies x (en, ar) x latn", () => {
  const rows = CURRENCIES.flatMap((c) => (["en", "ar"] as const).map((lang) => [c, lang] as const));

  it.each(rows)("$code in %s: derived locale, Latin digits, decimals of the currency", (c, lang) => {
    const locale = formattingLocale(lang, c.locale);
    expect(locale.toString()).toBe(`${lang}-${c.region}-u-ca-gregory-nu-latn`);
    const resolved = format(locale, c.code).resolvedOptions();
    expect(resolved.numberingSystem).toBe("latn");
    expect(resolved.currency).toBe(c.code);
    expect(resolved.minimumFractionDigits).toBe(c.decimals); // 3 for KWD, BHD, OMR; 2 for the others: a rule of the currency
    expect(resolved.maximumFractionDigits).toBe(c.decimals);
  });

  it.each(rows)("$code in %s: formatToParts has Latin digits, the usual separators and the right currency text", (c, lang) => {
    const parts = format(formattingLocale(lang, c.locale), c.code).formatToParts(AMOUNT);
    const text = (type: string) => parts.filter((p) => p.type === type).map((p) => normalize(p.value));
    expect(text("integer")).toEqual(["1", "234", "567"]);
    expect(text("group")).toEqual([",", ","]);
    expect(text("decimal")).toEqual(["."]);
    expect(text("fraction")).toEqual([c.decimals === 3 ? "891" : "89"]);
    expect(text("currency")).toEqual([lang === "en" ? c.code : c.ar]);
    for (const p of parts) if (p.type === "integer" || p.type === "fraction") expect(p.value).toMatch(/^[0-9]+$/); // never Arabic-Indic digits
  });

  it.each(rows)("$code in %s: the full text, after removing only bidi marks and no-break spaces", (c, lang) => {
    const digits = c.decimals === 3 ? "1,234,567.891" : "1,234,567.89";
    const expected = lang === "en" ? `${c.code} ${digits}` : `${digits} ${c.ar}`;
    expect(normalize(format(formattingLocale(lang, c.locale), c.code).format(AMOUNT))).toBe(expected);
  });
});

describe("formattingLocale: language, region and currency are separate things", () => {
  it("the currency of the company decides the decimals, not the region of the locale", () => {
    const l = formattingLocale("en", "ar-EG"); // Egyptian region, but a Kuwaiti dinar company
    const r = format(l, "KWD").resolvedOptions();
    expect(l.toString()).toBe("en-EG-u-ca-gregory-nu-latn");
    expect(r.minimumFractionDigits).toBe(3);
    expect(format(l, "KWD").formatToParts(AMOUNT).find((p) => p.type === "currency")?.value).toBe("KWD");
  });

  it("the region comes from the company, the words from the user's language", () => {
    const en = format(formattingLocale("en", "ar-SA"), "SAR").format(AMOUNT);
    const ar = format(formattingLocale("ar", "ar-SA"), "SAR").format(AMOUNT);
    expect(normalize(en)).toBe("SAR 1,234,567.89");
    expect(normalize(ar)).toBe("1,234,567.89 ر.س.");
  });

  it("two users of one company (en and ar) read the same digits and separators", () => {
    const digits = (lang: string) =>
      format(formattingLocale(lang, "ar-EG"), "EGP")
        .formatToParts(AMOUNT)
        .filter((p) => ["integer", "group", "decimal", "fraction"].includes(p.type))
        .map((p) => p.value)
        .join("");
    expect(digits("en")).toBe("1,234,567.89");
    expect(digits("ar")).toBe(digits("en"));
  });
});

describe("formattingLocale: other ADR-0001 2.4 outputs", () => {
  it("Arabic-Indic digits (the later company option): the digits change, the stored number does not", () => {
    const l = formattingLocale("ar", "ar-EG", "arab");
    const nf = format(l, "EGP");
    expect(nf.resolvedOptions().numberingSystem).toBe("arab");
    const parts = nf.formatToParts(AMOUNT);
    expect(parts.filter((p) => p.type === "integer").map((p) => p.value)).toEqual(["١", "٢٣٤", "٥٦٧"]);
    expect(parts.filter((p) => p.type === "fraction").map((p) => p.value)).toEqual(["٨٩"]);
    expect(normalize(nf.format(AMOUNT))).toBe("١٬٢٣٤٬٥٦٧٫٨٩ ج.م.");
    expect(AMOUNT).toBe(1234567.891); // the number itself is untouched
  });

  it("compact notation in Arabic (the semantic parts; a leading bidi mark that appears with newer ICU is not content)", () => {
    const nf = format(formattingLocale("ar", "ar-EG"), "EGP", { notation: "compact", maximumFractionDigits: 1 });
    const parts = nf.formatToParts(AMOUNT);
    const text = (type: string) => parts.filter((p) => p.type === type).map((p) => normalize(p.value));
    expect(text("integer")).toEqual(["1"]);
    expect(text("decimal")).toEqual(["."]);
    expect(text("fraction")).toEqual(["2"]);
    expect(text("compact")).toEqual(["مليون"]);
    expect(text("currency")).toEqual(["ج.م."]);
    expect(normalize(nf.format(AMOUNT))).toBe("1.2 مليون ج.م.");
  });
});
