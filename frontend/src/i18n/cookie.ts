import { LANGUAGE_COOKIE, SUPPORTED } from "./config";
import { isSupported } from "./resolve";

// The `crm_lang` cookie (ADR-0001 2.2). Pure functions: no `window`, no `document`, no environment reads. The caller passes the context.

/** One year, in seconds. */
export const LANGUAGE_COOKIE_MAX_AGE = 31_536_000;

export interface CookieContext {
  /** The page is served over HTTPS (`location.protocol === "https:"`). */
  https: boolean;
  /** This is a production build (`process.env.NODE_ENV === "production"`). */
  production: boolean;
}

/**
 * The `Set-Cookie` / `document.cookie` string that saves `language`, or null when `language` is not one of `supported` (nothing is ever stored for it).
 * `Path=/`, `SameSite=Lax`, one year, `Secure` over HTTPS and always in production, never `HttpOnly` (the client writes it). It names exactly one
 * cookie, so assigning it to `document.cookie` cannot overwrite any other cookie.
 */
export function serializeLanguageCookie(language: unknown, context: CookieContext, supported: readonly string[] = SUPPORTED): string | null {
  if (!isSupported(language, supported)) return null;
  const parts = [`${LANGUAGE_COOKIE}=${language}`, "Path=/", `Max-Age=${LANGUAGE_COOKIE_MAX_AGE}`, "SameSite=Lax"];
  if (context.https || context.production) parts.push("Secure");
  return parts.join("; ");
}

/**
 * The saved language from a `Cookie` header / `document.cookie` string, or null when it is missing, empty, tampered with or not one of `supported`.
 * Only the cookie named exactly `crm_lang` counts (`xcrm_lang` and `crm_lang2` do not); when it appears twice the first one wins, as in a browser.
 */
export function readLanguageCookie(cookieHeader: unknown, supported: readonly string[] = SUPPORTED): string | null {
  if (typeof cookieHeader !== "string") return null;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== LANGUAGE_COOKIE) continue;
    const value = pair.slice(eq + 1).trim();
    return isSupported(value, supported) ? value : null;
  }
  return null;
}
