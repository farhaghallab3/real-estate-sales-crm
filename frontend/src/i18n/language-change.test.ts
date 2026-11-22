import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { requestLanguageChange, type LanguageChangeDeps } from "./language-change";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

function setup(over: Partial<LanguageChangeDeps> = {}) {
  const writes: string[] = [];
  let refreshes = 0;
  const deps: LanguageChangeDeps = {
    current: "en",
    cookieHeader: "",
    context: { https: false, production: false },
    writeCookie: (c) => writes.push(c),
    refresh: () => void refreshes++,
    ...over,
  };
  return { deps, writes, refreshed: () => refreshes };
}

describe("requestLanguageChange with the application's allow-list (English and Arabic)", () => {
  it.each(["ar-EG", "fr", "EN", "", " en", "en;x", null, undefined, 1, {}])("rejects %j: no cookie, no refresh", (value) => {
    const { deps, writes, refreshed } = setup();
    expect(requestLanguageChange(value, deps)).toBe(false);
    expect(writes).toEqual([]);
    expect(refreshed()).toBe(0);
  });

  it("accepts Arabic: writes the cookie, then refreshes the page", () => {
    const { deps, writes, refreshed } = setup();
    expect(requestLanguageChange("ar", deps)).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^crm_lang=ar;/);
    expect(refreshed()).toBe(1);
  });

  it("same language and the cookie already holds it: accepted, nothing to do (no write, no refresh)", () => {
    const { deps, writes, refreshed } = setup({ cookieHeader: "a=1; crm_lang=en" });
    expect(requestLanguageChange("en", deps)).toBe(true);
    expect(writes).toEqual([]);
    expect(refreshed()).toBe(0);
  });

  it.each([
    ["missing", "a=1"],
    ["empty", "crm_lang="],
    ["tampered", "crm_lang=ar"],
    ["a look-alike name", "xcrm_lang=en"],
  ])("same language but the cookie is %s: the cookie is corrected, the page is not refreshed", (_label, cookieHeader) => {
    const { deps, writes, refreshed } = setup({ cookieHeader });
    expect(requestLanguageChange("en", deps)).toBe(true);
    expect(writes).toEqual(["crm_lang=en; Path=/; Max-Age=31536000; SameSite=Lax"]);
    expect(refreshed()).toBe(0);
  });

  it("passes the context to the cookie (Secure over HTTPS)", () => {
    const { deps, writes } = setup({ context: { https: true, production: false } });
    requestLanguageChange("en", deps);
    expect(writes[0]).toMatch(/; Secure$/);
  });
});

describe("requestLanguageChange with an explicit allow-list (the en/ar matrix; Arabic is not enabled in the app)", () => {
  const both = ["en", "ar"];

  it("a different language: writes the cookie first, then refreshes once", () => {
    const order: string[] = [];
    const { deps } = setup({ supported: both, writeCookie: (c) => order.push(`write ${c}`), refresh: () => order.push("refresh") });
    expect(requestLanguageChange("ar", deps)).toBe(true);
    expect(order).toEqual(["write crm_lang=ar; Path=/; Max-Age=31536000; SameSite=Lax", "refresh"]);
  });

  it("a different language whose cookie already holds it (the page is stale): no write, one refresh", () => {
    const { deps, writes, refreshed } = setup({ supported: both, current: "en", cookieHeader: "crm_lang=ar" });
    expect(requestLanguageChange("ar", deps)).toBe(true);
    expect(writes).toEqual([]);
    expect(refreshed()).toBe(1);
  });

  it("switching back writes and refreshes; asking again for the current language does neither", () => {
    const first = setup({ supported: both, current: "ar", cookieHeader: "crm_lang=ar" });
    expect(requestLanguageChange("en", first.deps)).toBe(true);
    expect(first.writes).toHaveLength(1);
    expect(first.refreshed()).toBe(1);
    const again = setup({ supported: both, current: "en", cookieHeader: "crm_lang=en" });
    expect(requestLanguageChange("en", again.deps)).toBe(true);
    expect(again.writes).toEqual([]);
    expect(again.refreshed()).toBe(0);
  });

  it("still rejects a language outside that list", () => {
    const { deps, writes, refreshed } = setup({ supported: both });
    expect(requestLanguageChange("fr", deps)).toBe(false);
    expect(writes).toEqual([]);
    expect(refreshed()).toBe(0);
  });
});

describe("the client/server boundary", () => {
  it("only use-language.ts is a client module; the logic and the cookie code stay importable anywhere", () => {
    expect(source("./use-language.ts")).toMatch(/^["']use client["']/);
    for (const file of ["./cookie.ts", "./language-change.ts"]) {
      const text = source(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // code only: the doc comments name document.cookie
      expect(text, file).not.toMatch(/^\s*["']use client["']/m);
      expect(text, file).not.toMatch(/next\/navigation|next-intl|from "react"|\bwindow\b|\bdocument\b/);
    }
  });

  it("use-language.ts reads document and window only inside the callback, adds no UI, and no server module imports it", () => {
    const hook = source("./use-language.ts");
    const body = hook.slice(hook.indexOf("export function useLanguage"));
    expect(body.indexOf("document.cookie")).toBeGreaterThan(body.indexOf("useCallback"));
    expect(body.indexOf("window.location")).toBeGreaterThan(body.indexOf("useCallback"));
    expect(hook).not.toMatch(/<\w+[^>]*>|createElement/);
    for (const file of ["./request.ts", "./server-locale.ts", "../app/layout.tsx"]) expect(source(file), file).not.toMatch(/use-language|language-change/);
  });

  it("the hook's public surface is exactly { language, setLanguage }", () => {
    expect(source("./use-language.ts")).toMatch(/return \{ language, setLanguage \};/);
  });
});
