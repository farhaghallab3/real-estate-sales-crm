import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SUPPORTED } from "./config";
import { loadMessages } from "./messages";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

describe("loadMessages", () => {
  it("loads the catalogue of every supported language", async () => {
    for (const locale of SUPPORTED) {
      const messages = await loadMessages(locale);
      expect(messages).toEqual(JSON.parse(readFileSync(path.resolve(__dirname, "../../messages/" + locale + ".json"), "utf8")));
      expect(Object.keys(messages).length).toBeGreaterThan(10); // the catalogue is populated since Phase 3
    }
  });

  it.each(["ar-EG", "AR", "fr", "EN", "en ", "", "__proto__", "../en", "constructor"])("refuses %j: it can never reach a file path or the loader table", async (locale) => {
    await expect(loadMessages(locale)).rejects.toThrow(/unsupported locale/);
  });

  it("imports its catalogues with literal paths only (statically analysable) and swallows no error", () => {
    const text = source("./messages.ts");
    expect(text).not.toMatch(/import\(\s*[`"'][^`"']*\$\{/);
    expect(text).not.toMatch(/import\(\s*[a-zA-Z]/);
    expect(text).not.toMatch(/catch/);
  });
});

describe("one locale-resolution path", () => {
  it("request.ts decides through resolveRequestLocale and loads messages only for that result", () => {
    const text = source("./request.ts");
    expect(text).toMatch(/resolveRequestLocale\(\)/);
    expect(text).toMatch(/loadMessages\(locale\)/);
    expect(text).not.toMatch(/catch/);
  });

  it("server-locale.ts resolves with the cookie, the company language and Accept-Language, and no user language yet", () => {
    const text = source("./server-locale.ts");
    expect(text).toMatch(/resolveLocale\(\s*\{/);
    expect(text).toMatch(/cookie:/);
    expect(text).toMatch(/companyLanguage:/);
    expect(text).toMatch(/acceptLanguage:/);
    expect(text).not.toMatch(/userLanguage/);
  });

  it("the root layout reads the language from getLocale() and never resolves it itself", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toMatch(/getLocale\(\)/);
    expect(layout).toMatch(/dir=\{directionFor\(locale\)\}/);
    expect(layout).not.toMatch(/resolveLocale|resolveRequestLocale|negotiate/);
    expect(layout).not.toMatch(/company\.(language|direction)|active\./);
  });

  it("the layout wraps the existing providers and providers.tsx is not part of it", () => {
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toMatch(/<NextIntlClientProvider locale=\{locale\} messages=\{messages\}>\s*<CompanyProvider initial=\{company\}>\s*<Providers>\{children\}<\/Providers>/);
    const providers = readFileSync(new URL("../app/providers.tsx", import.meta.url), "utf8");
    expect(providers).not.toMatch(/next-intl/);
  });

  it("introduces no timezone default, middleware or cookie write", () => {
    for (const file of ["./request.ts", "./server-locale.ts", "../app/layout.tsx"]) {
      expect(source(file), file).not.toMatch(/timeZone|\.set\(|Set-Cookie/);
    }
  });
});
