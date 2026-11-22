"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { API_ORIGIN } from "@/lib/api";
import { makeMoneyFormatters, type MoneyFormatters } from "@/lib/format";

/** Public branding and formatting of this deployment's company (GET /api/config/, no secrets, no sign-in needed). */
export interface CompanyConfig {
  company_name: string;
  workspace_label: string;
  currency_code: string;
  locale: string;
  language: string;
  direction: "ltr" | "rtl";
  logo_url: string | null;
}

/** What the interface looked like before company settings existed; used if the config cannot be fetched. */
export const DEFAULT_COMPANY: CompanyConfig = {
  company_name: "Keystone",
  workspace_label: "Sales workspace",
  currency_code: "USD",
  locale: "en-US",
  language: "en",
  direction: "ltr",
  logo_url: null,
};

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

/** Money formatters bound to THIS company's currency and locale (from the provider, never from shared module state). */
export function useMoney(): MoneyFormatters {
  const { currency_code, locale } = useCompany();
  return useMemo(() => makeMoneyFormatters({ currency_code, locale }), [currency_code, locale]);
}
