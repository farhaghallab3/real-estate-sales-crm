"use client";

import { useLocale, useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { API_ORIGIN } from "@/lib/api";
import { DEFAULT_COMPANY, type CompanyConfig } from "@/lib/company-defaults";
import { makeFormatters, type Formatters, type Translate } from "@/lib/format";
import { weekSettingsFor, type WeekSettings } from "@/lib/week";

// The shape and the defaults live in company-defaults.ts (importable from Server Components); they are re-exported so client code keeps importing them from here.
export { DEFAULT_COMPANY };
export type { CompanyConfig };

interface CompanyContextValue extends CompanyConfig {
  /** Absolute-enough URL for <img src>, or null when no logo is set. */
  logoSrc: string | null;
  setCompany: (next: CompanyConfig) => void;
}

const CompanyContext = createContext<CompanyContextValue>({
  ...DEFAULT_COMPANY,
  logoSrc: null,
  setCompany: () => undefined,
});

export function CompanyProvider({ initial, children }: { initial: CompanyConfig | null; children: React.ReactNode }) {
  const [company, setCompanyState] = useState<CompanyConfig>(initial ?? DEFAULT_COMPANY);
  const setCompany = useCallback((next: CompanyConfig) => setCompanyState(next), []);

  // The server could not reach the backend while rendering: try once from the browser.
  useEffect(() => {
    if (initial) return;
    let alive = true;
    fetch(`${API_ORIGIN}/api/config/`)
      .then((res) => (res.ok ? (res.json() as Promise<CompanyConfig>) : null))
      .then((cfg) => alive && cfg && setCompanyState(cfg))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [initial]);

  const value = useMemo<CompanyContextValue>(
    () => ({
      ...company,
      logoSrc: company.logo_url ? `${API_ORIGIN}${company.logo_url}` : null,
      setCompany,
    }),
    [company, setCompany],
  );
  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export const useCompany = () => useContext(CompanyContext);

/** Every number, amount, date and relative-time formatter, bound to THIS company's currency and region and to the interface language (never shared module state). */
export function useFormat(): Formatters {
  const { currency_code, locale } = useCompany();
  const language = useLocale();
  const t = useTranslations();
  return useMemo(() => makeFormatters({ language, companyLocale: locale, currency_code }, t as unknown as Translate), [language, locale, currency_code, t]);
}

/** The money subset of useFormat(). */
export function useMoney(): Pick<Formatters, "money" | "money2" | "moneyCompact"> {
  const { money, money2, moneyCompact } = useFormat();
  return useMemo(() => ({ money, money2, moneyCompact }), [money, money2, moneyCompact]);
}

/** Week start and weekend days, defaulted from the company's region (lib/week.ts). */
export function useWeek(): WeekSettings {
  const { locale } = useCompany();
  return useMemo(() => weekSettingsFor(locale), [locale]);
}
