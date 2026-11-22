"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { requestLanguageChange } from "./language-change";

/**
 * The interface language and a way to ask for another one. No component uses it yet (no UI in Phase 1.4).
 * `setLanguage(language)` returns true when the language is accepted and the action needed was started (cookie written, page refreshed), false when
 * it is not a supported language (nothing is written). Browser objects are touched only inside the callback, never while rendering.
 */
export function useLanguage() {
  const language = useLocale();
  const router = useRouter();
  const setLanguage = useCallback(
    (requested: string): boolean =>
      requestLanguageChange(requested, {
        current: language,
        cookieHeader: document.cookie,
        context: { https: window.location.protocol === "https:", production: process.env.NODE_ENV === "production" },
        writeCookie: (cookie) => {
          document.cookie = cookie;
        },
        refresh: () => router.refresh(),
      }),
    [language, router],
  );
  return { language, setLanguage };
}
