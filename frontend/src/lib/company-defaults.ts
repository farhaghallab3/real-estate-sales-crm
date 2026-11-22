// Company settings shape and defaults. This module has NO "use client" directive on purpose: a value exported from a client module is a
// client reference when a Server Component imports it, so the root layout would see an object without fields (`undefined` language, direction
// and company name) whenever the backend cannot be reached. Server and client code both import from here (lib/company.tsx re-exports it).

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
