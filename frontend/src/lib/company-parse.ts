import { DEFAULT_COMPANY, type CompanyConfig } from "./company-defaults";

/**
 * The company settings from a parsed `GET /api/config/` body, filled in with the defaults for missing fields.
 * Null when the body is not a plain object (`null`, an array, a string, a number): such a body is a backend fault, not a configuration.
 */
export function mergeCompany(data: unknown): CompanyConfig | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  return { ...DEFAULT_COMPANY, ...(data as Partial<CompanyConfig>) };
}
