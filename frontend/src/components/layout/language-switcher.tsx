"use client";

import { useTranslations } from "next-intl";

import { LANGUAGE_NAMES, SUPPORTED } from "@/i18n/config";
import { useLanguage } from "@/i18n/use-language";

/**
 * Lets the user pick the interface language (cookie based; saving it to the profile needs a backend field and is not part of Phase 4).
 * Each language is named in its own language and script, the same in every catalogue, and carries its own `lang`, so a reader who cannot read the
 * current language can still find theirs. Only the languages of SUPPORTED are offered (never a test-only language).
 *  - `menu`: the entries of the profile menu (menuitemradio);
 *  - `inline`: a labelled group of toggle buttons, for pages without a menu (the sign-in page).
 */
export function LanguageSwitcher({ variant, onChosen }: { variant: "menu" | "inline"; onChosen?: () => void }) {
  const t = useTranslations();
  const { language, setLanguage } = useLanguage();
  const choose = (next: string) => {
    setLanguage(next);
    onChosen?.();
  };

  if (variant === "menu") {
    return (
      <div role="group" aria-label={t("shell.language")} className="border-t border-line pt-1">
        {SUPPORTED.map((code) => (
          <button
            key={code}
            type="button"
            role="menuitemradio"
            aria-checked={code === language}
            lang={code}
            className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-canvas"
            onClick={() => choose(code)}
          >
            {LANGUAGE_NAMES[code]}
            {code === language && <span aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div role="group" aria-label={t("shell.language")} className="flex items-center justify-center gap-2 text-sm">
      {SUPPORTED.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={code === language}
          lang={code}
          className={`rounded-md px-2.5 py-1 ${code === language ? "bg-brand/10 font-medium text-ink" : "text-muted hover:bg-canvas"}`}
          onClick={() => choose(code)}
        >
          {LANGUAGE_NAMES[code]}
        </button>
      ))}
    </div>
  );
}
