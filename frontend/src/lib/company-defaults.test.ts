import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_COMPANY, type CompanyConfig } from "./company-defaults";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("DEFAULT_COMPANY", () => {
  it("keeps exactly the value and shape the interface had before company settings existed", () => {
    expect(DEFAULT_COMPANY).toEqual({
      company_name: "Keystone",
      workspace_label: "Sales workspace",
      currency_code: "USD",
      locale: "en-US",
      language: "en",
      direction: "ltr",
      logo_url: null,
    });
    const keys: (keyof CompanyConfig)[] = ["company_name", "workspace_label", "currency_code", "locale", "language", "direction", "logo_url"];
    expect(Object.keys(DEFAULT_COMPANY).sort()).toEqual([...keys].sort());
  });

  it("has every field, so a Server Component never reads undefined from it", () => {
    for (const [key, value] of Object.entries(DEFAULT_COMPANY)) expect(value, key).not.toBeUndefined();
  });
});

// The original defect: a value exported from a "use client" module is a client reference on the server (no fields).
describe("the defaults stay importable from Server Components", () => {
  it("company-defaults.ts has no 'use client' directive", () => {
    expect(source("./company-defaults.ts")).not.toMatch(/^\s*["']use client["']/m);
  });

  it("the root layout takes DEFAULT_COMPANY from company-defaults, not from the client module", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toMatch(/import\s*\{[^}]*DEFAULT_COMPANY[^}]*\}\s*from\s*["']@\/lib\/company-defaults["']/);
    expect(layout).not.toMatch(/import\s*\{[^}]*DEFAULT_COMPANY[^}]*\}\s*from\s*["']@\/lib\/company["']/);
  });

  it("the client module still re-exports both names for client components", () => {
    const company = source("./company.tsx");
    expect(company).toMatch(/^["']use client["']/);
    expect(company).toMatch(/export\s*\{\s*DEFAULT_COMPANY\s*\}/);
    expect(company).toMatch(/export\s+type\s*\{\s*CompanyConfig\s*\}/);
  });
});
