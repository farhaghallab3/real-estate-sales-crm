import { readFileSync } from "node:fs";
import path from "node:path";

import { isLiteralElement, isPluralElement, isPoundElement, isSelectElement, isTagElement, parse } from "@formatjs/icu-messageformat-parser";
import type { MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

// Phase 4: the Arabic catalogue (messages/ar.json) against the English one. The compiler only checks the English keys (global.d.ts), so these tests cover what it
// cannot: the same keys, valid ICU, the same arguments and structure, no message left in English, no runtime failure when a message is formatted, the Arabic
// plural contract for any plural message added later, and the glossary rules that can be checked mechanically (docs/localization/GLOSSARY-AR-EN.md).
const ROOT = path.resolve(__dirname, "../..");
const read = (name: string) => JSON.parse(readFileSync(path.join(ROOT, `messages/${name}.json`), "utf8")) as Record<string, unknown>;
const en = read("en");
const ar = read("ar");

function entries(object: Record<string, unknown>, prefix = ""): [string, string][] {
  return Object.entries(object).flatMap(([key, value]) =>
    value !== null && typeof value === "object" ? entries(value as Record<string, unknown>, `${prefix}${key}.`) : [[`${prefix}${key}`, value as string] as [string, string]],
  );
}
const english = entries(en);
const arabic = entries(ar);
const arabicByKey = new Map(arabic);

/** The structure of a message without its words: argument names and kinds, plural/select branches, tags and the # marker. */
function shape(elements: MessageFormatElement[]): unknown[] {
  const out = elements.map((el): unknown => {
    if (isLiteralElement(el)) return "L";
    if (isTagElement(el)) return { tag: el.value, children: shape(el.children) };
    // a plural has the CLDR categories of its language (English: one, other; Arabic: six), so only its argument is compared, never its branches
    if (isPluralElement(el)) return { type: el.type, name: el.value };
    if (isSelectElement(el)) return { type: el.type, name: el.value, options: Object.fromEntries(Object.entries(el.options).map(([k, o]) => [k, shape(o.value)]).sort()) };
    if (isPoundElement(el)) return "#";
    return { type: el.type, name: el.value };
  });
  return out.filter((item, i) => !(item === "L" && out[i - 1] === "L"));
}
const args = (message: string) => [...new Set([...message.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1]))].sort();

/** Messages that are identical in both languages on purpose: none since Phase 5 moved the date patterns out of the catalogue. */
const SAME_AS_ENGLISH = new Set<string>();
const hasArabicLetters = (text: string) => /[؀-ۿ]/.test(text);

describe("the Arabic catalogue: same keys as English", () => {
  it("has exactly the same keys, in the same order, in the same namespaces", () => {
    expect(Object.keys(ar)).toEqual(Object.keys(en));
    expect(arabic.map(([key]) => key)).toEqual(english.map(([key]) => key));
    expect(arabic.length).toBe(english.length);
    expect(Object.keys(ar)).toHaveLength(19);
  });

  it("holds only non-empty strings", () => {
    for (const [key, value] of arabic) {
      expect(typeof value, key).toBe("string");
      expect(value.trim().length, key).toBeGreaterThan(0);
      expect(value, key).toBe(value.trim());
    }
  });

  it("every message is valid ICU", () => {
    for (const [key, value] of arabic) expect(() => parse(value), key).not.toThrow();
  });
});

describe("the Arabic catalogue: interpolation and structure", () => {
  it("keeps the same arguments as the English message (same names, same count), and no rich-text tag appears or disappears", () => {
    for (const [key, message] of english) {
      const twin = arabicByKey.get(key) ?? "";
      expect(args(twin), key).toEqual(args(message));
      expect(/<\/?\w+>/.test(twin), key).toBe(/<\/?\w+>/.test(message));
    }
  });

  it("keeps the same ICU structure (argument kinds, plural/select branches, tags)", () => {
    for (const [key, message] of english) {
      const strip = (s: unknown[]) => s.filter((x) => x !== "L");
      expect(strip(shape(parse(arabicByKey.get(key) ?? ""))), key).toEqual(strip(shape(parse(message))));
    }
  });

  it("formats every message without an error, with every argument filled in and no argument name left in the output", () => {
    const t = createTranslator({ locale: "ar", messages: ar as never }) as unknown as (key: string, values?: Record<string, string | number>) => string;
    for (const [key, message] of english) {
      const values = Object.fromEntries(args(message).map((name) => [name, 42]));
      const out = t(key, values);
      expect(out, key).not.toMatch(/\{\w+\}/);
      expect(out, key).not.toBe(key);
      for (const name of args(message)) expect(out, `${key} (${name})`).toContain("42");
    }
  });

  it("reads a missing key as a visible error, not a crash, and the English catalogue is the one the types follow", () => {
    const errors: string[] = [];
    const t = createTranslator({ locale: "ar", messages: ar as never, onError: (e) => errors.push(e.code) }) as unknown as (key: string) => string;
    expect(t("common.noSuchKey")).toBe("common.noSuchKey");
    expect(errors).toEqual(["MISSING_MESSAGE"]);
  });
});

describe("the Arabic catalogue: it is really Arabic", () => {
  it("no message is left in English (identical to the English text)", () => {
    for (const [key, message] of english) {
      if (SAME_AS_ENGLISH.has(key)) {
        expect(arabicByKey.get(key), key).toBe(message);
        continue;
      }
      expect(arabicByKey.get(key), key).not.toBe(message);
      expect(hasArabicLetters(arabicByKey.get(key) ?? ""), `${key} has Arabic letters`).toBe(true);
    }
  });

  it("uses Latin digits, Arabic punctuation only where the language needs it, and no exclamation marks (glossary section 6)", () => {
    for (const [key, value] of arabic) {
      expect(value, key).not.toMatch(/[٠-٩۰-۹]/); // no Arabic-Indic digits
      expect(value, key).not.toMatch(/[!！]/);
      expect(value, key).not.toMatch(/\?/); // the Arabic question mark is used, never the Latin one
      expect(value, key).not.toMatch(/\s{2,}/);
      expect(value, key).not.toMatch(/\.\.\./); // the single ellipsis character is used, as in English
    }
  });

  it("keeps product-level technical text as it is: file formats, units and the ellipsis character", () => {
    expect(arabicByKey.get("documents.pdfWordExcelImageOr")).toContain("PDF");
    expect(arabicByKey.get("documents.pdfWordExcelImageOr")).toContain("10 MB");
    expect(arabicByKey.get("settings.pngJpgOrWebpUp")).toMatch(/PNG.*JPG.*WEBP.*1 MB/);
    for (const [key, message] of english) if (message.endsWith("…")) expect(arabicByKey.get(key), key).toMatch(/…$/);
  });

  it("an enum entry is a short label: no sentence, no full stop", () => {
    for (const [key, value] of arabic.filter(([k]) => k.startsWith("enums."))) {
      expect(value, key).not.toMatch(/[.:؛،]/);
      expect(value.split(/\s+/).length, key).toBeLessThanOrEqual(4);
    }
  });
});

describe("the Arabic catalogue: glossary (docs/localization/GLOSSARY-AR-EN.md)", () => {
  const get = (key: string) => arabicByKey.get(key);

  it("one Arabic term for one English term, across the navigation, the page headings and the enums", () => {
    expect([get("shell.navLeads"), get("leads.leadsClients")]).toEqual(["العملاء", "العملاء"]);
    expect([get("shell.navProperties"), get("properties.properties")]).toEqual(["العقارات", "العقارات"]);
    expect([get("shell.navDeals"), get("deals.deals")]).toEqual(["الصفقات", "الصفقات"]);
    expect([get("shell.navCommissions"), get("common.commissions")]).toEqual(["العمولات", "العمولات"]);
    expect([get("shell.navTasks"), get("tasks.tasksFollowUps")?.split(" ")[0]]).toEqual(["المهام", "المهام"]);
    expect([get("shell.navViewings"), get("common.viewings"), get("dashboard.upcomingViewings")?.split(" ")[0]]).toEqual(["المعاينات", "المعاينات", "المعاينات"]);
    expect([get("shell.navDocuments"), get("common.documents")]).toEqual(["المستندات", "المستندات"]);
    expect([get("shell.navReports"), get("reports.reports")]).toEqual(["التقارير", "التقارير"]);
    expect([get("shell.navNotifications"), get("notifications.notifications")]).toEqual(["الإشعارات", "الإشعارات"]);
    expect([get("shell.navPipeline"), get("common.salesPipeline"), get("deals.pipeline")]).toEqual(["مسار المبيعات", "مسار المبيعات", "مسار المبيعات"]);
    expect(get("shell.navDashboard")).toBe("لوحة المعلومات");
    expect(get("shell.navSettings")).toBe(get("common.profileSettings"));
  });

  it("the stage, status and role labels agree with the glossary tables", () => {
    expect(get("enums.role.admin")).toBe("مسؤول النظام");
    expect(get("enums.role.manager")).toBe("مدير");
    expect(get("enums.role.salesperson")).toBe("مندوب مبيعات");
    expect(get("enums.leadStatus.new")).toBe("جديد");
    expect(get("enums.dealStage.under_contract")).toBe("قيد التعاقد");
    expect(get("enums.commissionStatus.pending")).toBe("بانتظار الاعتماد");
    expect(get("enums.commissionStatus.pending")).toBe(get("commissions.pending"));
    expect(get("enums.commissionStatus.approved")).toBe(get("commissions.approved"));
    expect(get("enums.commissionStatus.paid")).toBe(get("commissions.paid"));
    expect(get("enums.viewingStatus.cancelled")).toBe(get("viewings.cancelled"));
    expect(get("enums.propertyType.townhouse")).toBe("تاون هاوس"); // the loanword stays (glossary section 7)
  });

  it("the verbs of the same action agree: save, cancel, edit, sign in/out, approve, mark paid", () => {
    expect(get("common.save")).toBe("حفظ");
    expect(get("common.cancel")).toBe("إلغاء");
    expect(get("common.edit")).toBe("تعديل");
    expect(get("auth.signIn")).toBe("تسجيل الدخول");
    expect(get("common.signOut")).toBe("تسجيل الخروج");
    expect(get("commissions.approve")).toBe("اعتماد");
    expect(get("commissions.markPaid")).toBe("تأكيد الدفع");
    expect(get("shell.openMenu")).toBe("فتح القائمة");
    expect(get("shell.closeMenu")).toBe("إغلاق القائمة");
    expect(get("ui.close")).toBe("إغلاق");
  });

  it("avoids the terms the glossary rejects (dialect or ambiguous words)", () => {
    const text = arabic.map(([, value]) => value).join("\n");
    for (const banned of ["كمبوند", "سمسار", "ميري", "قطعة", "عايز", "ازاي", "دلوقتي", "شغّال"]) expect(text, banned).not.toContain(banned);
    expect(get("enums.role.admin")).not.toContain("مدير");
  });

  it("the interface-language note in the company settings does not claim the interface is English", () => {
    expect(get("settings.onlyChangesHowNumbersWritten")).not.toMatch(/الإنجليزية/);
    expect(en.settings && (en.settings as Record<string, string>).onlyChangesHowNumbersWritten).toMatch(/stays English/);
  });
});

describe("Arabic plural contract (for any plural message added later)", () => {
  const categories: string[] = [...new Intl.PluralRules("ar").resolvedOptions().pluralCategories].sort();

  it("Arabic has six plural categories, which is not the English rule", () => {
    expect(categories).toEqual(["few", "many", "one", "other", "two", "zero"]);
    expect(new Intl.PluralRules("en").resolvedOptions().pluralCategories.sort()).toEqual(["one", "other"]);
  });

  it("a message with the six branches picks the right one for 0, 1, 2, 3-10, 11-99 and 100", () => {
    const message = "{count, plural, zero {لا توجد عقارات} one {عقار واحد} two {عقاران} few {# عقارات} many {# عقارًا} other {# عقار}}";
    const t = createTranslator({ locale: "ar", messages: { x: { n: message } } as never }) as unknown as (key: string, values: Record<string, number>) => string;
    const out = (count: number) => t("x.n", { count });
    expect(out(0)).toBe("لا توجد عقارات");
    expect(out(1)).toBe("عقار واحد");
    expect(out(2)).toBe("عقاران");
    expect(out(3)).toBe("3 عقارات");
    expect(out(10)).toBe("10 عقارات");
    expect(out(11)).toBe("11 عقارًا");
    expect(out(99)).toBe("99 عقارًا");
    expect(out(100)).toBe("100 عقار");
  });

  it("every plural message of the catalogue, now or later, uses only valid Arabic categories (or exact =N matches) and has an `other` branch", () => {
    const check = (elements: MessageFormatElement[], key: string) => {
      for (const el of elements) {
        if (isPluralElement(el)) {
          const names = Object.keys(el.options);
          expect(names, key).toContain("other");
          for (const name of names) expect(categories.includes(name) || /^=\d+$/.test(name), `${key}: ${name}`).toBe(true);
          for (const option of Object.values(el.options)) check(option.value, key);
        } else if (isSelectElement(el)) {
          expect(Object.keys(el.options), key).toContain("other");
          for (const option of Object.values(el.options)) check(option.value, key);
        } else if (isTagElement(el)) check(el.children, key);
      }
    };
    for (const [key, value] of arabic) check(parse(value), key);
  });
});
