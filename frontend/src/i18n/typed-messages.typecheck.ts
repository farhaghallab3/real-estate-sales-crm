import { useTranslations } from "next-intl";

// Compile-time evidence, checked by `npm run typecheck` (this file has no runtime and is never imported). Each `@ts-expect-error` line must be an
// error; if the `AppConfig` augmentation in global.d.ts stops working, the keys fall back to `Record<string, any>`, the line compiles, the directive
// becomes "unused" and `tsc` fails. `messages/en.json` is empty, so there is no VALID key to show yet: the positive cases (a real key compiles)
// are proved with a non-empty fixture catalogue in typed-messages.test.ts, and move here once real messages exist.
export function useNegativeCases() {
  // @ts-expect-error a namespace that is not in the catalogue
  useTranslations("nope");

  const t = useTranslations();
  // @ts-expect-error a key that is not in the catalogue
  t("nope.missing");
  // @ts-expect-error not even a bare key exists
  t("missing");
}
