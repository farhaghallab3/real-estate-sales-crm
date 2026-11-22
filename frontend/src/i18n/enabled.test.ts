import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { parse, isLiteralElement, isPluralElement, isPoundElement, isSelectElement, isTagElement } from "@formatjs/icu-messageformat-parser";
import type { MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SUPPORTED } from "./config";

// Phase 1.7b: the pseudo-locale exists only in a build made with I18N_PSEUDO=1 (the E2E pseudo build). These tests cover the isolation (build flag, language
// resolution, catalogue loading) and the catalogue coverage (every real message has a pseudo-localized twin with the same structure).
const ROOT = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const english = JSON.parse(read("messages/en.json")) as Record<string, unknown>;

const flat = (object: Record<string, unknown>, prefix = ""): Record<string, string> =>
  Object.fromEntries(Object.entries(object).flatMap(([key, value]) => (typeof value === "object" && value !== null ? Object.entries(flat(value as Record<string, unknown>, `${prefix}${key}.`)) : [[`${prefix}${key}`, value as string]])));

/** The structure of a message without its words: argument names and kinds, plural/select keys, tags, the # marker. */
function shape(elements: MessageFormatElement[]): unknown[] {
  const out = elements.map((el): unknown => {
    if (isLiteralElement(el)) return "L";
    if (isTagElement(el)) return { tag: el.value, children: shape(el.children) };
    if (isPluralElement(el) || isSelectElement(el)) return { type: el.type, name: el.value, options: Object.fromEntries(Object.entries(el.options).map(([k, o]) => [k, shape(o.value)]).sort()) };
    if (isPoundElement(el)) return "#";
    return { type: el.type, name: el.value };
  });
  return out.filter((item, i) => !(item === "L" && out[i - 1] === "L"));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(flag: string | undefined) {
  vi.resetModules();
  if (flag === undefined) vi.stubEnv("I18N_PSEUDO", "");
  else vi.stubEnv("I18N_PSEUDO", flag);
  const [enabled, messages, resolve] = await Promise.all([import("./enabled"), import("./messages"), import("./resolve")]);
  return { ...enabled, ...messages, ...resolve };
}

describe("which languages a build accepts", () => {
  it("is exactly SUPPORTED without the build flag (and SUPPORTED itself never changes)", async () => {
    const m = await load(undefined);
    expect([...m.ENABLED_LANGUAGES]).toEqual(["en", "ar"]);
    expect([...SUPPORTED]).toEqual(["en", "ar"]);
  });

  it("adds en-XA only for I18N_PSEUDO=1, not for any other value", async () => {
    expect([...(await load("1")).ENABLED_LANGUAGES]).toEqual(["en", "ar", "en-XA"]);
    for (const value of ["0", "true", "yes", "TRUE", " 1", "1 ", "on", ""]) expect([...(await load(value)).ENABLED_LANGUAGES], JSON.stringify(value)).toEqual(["en", "ar"]);
  });

  it("the language resolver accepts a cookie for en-XA only when the build enables it; the supported languages resolve as before", async () => {
    const on = await load("1");
    expect(on.resolveLocale({ cookie: "en-XA" }, on.ENABLED_LANGUAGES)).toBe("en-XA");
    expect(on.resolveLocale({ acceptLanguage: "en-XA,en;q=0.5" }, on.ENABLED_LANGUAGES)).toMatch(/^en(-XA)?$/);
    const off = await load(undefined);
    expect(off.resolveLocale({ cookie: "en-XA" }, off.ENABLED_LANGUAGES)).toBe("en");
    expect(off.resolveLocale({ cookie: "en", companyLanguage: "en-XA" }, off.ENABLED_LANGUAGES)).toBe("en");
    expect(off.resolveLocale({ cookie: "ar" }, off.ENABLED_LANGUAGES)).toBe("ar"); // Arabic is a real language since Phase 4, in every build
    expect(on.resolveLocale({ cookie: "ar" }, on.ENABLED_LANGUAGES)).toBe("ar");
  });
});

describe("loading the catalogue", () => {
  it("a normal build refuses en-XA, and loads English unchanged", async () => {
    const m = await load(undefined);
    await expect(m.loadMessages("en-XA")).rejects.toThrow(/unsupported locale/);
    expect(await m.loadMessages("en")).toEqual(english);
  });

  it("the pseudo build makes en-XA in memory from the real catalogue and leaves English and the file alone", async () => {
    const m = await load("1");
    const pseudo = flat(await m.loadMessages("en-XA"));
    const real = flat(english);
    expect(await m.loadMessages("en")).toEqual(english); // English is the same in the pseudo build
    expect(read("messages/en.json")).not.toMatch(/[⟦⟧]/); // the file is not touched
    expect(readdirSync(path.join(ROOT, "messages"))).toEqual(["ar.json", "en.json"]); // and no en-XA file exists
    expect(Object.keys(pseudo).sort()).toEqual(Object.keys(real).sort());
  });

  it("covers every one of the real messages: same placeholders, plural/select logic, tags and # as the English message, longer, and marked", async () => {
    const m = await load("1");
    const pseudo = flat(await m.loadMessages("en-XA"));
    const real = flat(english);
    let transformed = 0;
    for (const [key, message] of Object.entries(real)) {
      const twin = pseudo[key];
      expect(twin, key).toBeTypeOf("string");
      expect(shape(parse(twin)), key).toEqual(shape(parse(message)).length === 0 || /[A-Za-z]/.test(message.replace(/\{[^}]*\}/g, "")) ? expect.anything() : shape(parse(message)));
      const original = shape(parse(message));
      const withMarks = shape(parse(twin));
      // the marks are literal text at the two ends; apart from them the structure is the English one
      const strip = (s: unknown[]) => s.filter((x) => x !== "L");
      expect(strip(withMarks), key).toEqual(strip(original));
      if (twin !== message) {
        transformed++;
        expect(twin.startsWith("⟦") && twin.endsWith("⟧"), key).toBe(true);
        expect(twin.length, key).toBeGreaterThan(message.length);
      }
    }
    expect(transformed).toBeGreaterThan(Object.keys(real).length * 0.95); // almost every message has words to transform
  });

  it("dynamic values and technical identifiers are not touched: a message with only an argument stays as it is", async () => {
    const m = await load("1");
    const pseudo = flat(await m.loadMessages("en-XA"));
    const real = flat(english);
    for (const [key, message] of Object.entries(real)) {
      if (/^\{\w+\}$/.test(message)) expect(pseudo[key], key).toBe(message);
    }
  });
});

describe("the pseudo-locale cannot reach a deployable build", () => {
  const referencing = (pattern: RegExp, dirs: string[]): string[] => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === "node_modules" || e.name === ".next" || e.name === "test-results" || e.name === "playwright-report" ? [] : e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    return dirs.flatMap(files).filter((f) => /\.(ts|tsx|mjs|js|json|yml|yaml)$|Dockerfile/.test(f) && pattern.test(readFileSync(f, "utf8"))).map((f) => path.relative(ROOT, f).replace(/\\/g, "/")).sort();
  };

  it("the build flag is read in these files only (next.config.mjs inlines it; the stack sets it for its own pseudo build)", () => {
    const users = referencing(/I18N_PSEUDO/, [path.join(ROOT, "src"), path.join(ROOT, "e2e"), path.join(ROOT, "scripts")]).filter((f) => !f.endsWith(".test.ts"));
    expect(users).toEqual(["e2e/pseudo.spec.ts", "e2e/stack.mjs", "src/i18n/enabled.ts", "src/i18n/messages.ts"]); // the pseudo spec only names it in a comment
    expect(read("next.config.mjs")).toMatch(/process\.env\.I18N_PSEUDO === "1"/);
  });

  it("no Docker or compose file, and no deployment script, sets or mentions it", () => {
    // the deployment tooling directory is not part of every checkout (it is absent from the public repository): a directory that does not exist has nothing to mention the flag
    const dirs = [path.join(ROOT, "..", "deploy"), path.join(ROOT, "..", "backend")].filter((dir) => existsSync(dir));
    expect(dirs.length, "the backend directory is always checked").toBeGreaterThanOrEqual(1);
    expect(referencing(/I18N_PSEUDO/, dirs)).toEqual([]);
    for (const file of ["Dockerfile", "../docker-compose.yml", "../docker-compose.prod.yml"]) expect(read(file), file).not.toMatch(/I18N_PSEUDO/);
  });

  it("the build refuses the flag for a standalone (container) or Vercel build", () => {
    const config = read("next.config.mjs");
    expect(config).toMatch(/pseudo && \(process\.env\.NEXT_OUTPUT === "standalone" \|\| process\.env\.VERCEL\)/);
    expect(config).toMatch(/throw new Error\("I18N_PSEUDO=1 is for the E2E test build only/);
  });

  it("the check is written inline, so the build can remove the branch and the generator from every other build", () => {
    const messages = read("src/i18n/messages.ts");
    expect(messages).toMatch(/if \(process\.env\.I18N_PSEUDO === "1" && locale === PSEUDO_LOCALE\)/);
    expect(read("src/i18n/enabled.ts")).toMatch(/process\.env\.I18N_PSEUDO === "1" \? \[\.\.\.SUPPORTED, PSEUDO_LOCALE\] : SUPPORTED/);
  });

  it("the stack runs the pseudo build as its own phase and starts the product's phase last, so that .next ends as the normal build", () => {
    const stack = read("e2e/stack.mjs");
    expect(stack).toMatch(/delete env\.I18N_PSEUDO/);
    expect(stack).toMatch(/phase\.pseudo \? \{ \.\.\.env, I18N_PSEUDO: "1" \} : env/);
    expect(stack.indexOf('name: "pseudo-locale", pseudo: true, args: ["--project=pseudo"] }, { name: "product"')).toBeGreaterThan(0);
  });

  it("the Playwright projects keep the suites apart: the product's project ignores the pseudo spec, the pseudo project runs nothing else", () => {
    const config = read("playwright.config.ts");
    expect(config).toMatch(/name: "chromium"[\s\S]*?testIgnore: \/pseudo\\\.spec\\\.ts\$\//);
    expect(config).toMatch(/name: "pseudo"[\s\S]*?testMatch: \/pseudo\\\.spec\\\.ts\$\//);
    expect(SUPPORTED).toEqual(["en", "ar"]);
  });

  it("the product's language resolution rules are unchanged: only the allow-list passed to them differs", () => {
    const resolve = read("src/i18n/resolve.ts");
    expect(resolve).not.toMatch(/en-XA|PSEUDO/);
    expect(read("src/i18n/config.ts")).not.toMatch(/en-XA|PSEUDO/);
    expect(read("src/i18n/server-locale.ts")).toMatch(/ENABLED_LANGUAGES/);
  });
});
