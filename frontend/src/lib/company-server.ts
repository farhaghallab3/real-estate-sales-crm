import { cache } from "react";

import type { CompanyConfig } from "./company-defaults";
import { mergeCompany } from "./company-parse";

// Server-only. Branding is read at request time from this instance's own backend, so ONE build serves every customer.
const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? process.env.BACKEND_INTERNAL_URL ?? "").trim().replace(/\/+$/, "") ||
  (process.env.NODE_ENV !== "production" ? "http://localhost:8000" : "");

/**
 * This request's company settings, or null when the backend cannot supply them (no URL, unreachable, timeout, non-2xx, invalid JSON, a body that is not an object).
 * `cache()` is scoped to one server render: metadata, the root layout and the locale resolution share ONE fetch, and no request sees another's data.
 */
export const getCompany = cache(async (): Promise<CompanyConfig | null> => {
  if (!API_BASE) return null;
  let body: unknown;
  try {
    const res = await fetch(`${API_BASE}/api/config/`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    body = await res.json();
  } catch {
    return null; // backend unreachable, too slow or not JSON: render with the defaults, the browser retries
  }
  return mergeCompany(body);
});
