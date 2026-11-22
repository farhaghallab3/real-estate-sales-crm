// The formatting locale (ADR-0001 2.4): separators, grouping, currency pattern and month names follow the USER's language, while the
// REGION comes from the company's locale setting and the numbering system from the company. The base currency is not part of it:
// it stays a company setting passed to Intl separately, and stored values never change. Pure function, not wired into the app yet.

export type NumberingSystem = "latn" | "arab";

function regionOf(companyLocale: string | null | undefined): string | undefined {
  if (typeof companyLocale !== "string" || companyLocale.trim() === "") return undefined;
  try {
    return new Intl.Locale(companyLocale.trim()).region;
  } catch {
    return undefined; // not a valid locale tag: no region, never an error
  }
}

function languageOf(language: string | null | undefined): string {
  try {
    return new Intl.Locale(typeof language === "string" ? language.trim() : "").language;
  } catch {
    return "en"; // not a valid language: English
  }
}

/**
 * `new Intl.Locale(userLanguage, { region, numberingSystem, calendar: "gregory" })` where `region` is the region of
 * `companyLocale` (`ar-EG` gives `EG`). Latin digits by default; the calendar is always Gregorian. Never throws: an invalid language
 * becomes English, an invalid company locale gives no region, an invalid numbering system becomes `latn`.
 */
export function formattingLocale(language: string, companyLocale?: string | null, numbering: NumberingSystem = "latn"): Intl.Locale {
  const base = languageOf(language);
  const region = regionOf(companyLocale);
  try {
    return new Intl.Locale(base, { region, numberingSystem: numbering, calendar: "gregory" });
  } catch {
    return new Intl.Locale(base, { region, numberingSystem: "latn", calendar: "gregory" });
  }
}
