import { cookies, headers } from "next/headers";
import { cache } from "react";

import { getCompany } from "@/lib/company-server";

import { LANGUAGE_COOKIE } from "./config";
import { ENABLED_LANGUAGES } from "./enabled";
import { resolveLocale } from "./resolve";

/**
 * THE interface language of this request (ADR-0001 2.2): cookie > company > Accept-Language > default. The signed-in user's saved language joins
 * the front of the chain in a later phase. Only src/i18n/request.ts calls this; everything else reads the result through next-intl's `getLocale()`.
 * `cache()` keeps it to one resolution per server render.
 */
export const resolveRequestLocale = cache(async (): Promise<string> => {
  const [cookieStore, headerStore, company] = await Promise.all([cookies(), headers(), getCompany()]);
  return resolveLocale(
    {
      cookie: cookieStore.get(LANGUAGE_COOKIE)?.value,
      companyLanguage: company?.language,
      acceptLanguage: headerStore.get("accept-language"),
    },
    ENABLED_LANGUAGES, // the supported languages; the pseudo-locale too in the E2E pseudo build only (enabled.ts)
  );
});
