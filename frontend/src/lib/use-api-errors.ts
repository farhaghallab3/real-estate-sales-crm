"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { errorText, fieldErrorTexts, type ErrorTranslate } from "@/lib/api-errors";

/**
 * Localized backend errors for a component (Phase 6, see lib/api-errors.ts).
 *  - `errorText(error, fallback?)`: the message to show for any error; `fallback` is the action's own translated message ("Could not save the lead.") for failures
 *    that are not an HTTP answer;
 *  - `errorFields(error)`: the DRF field errors, translated when known, still keyed by their own field names.
 */
export function useApiErrors() {
  const t = useTranslations();
  const language = useLocale();
  return useMemo(() => {
    const translate = t as unknown as ErrorTranslate;
    return {
      errorText: (error: unknown, fallback?: string) => errorText(error, translate, language, fallback),
      errorFields: (error: unknown) => fieldErrorTexts(error, translate),
    };
  }, [t, language]);
}
