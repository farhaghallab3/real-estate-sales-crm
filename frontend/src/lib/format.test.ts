import { readFileSync } from "node:fs";
import path from "node:path";

import { format, formatDistanceToNowStrict, isThisYear, isToday, isTomorrow, isYesterday, parseISO } from "date-fns";
import { createTranslator } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeFormatters, type Translate } from "./format";
import { DEFAULT_WEEK, weekSettingsFor } from "./week";

// Phase 5: the centralized formatters. English must keep its exact previous output (the reference below is the pre-Phase-5 implementation, copied), Arabic goes
// through Intl with Latin digits and the Gregorian calendar, and nothing here may change a value: formatting is presentation only.
const ROOT = path.resolve(__dirname, "../..");
const catalogue = (name: string) => JSON.parse(readFileSync(path.join(ROOT, `messages/${name}.json`), "utf8")) as Record<string, unknown>;
const translator = (locale: "en" | "ar") => createTranslator({ locale, messages: catalogue(locale) as never }) as unknown as Translate;

const make = (language: "en" | "ar", companyLocale: string, currency_code: string, currencyDisplay?: "symbol" | "code") =>
  makeFormatters({ language, companyLocale, currency_code, currencyDisplay }, translator(language));

// ---- the pre-Phase-5 implementation, as the reference for English ------------------------------------------------------------------------------------
const old = {
  date: (iso: string) => {
    const d = parseISO(iso);
    return format(d, isThisYear(d) ? "MMM d" : "MMM d, yyyy");
  },
  time: (iso: string) => format(parseISO(iso), "h:mm a"),
  dateTime: (iso: string) => `${old.date(iso)}, ${old.time(iso)}`,
  when: (iso: string) => {
    const d = parseISO(iso);
    if (isToday(d)) return `Today, ${old.time(iso)}`;
    if (isTomorrow(d)) return `Tomorrow, ${old.time(iso)}`;
    if (isYesterday(d)) return `Yesterday, ${old.time(iso)}`;
    return old.dateTime(iso);
  },
  relative: (iso: string) => {
    const d = parseISO(iso);
    return `${formatDistanceToNowStrict(d)} ${d.getTime() > Date.now() ? "from now" : "ago"}`;
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0)); // 15 June 2026, 12:00 local
});
afterEach(() => vi.useRealTimers());

const local = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo, d, h, mi, s).toISOString();

describe("English keeps its exact previous output", () => {
  const f = make("en", "en-US", "USD");
  const isos = [
    local(2026, 2, 4, 14, 30), local(2026, 0, 1, 0, 5), local(2025, 11, 31, 23, 59), local(2024, 6, 9, 9, 0), local(2026, 5, 15, 8, 15), local(2026, 5, 16, 9, 0), local(2026, 5, 14, 17, 45),
    "2026-03-04", "2026-03-04T14:30:00", "2026-03-04T14:30:00Z", "2020-02-29T12:00:00+03:00",
  ];

  it.each(isos)("dates and times of %s", (iso) => {
    expect(f.formatDate(iso)).toBe(old.date(iso));
    expect(f.formatTime(iso)).toBe(old.time(iso));
    expect(f.formatDateTime(iso)).toBe(old.dateTime(iso));
    expect(f.formatWhen(iso)).toBe(old.when(iso));
  });

  it("relative time, 'ago' and 'from now', for offsets from seconds to years", () => {
    const now = Date.now();
    const offsets = [1, 5, 59, 60, 90, 600, 3599, 3600, 7200, 86399, 86400, 86400 * 2, 86400 * 29, 86400 * 30, 86400 * 45, 86400 * 365, 86400 * 800].flatMap((s) => [-s, s]);
    for (const s of offsets) {
      const iso = new Date(now + s * 1000).toISOString();
      expect(f.relative(iso), String(s)).toBe(old.relative(iso));
    }
    expect(f.relative(new Date(now - 5 * 86400000).toISOString())).toBe("5 days ago");
    expect(f.relative(new Date(now + 3 * 3600000).toISOString())).toBe("3 hours from now");
  });

  it("the week header patterns and weekday names", () => {
    const d = new Date(2026, 2, 4);
    expect(f.dayMonth(d)).toBe("Mar 4");
    expect(f.dayMonthYear(d)).toBe("Mar 4, 2026");
    expect(f.weekday(d)).toBe("Wed");
  });

  it("amounts of the default company (en-US, USD) are what the previous formatter produced", () => {
    const base = { style: "currency" as const, currency: "USD", numberingSystem: "latn" };
    expect(f.money(1234567.5)).toBe(new Intl.NumberFormat("en-US", { ...base, maximumFractionDigits: 0 }).format(1234567.5));
    expect(f.money2("1234.5")).toBe(new Intl.NumberFormat("en-US", { ...base, minimumFractionDigits: 2 }).format(1234.5));
    expect(f.moneyCompact(1234567)).toBe(new Intl.NumberFormat("en-US", { ...base, notation: "compact", maximumFractionDigits: 1 }).format(1234567));
    expect(f.money(1234567.5)).toBe("$1,234,568");
    expect(f.money2("1234.5")).toBe("$1,234.50");
    expect(f.moneyCompact(1234567)).toBe("$1.2M");
  });

  it("empty and invalid values show a dash and never throw", () => {
    for (const v of [null, undefined, "", "abc", NaN, Infinity]) {
      expect(f.money(v as never)).toBe("—");
      expect(f.money2(v as never)).toBe("—");
      expect(f.moneyCompact(v as never)).toBe("—");
      expect(f.number(v as never)).toBe("—");
    }
    for (const v of [null, undefined, ""]) {
      expect(f.formatDate(v)).toBe("—");
      expect(f.formatTime(v)).toBe("—");
      expect(f.formatDateTime(v)).toBe("—");
      expect(f.formatWhen(v)).toBe("—");
      expect(f.relative(v)).toBe("—");
    }
  });
});

describe("currencies: EGP and SAR from the company setting, in both languages (Latin digits)", () => {
  // [language, company locale, currency, money(1234567.5), money2(1234.5), moneyCompact(1234567)]
  const rows: [string, string, string, string, string, string][] = [
    ["en", "en-EG", "EGP", "EGP 1,234,568", "EGP 1,234.50", "EGP 1.2M"],
    ["en", "ar-EG", "EGP", "EGP 1,234,568", "EGP 1,234.50", "EGP 1.2M"],
    ["en", "en-SA", "SAR", "SAR 1,234,568", "SAR 1,234.50", "SAR 1.2M"],
    ["ar", "ar-EG", "EGP", "‏1,234,568 ج.م.‏", "‏1,234.50 ج.م.‏", "1.2 مليون ج.م.‏"],
    ["ar", "ar-SA", "SAR", "‏1,234,568 ر.س.‏", "‏1,234.50 ر.س.‏", "1.2 مليون ر.س.‏"],
    ["ar", "en-US", "USD", "‏1,234,568 US$", "‏1,234.50 US$", "1.2 مليون US$"],
  ];
  it.each(rows)("%s, company %s, %s", (language, companyLocale, currency, whole, cents, compact) => {
    const f = make(language as "en" | "ar", companyLocale, currency);
    // the ICU data of the runtime may add or drop a bidi mark: compare without them, and require Latin digits
    const bare = (s: string) => s.replace(/[‎‏؜]/g, "").replace(/\s/g, " "); // also the no-break space the ICU data puts before or after the symbol
    expect(bare(f.money(1234567.5))).toBe(bare(whole));
    expect(bare(f.money2(1234.5))).toBe(bare(cents));
    expect(bare(f.moneyCompact(1234567))).toBe(bare(compact));
    expect(f.money(1234567.5)).not.toMatch(/[٠-٩]/);
  });

  it("the three-decimal currencies keep their three decimals (KWD, BHD, OMR)", () => {
    for (const code of ["KWD", "BHD", "OMR"]) expect(make("en", "en-KW", code).money2(1234.5678)).toMatch(/1,234\.568$/);
  });

  it("the currency can be shown as its ISO code", () => {
    expect(make("en", "en-EG", "EGP", "code").money(100)).toMatch(/EGP/);
    expect(make("ar", "ar-SA", "SAR", "code").money(100)).toMatch(/SAR/);
  });

  it("an unknown currency or locale never crashes", () => {
    expect(() => make("en", "zz-ZZ", "XXXXX").money(1)).not.toThrow();
    expect(() => make("ar", "not a locale", "EGP").money2(1)).not.toThrow();
  });

  it("formatting does not change the number: the same input gives the same value back through the parser, and the input is not touched", () => {
    const f = make("ar", "ar-EG", "EGP");
    const amount = 1234567.891;
    const text = f.money2(amount);
    expect(amount).toBe(1234567.891);
    expect(Number((/\d[\d,]*\.\d+/.exec(text)?.[0] ?? "").replace(/,/g, ""))).toBeCloseTo(1234567.89, 2); // the digits are Latin: a number is recoverable from the text
  });
});

describe("Arabic dates and times (Latin digits, Gregorian calendar)", () => {
  const f = make("ar", "ar-EG", "EGP");
  const sa = make("ar", "ar-SA", "SAR");

  it("shows the day and the Arabic month name, with the year only when it is not the current year", () => {
    expect(f.formatDate("2026-03-04T14:30:00")).toBe("4 مارس");
    expect(f.formatDate("2025-03-04T14:30:00")).toMatch(/^4 مارس 2025/);
    expect(sa.formatDate("2026-03-04T14:30:00")).toBe("4 مارس");
  });

  it("times use the Arabic day-period marks (ص / م) and Latin digits", () => {
    expect(f.formatTime("2026-03-04T14:30:00")).toMatch(/^2:30\s*م$/);
    expect(f.formatTime("2026-03-04T09:05:00")).toMatch(/^9:05\s*ص$/);
  });

  it("date and time are joined by the catalogue message (with the Arabic comma)", () => {
    expect(f.formatDateTime("2026-03-04T14:30:00")).toMatch(/^4 مارس، 2:30\s*م$/);
  });

  it("today, tomorrow and yesterday", () => {
    expect(f.formatWhen(local(2026, 5, 15, 16, 0))).toMatch(/^اليوم، 4:00\s*م$/);
    expect(f.formatWhen(local(2026, 5, 16, 9, 30))).toMatch(/^غدًا، 9:30\s*ص$/);
    expect(f.formatWhen(local(2026, 5, 14, 9, 30))).toMatch(/^أمس، 9:30\s*ص$/);
  });

  it("the week header and the weekday names", () => {
    const d = new Date(2026, 2, 4);
    expect(f.dayMonth(d)).toBe("4 مارس");
    expect(f.dayMonthYear(d)).toBe("4 مارس 2026");
    expect(f.weekday(d)).toBe("الأربعاء");
  });

  it("no output contains Arabic-Indic digits", () => {
    for (const out of [f.formatDate("2025-12-31T23:59:00"), f.formatTime("2026-03-04T14:30:00"), f.formatWhen(local(2026, 5, 16, 9, 30)), f.relative(local(2026, 5, 10, 12, 0)), f.dayMonthYear(new Date(2026, 0, 1))]) {
      expect(out).not.toMatch(/[٠-٩۰-۹]/);
    }
  });
});

describe("Arabic relative time ('ago' and 'from now')", () => {
  const f = make("ar", "ar-EG", "EGP");
  const at = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

  it.each([
    [-2 * 86400, "قبل يومين"],
    [-5 * 86400, "قبل 5 أيام"],
    [-11 * 60, "قبل 11 دقيقة"],
    [-3 * 3600, "قبل 3 ساعات"],
    [3 * 3600, "خلال 3 ساعات"],
    [2 * 86400, "خلال يومين"],
  ])("offset %i seconds is %s", (seconds, expected) => {
    expect(f.relative(at(seconds))).toBe(expected);
  });
});

describe("week start and weekend (defaults from the company region)", () => {
  it("Egypt starts on Saturday, Saudi Arabia on Sunday, the UAE on Monday (CLDR week data)", () => {
    expect(weekSettingsFor("ar-EG").firstDay).toBe(6);
    expect(weekSettingsFor("en-EG").firstDay).toBe(6);
    expect(weekSettingsFor("ar-SA").firstDay).toBe(0);
    expect(weekSettingsFor("en-AE").firstDay).toBe(1);
    expect(weekSettingsFor("ar-EG").weekend).toEqual([5, 6]);
    expect(weekSettingsFor("ar-SA").weekend).toEqual([5, 6]);
    expect(weekSettingsFor("en-AE").weekend).toEqual([6, 0]);
  });

  it("every other region, and anything invalid, keeps the previous behaviour: Monday", () => {
    for (const locale of ["en-US", "en-GB", "de-DE", "fr", "", null, undefined, "zz-ZZ", "not a locale"]) expect(weekSettingsFor(locale as never), String(locale)).toEqual(DEFAULT_WEEK);
    expect(DEFAULT_WEEK.firstDay).toBe(1);
  });
});

describe("the formatters hold no shared state", () => {
  it("two formatter sets built one after the other do not influence each other", () => {
    const a = make("ar", "ar-EG", "EGP");
    const b = make("en", "en-US", "USD");
    expect(a.money(5)).toMatch(/ج\.م/);
    expect(b.money(5)).toBe("$5");
    expect(a.money(5)).toMatch(/ج\.م/);
  });
});
