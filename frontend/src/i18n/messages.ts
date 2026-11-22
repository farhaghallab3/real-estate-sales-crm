import type { MessageCatalogue } from "../../scripts/pseudo-locale.mjs";

import type { SupportedLanguage } from "./config";
import { ENABLED_LANGUAGES, PSEUDO_LOCALE } from "./enabled";
import { isSupported } from "./resolve";

// One entry per supported language, written out so the bundler sees every file. `Record<SupportedLanguage, ...>` makes adding a language to
// SUPPORTED a compile error until its catalogue is listed here.
const CATALOGUES: Record<SupportedLanguage, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import("../../messages/en.json"),
  ar: () => import("../../messages/ar.json"),
};

/**
 * The message catalogue for an enabled language. Throws for anything else (a programming error), and lets a failed file load surface.
 * The pseudo-locale (E2E builds only, see enabled.ts) is made in memory from the real English catalogue: messages/en.json is never changed and no
 * en-XA file exists. The condition below is written out in full on purpose: the build replaces `process.env.I18N_PSEUDO` by a constant and removes the
 * branch, together with the generator, from every build that is not the pseudo-locale test build.
 */
export async function loadMessages(locale: string): Promise<Record<string, unknown>> {
  if (!isSupported(locale, ENABLED_LANGUAGES)) throw new Error(`No message catalogue for unsupported locale: ${JSON.stringify(locale)}`);
  if (process.env.I18N_PSEUDO === "1" && locale === PSEUDO_LOCALE) {
    const { pseudoLocalizeCatalogue } = await import("../../scripts/pseudo-locale.mjs");
    return pseudoLocalizeCatalogue((await CATALOGUES.en()).default as MessageCatalogue);
  }
  return (await CATALOGUES[locale as SupportedLanguage]()).default;
}
