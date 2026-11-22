import { SUPPORTED } from "./config";
import { readLanguageCookie, serializeLanguageCookie, type CookieContext } from "./cookie";
import { isSupported } from "./resolve";

// The decision behind `useLanguage().setLanguage`, with every browser and Next.js side effect injected, so it is tested without a browser.

export interface LanguageChangeDeps {
  /** The language the page is rendered in now (`useLocale()`). */
  current: string;
  /** `document.cookie` at the time of the call. */
  cookieHeader: string;
  context: CookieContext;
  /** Assigns a cookie string to `document.cookie`. */
  writeCookie: (cookie: string) => void;
  /** `router.refresh()`. */
  refresh: () => void;
  supported?: readonly string[];
}

/**
 * Asks for `requested` as the interface language.
 *  - not one of `supported`: returns false, writes nothing, refreshes nothing;
 *  - different from the current language: writes the cookie, then refreshes (the server re-renders in the new language);
 *  - equal to the current language and the cookie already holds it: nothing to do, no write, no refresh, returns true;
 *  - equal to the current language but the cookie is missing, stale or tampered with: writes the cookie so the choice sticks, but does not
 *    refresh (the page is already in that language).
 * `true` means the language was accepted and the needed action was started (or none was needed); it does not mean the server has finished rendering.
 * Saving the choice to the user's profile and the cookie at sign-in are not part of this step.
 */
export function requestLanguageChange(requested: unknown, deps: LanguageChangeDeps): boolean {
  const supported = deps.supported ?? SUPPORTED;
  if (!isSupported(requested, supported)) return false;
  const saved = readLanguageCookie(deps.cookieHeader, supported);
  if (saved !== requested) {
    const cookie = serializeLanguageCookie(requested, deps.context, supported);
    if (cookie === null) return false; // unreachable after the check above; keeps "never write an unsupported value" structural
    deps.writeCookie(cookie);
  }
  if (requested !== deps.current) deps.refresh();
  return true;
}
