import { describe, expect, it } from "vitest";

import { DEFAULT, LANGUAGE_COOKIE, SUPPORTED, directionFor } from "./config";

describe("config constants", () => {
  it("allows English and Arabic (Phase 4)", () => {
    expect([...SUPPORTED]).toEqual(["en", "ar"]);
  });
  it("defaults to English, which is supported", () => {
    expect(DEFAULT).toBe("en");
    expect(SUPPORTED).toContain(DEFAULT);
  });
  it("names the language cookie crm_lang (ADR-0001 2.2)", () => {
    expect(LANGUAGE_COOKIE).toBe("crm_lang");
  });
});

describe("directionFor", () => {
  it.each([
    ["ar", "rtl"],
    ["AR", "rtl"],
    ["ar-EG", "rtl"],
    [" ar-SA ", "rtl"],
    ["en", "ltr"],
    ["en-US", "ltr"],
    ["EN", "ltr"],
    ["", "ltr"],
    ["xx", "ltr"],
    ["arabic", "ltr"], // only the primary subtag `ar` is right to left, not any word that starts with it
  ])("%j is %s", (language, expected) => {
    expect(directionFor(language)).toBe(expected);
  });

  it.each([[null], [undefined], [123 as unknown as string], [{} as unknown as string]])("%j (not a string) is ltr", (value) => {
    expect(directionFor(value as string | null | undefined)).toBe("ltr");
  });
});
