// Pure i18n core (Phase 1.2, ADR-0001 2.2). Nothing here imports React, Next.js or the browser: it is not wired into the app yet.

/** Interface languages the application accepts: English (the default) and Arabic (Phase 4). */
export const SUPPORTED = ["en", "ar"] as const;

export type SupportedLanguage = (typeof SUPPORTED)[number];

/** Each language written in itself (an endonym): the same in every catalogue on purpose, so it is not a translatable message. */
export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = { en: "English", ar: "العربية" };

/** The language used when nothing else decides. */
export const DEFAULT: SupportedLanguage = "en";

/** First-party cookie that caches the user's language on this device (ADR-0001 2.2: not HttpOnly, validated against the allow-list). */
export const LANGUAGE_COOKIE = "crm_lang";

export type Direction = "ltr" | "rtl";

// Direction is derived from the language, never stored (ADR-0001 2.2). Primary language subtags written right to left.
const RTL_LANGUAGES: readonly string[] = ["ar"];

/** `rtl` for Arabic (also `ar-EG`...), `ltr` for everything else, including empty or invalid input. */
export function directionFor(language: string | null | undefined): Direction {
  if (typeof language !== "string") return "ltr";
  const primary = language.trim().toLowerCase().split("-")[0];
  return RTL_LANGUAGES.includes(primary) ? "rtl" : "ltr";
}
