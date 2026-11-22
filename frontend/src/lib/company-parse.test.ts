import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_COMPANY } from "./company-defaults";
import { mergeCompany } from "./company-parse";

describe("mergeCompany", () => {
  it("keeps a complete configuration as it is", () => {
    const full = { company_name: "Acme", workspace_label: "W", currency_code: "EGP", locale: "ar-EG", language: "ar", direction: "rtl", logo_url: "/l.png" };
    expect(mergeCompany(full)).toEqual(full);
  });

  it("fills the missing fields of a partial configuration from the defaults", () => {
    expect(mergeCompany({ company_name: "Acme" })).toEqual({ ...DEFAULT_COMPANY, company_name: "Acme" });
    expect(mergeCompany({})).toEqual(DEFAULT_COMPANY);
  });

  it.each([null, undefined, [], [1, 2], "text", "{}", 0, 42, true, false])("rejects a body that is not a plain object: %j", (body) => {
    expect(mergeCompany(body)).toBeNull();
  });

  it("does not change the defaults or its input", () => {
    const input = Object.freeze({ company_name: "Acme" });
    const before = structuredClone(DEFAULT_COMPANY);
    mergeCompany(input);
    expect(DEFAULT_COMPANY).toEqual(before);
  });
});

describe("company-server.ts", () => {
  const text = readFileSync(new URL("./company-server.ts", import.meta.url), "utf8");
  it("is cached per request, keeps the 2.5 s timeout and no-store, and validates through mergeCompany", () => {
    expect(text).toMatch(/cache\(async/);
    expect(text).toMatch(/AbortSignal\.timeout\(2500\)/);
    expect(text).toMatch(/cache: "no-store"/);
    expect(text).toMatch(/mergeCompany\(body\)/);
  });
  it("catches only the network and parse step, not the merge", () => {
    const tryBlock = /try \{([\s\S]*?)\} catch/.exec(text)?.[1] ?? "";
    expect(tryBlock).toMatch(/fetch\(/);
    expect(tryBlock).toMatch(/res\.json\(\)/);
    expect(tryBlock).not.toMatch(/mergeCompany/);
  });
  it("has no 'use client' directive", () => {
    expect(text).not.toMatch(/^\s*["']use client["']/m);
  });
});
