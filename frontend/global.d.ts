import type en from "./messages/en.json";

// Typed message keys (ADR-0001 2.5): the English catalogue is the source of the key set, so a key or namespace that does not exist is a compile error.
// Only `Messages` is augmented. `Locale` is deliberately left alone: narrowing it to "en" would make `getRequestConfig` reject the `string`
// that `resolveRequestLocale()` returns. While `messages/en.json` is `{}`, no key is valid yet; see src/i18n/typed-messages.test.ts.
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof en;
  }
}
