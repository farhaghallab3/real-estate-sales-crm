import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { parse, isArgumentElement, isLiteralElement, isPluralElement, isPoundElement, isSelectElement, isTagElement, isNumberElement } from "@formatjs/icu-messageformat-parser";
import type { MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { printAST } from "@formatjs/icu-messageformat-parser/printer.js";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import { CLOSE_MARK, EXPANSION, OPEN_MARK, PseudoLocaleError, isPseudoLocalized, pseudoLocalize, pseudoLocalizeCatalogue } from "../../scripts/pseudo-locale.mjs";

import { SUPPORTED } from "./config";

// Phase 1.7a: the pure pseudo-localization generator (scripts/pseudo-locale.mjs). Not wired into the application; nothing here enables en-XA.

/** The structure of a message without its text: element types, argument names, formats, plural/select keys and tag names. Literals become "L". */
function shape(elements: MessageFormatElement[]): unknown[] {
  return squash(elements.map((el) => {
    if (isLiteralElement(el)) return "L";
    if (isTagElement(el)) return { tag: el.value, children: shape(el.children) };
    if (isPluralElement(el) || isSelectElement(el)) {
      return { type: el.type, name: el.value, offset: isPluralElement(el) ? el.offset : undefined, options: Object.fromEntries(Object.entries(el.options).map(([k, o]) => [k, shape(o.value)]).sort()) };
    }
    if (isPoundElement(el)) return "#";
    return { type: el.type, name: el.value, style: isNumberElement(el) ? el.style : (el as { style?: unknown }).style };
  }));
}

/** Adjacent literals are one literal: the printer merges the markers into the neighbouring text. */
function squash(list: unknown[]): unknown[] {
  return list.filter((item, i) => !(item === "L" && list[i - 1] === "L"));
}

/** What the structure of the pseudo-localized message must be: the source structure between the two markers. */
function wrapped(sample: string): unknown[] {
  return squash(["L", ...shape(parse(sample)), "L"]);
}

/** The message's structure with the two outer markers removed (they are literals added by the generator). */
function innerShape(pseudo: string): unknown[] {
  const ast = parse(pseudo);
  const first = ast[0];
  const last = ast[ast.length - 1];
  expect(isLiteralElement(first) && first.value.startsWith(OPEN_MARK)).toBe(true);
  expect(isLiteralElement(last) && last.value.endsWith(CLOSE_MARK)).toBe(true);
  return shape(ast);
}

/** Every literal text of a message, in order. */
function literals(elements: MessageFormatElement[]): string[] {
  return elements.flatMap((el) => {
    if (isLiteralElement(el)) return [el.value];
    if (isTagElement(el)) return literals(el.children);
    if (isPluralElement(el) || isSelectElement(el)) return Object.values(el.options).flatMap((o) => literals(o.value));
    return [];
  });
}

const SAMPLES = [
  "Save changes",
  "Hello {name}, you have {count, number} new leads",
  "{n, plural, =0 {No deals} one {# deal} other {# deals}}",
  "Click <b>here</b> to <i>continue</i>",
  "{gender, select, female {Her {n, plural, one {# lead} other {# leads}}} male {His lead} other {Their lead}}",
  "Offer valid {when, date, short} for <b>{n, plural, one {# day} other {# days}}</b>",
];

describe("transformation", () => {
  it("accents the letters, adds the markers and expands the text", () => {
    expect(pseudoLocalize("Save changes")).toBe("⟦Śáṽé çĥáńĝéś~~~~⟧");
    expect(OPEN_MARK).toBe("⟦");
    expect(CLOSE_MARK).toBe("⟧");
  });

  it("maps all 52 ASCII letters to distinct accented letters and leaves nothing ASCII in a transformed word", () => {
    const out = pseudoLocalize("abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    const body = out.slice(1, -1).replace(/~+/g, "");
    const letters = body.replace(/\s/g, "");
    expect(letters).toHaveLength(52);
    expect(new Set(letters).size).toBe(52);
    expect(letters).not.toMatch(/[A-Za-z]/);
  });

  it("is deterministic: the same input always gives the same output", () => {
    for (const sample of SAMPLES) {
      const first = pseudoLocalize(sample);
      for (let i = 0; i < 5; i++) expect(pseudoLocalize(sample)).toBe(first);
    }
  });

  it("adds exactly 35% (rounded) of the text length to a single-literal message, plus the two markers", () => {
    for (const text of ["Save", "Save changes", "Add a new lead to the pipeline", "Schedule viewing"]) {
      expect(pseudoLocalize(text)).toHaveLength(text.length + Math.round(text.length * EXPANSION) + 2);
    }
    expect(EXPANSION).toBe(0.35);
  });

  it("expands a long text by about 35% (tolerance for rounding per literal)", () => {
    const paragraph = "Every lead keeps its history so that the next person who opens the file knows what was promised, what was sent and what is still waiting for an answer from the client.";
    const ratio = (pseudoLocalize(paragraph).length - 2) / paragraph.length;
    expect(ratio).toBeGreaterThan(1.33);
    expect(ratio).toBeLessThan(1.37);
  });

  it("short strings grow by at least the rounded share and never shrink", () => {
    for (const text of ["OK", "Add", "No", "Yes", "Edit"]) {
      const out = pseudoLocalize(text);
      expect(out.length).toBeGreaterThanOrEqual(text.length + 2);
    }
  });
});

describe("what must not change", () => {
  it.each(SAMPLES)("keeps the structure of %j (arguments, formats, plural/select keys, #, tags)", (sample) => {
    expect(innerShape(pseudoLocalize(sample))).toEqual(wrapped(sample));
  });

  it("does not touch interpolation arguments, number and date formats", () => {
    const out = pseudoLocalize("Hello {userName}, total {amount, number, ::currency/EGP} on {when, date, short}");
    expect(out).toContain("{userName}");
    expect(out).toContain("{when, date, short}");
    expect(out).toMatch(/\{amount, number, ::currency\/EGP\}/);
  });

  it("keeps plural keys, exact-value clauses and the # marker", () => {
    const out = pseudoLocalize("{n, plural, =0 {No deals} one {# deal} other {# deals}}");
    const plural = parse(out).find(isPluralElement);
    expect(plural && Object.keys(plural.options).sort()).toEqual(["=0", "one", "other"].sort());
    expect(out.match(/#/g)).toHaveLength(2);
  });

  it("keeps select keys and nested plural-in-select structure", () => {
    const out = pseudoLocalize(SAMPLES[4]);
    const select = parse(out).find(isSelectElement);
    expect(select && Object.keys(select.options).sort()).toEqual(["female", "male", "other"]);
    const nested = select && Object.values(select.options.female.value).find(isPluralElement);
    expect(nested && Object.keys(nested.options).sort()).toEqual(["one", "other"]);
  });

  it("keeps rich-text tag names and nesting, and transforms the text inside them", () => {
    const out = pseudoLocalize("Read <b>the <i>full</i> terms</b> now");
    expect(out).toContain("<b>");
    expect(out).toContain("<i>");
    expect(out).toContain("</i>");
    expect(out).toContain("</b>");
    expect(out).not.toMatch(/\bfull\b/);
    expect(innerShape(out)).toEqual(wrapped("Read <b>the <i>full</i> terms</b> now"));
  });

  it.each([
    ["a URL", "See https://example.com/leads?id=42&x=1 today", "https://example.com/leads?id=42&x=1"],
    ["a www address", "Open www.example.com/help now", "www.example.com/help"],
    ["an e-mail address", "Write to first.last+crm@example.co.uk please", "first.last+crm@example.co.uk"],
    ["digits and numbers", "Pay 1,250.50 by 10:30 on 2026-11-21", "1,250.50"],
    ["a snake_case identifier", "The cookie is crm_lang for this device", "crm_lang"],
    ["a reference code", "Deal PR-00042 is ready", "PR-00042"],
  ])("leaves %s byte for byte as it is", (_what, text, token) => {
    const out = pseudoLocalize(text);
    expect(out).toContain(token);
    expect(out).not.toBe(text);
  });

  it("transforms the text around a protected token, not the token", () => {
    expect(pseudoLocalize("Call 100 now")).toBe("⟦Çáĺĺ 100 ńóŵ~~~⟧");
  });

  it("does not touch non-ASCII letters, symbols or emoji (Arabic, German, accents, emoji)", () => {
    expect(pseudoLocalize("عميل جديد")).toBe("عميل جديد"); // nothing transformable: unchanged
    expect(pseudoLocalize("Straße café 🙂")).toContain("ß");
    expect(pseudoLocalize("Straße café 🙂")).toContain("é");
    expect(pseudoLocalize("Straße café 🙂")).toContain("🙂");
    expect(pseudoLocalize("عميل Ahmed")).toContain("عميل");
  });
});

describe("edge cases", () => {
  it.each(["", " ", "   ", "—", "...", "100%", "{count}", "{n, number}", "https://example.com", "a.b@example.com", "12:30"])("returns %j unchanged (nothing to transform)", (text) => {
    expect(pseudoLocalize(text)).toBe(text);
  });

  it("keeps whitespace and punctuation around the text", () => {
    expect(pseudoLocalize("  Hello,   world!  ")).toBe("⟦  Ĥéĺĺó,   ŵóŕĺď~~~~~~~!  ⟧");
  });

  it("escapes apostrophes the ICU way and keeps quoted braces as plain text", () => {
    const out = pseudoLocalize("Don't say '{literal}' here");
    const ast = parse(out);
    expect(ast.some(isArgumentElement)).toBe(false); // '{literal}' is text, not an argument
    expect(literals(ast).join("")).toContain("'"); // the apostrophe survived the round trip
    expect(printAST(ast)).toBe(out);
  });

  it("handles a plain apostrophe at the end and doubled apostrophes", () => {
    for (const text of ["It''s done", "Agents' notes", "'quoted' word", "Don't"]) {
      const out = pseudoLocalize(text);
      expect(() => parse(out), text).not.toThrow();
      expect(literals(parse(out)).join("")).toContain("'");
    }
  });

  it("handles nested structures several levels deep", () => {
    const deep = "{a, select, x {{b, plural, one {<b>one {c}</b>} other {{c, select, y {# deep} other {# more}}}}} other {fallback}}";
    const out = pseudoLocalize(deep);
    expect(() => parse(out)).not.toThrow();
    expect(innerShape(out)).toEqual(wrapped(deep));
  });
});

describe("already-transformed input", () => {
  it("is returned unchanged: the generator is idempotent", () => {
    for (const sample of SAMPLES) {
      const once = pseudoLocalize(sample);
      expect(isPseudoLocalized(once)).toBe(true);
      expect(pseudoLocalize(once)).toBe(once);
      expect(pseudoLocalize(pseudoLocalize(once))).toBe(once);
    }
  });

  it("recognises only a message that starts with the opening and ends with the closing marker", () => {
    expect(isPseudoLocalized("⟦abc⟧")).toBe(true);
    expect(isPseudoLocalized("abc")).toBe(false);
    expect(isPseudoLocalized("⟦abc")).toBe(false);
    expect(isPseudoLocalized("abc⟧")).toBe(false);
    expect(isPseudoLocalized(null)).toBe(false);
  });

  it("still validates it: an already-transformed but malformed message is rejected", () => {
    expect(() => pseudoLocalize("⟦Hello {name⟧")).toThrow(PseudoLocaleError);
  });
});

describe("malformed input", () => {
  it.each(["Hello {name", "<b>unclosed", "{n, plural, one {x}}", "{a,}", "{n, plural, other {# x}", "{x, select}", "Hello {name} {", "</b>"])("rejects %j with a clear error", (text) => {
    let error: unknown;
    try {
      pseudoLocalize(text);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PseudoLocaleError);
    expect((error as Error).message).toMatch(/^Malformed ICU message \(/);
    expect((error as Error).message).toContain(JSON.stringify(text));
  });

  it.each([null, undefined, 1, true, {}, ["x"]])("rejects the non-string %j", (value) => {
    expect(() => pseudoLocalize(value as unknown as string)).toThrow(PseudoLocaleError);
  });
});

describe("valid ICU after transformation", () => {
  it.each(SAMPLES)("parses again, prints back to itself and keeps the structure: %j", (sample) => {
    const out = pseudoLocalize(sample);
    const ast = parse(out);
    expect(printAST(ast)).toBe(out); // print/parse round trip is stable
    expect(innerShape(out)).toEqual(wrapped(sample)); // the structural check is done on the whole AST, not with isStructurallySame alone
  });

  it("each argument name of the source is still an argument of the result", () => {
    const names = (els: MessageFormatElement[]): string[] =>
      els.flatMap((el) => {
        if (isLiteralElement(el) || isPoundElement(el)) return [];
        if (isTagElement(el)) return names(el.children);
        if (isPluralElement(el) || isSelectElement(el)) return [el.value, ...Object.values(el.options).flatMap((o) => names(o.value))];
        return [el.value];
      });
    for (const sample of SAMPLES) expect(names(parse(pseudoLocalize(sample))).sort()).toEqual(names(parse(sample)).sort());
  });
});

describe("formatted output (next-intl's own formatter)", () => {
  const messages = {
    greeting: "Hello {name}, you have {count, number} new leads",
    deals: "{n, plural, =0 {No deals} one {# deal} other {# deals}}",
    amount: "Total {amount, number}",
  };
  // While messages/en.json is empty, the AppConfig augmentation types every key as `never`: this test-only alias gives the formatter a loose signature.
  type Format = (key: string, values?: Record<string, string | number>) => string;
  const original = createTranslator({ locale: "en", messages }) as unknown as Format;
  const pseudo = createTranslator({ locale: "en", messages: pseudoLocalizeCatalogue(messages) }) as unknown as Format;

  it("keeps the dynamic values exactly as given", () => {
    const text = pseudo("greeting", { name: "Fatima", count: 1234 });
    expect(text.startsWith(OPEN_MARK) && text.endsWith(CLOSE_MARK)).toBe(true);
    expect(text).toContain("Fatima"); // an interpolated value is never transformed
    expect(text).toContain("1,234"); // numbers are still formatted by the formatter
    expect(original("greeting", { name: "Fatima", count: 1234 })).toBe("Hello Fatima, you have 1,234 new leads");
  });

  it("selects the same plural branch as English for 0, 1, 2 and 1000, with # replaced by the formatted count", () => {
    for (const n of [0, 1, 2, 1000]) {
      const english = original("deals", { n });
      const text = pseudo("deals", { n });
      expect(text.startsWith(OPEN_MARK), `n=${n}`).toBe(true);
      expect(text.replace(/[^0-9,]/g, "")).toBe(english.replace(/[^0-9,]/g, "")); // same digits, in the same place
      expect(text.includes("ś~"), `n=${n}`).toBe(n !== 1 ? true : false); // the plural form ("deals") for everything but one
    }
  });

  it("is longer than the English text for every message", () => {
    expect(pseudo("greeting", { name: "A", count: 1 }).length).toBeGreaterThan(original("greeting", { name: "A", count: 1 }).length);
    expect(pseudo("amount", { amount: 5 })).toContain("5");
  });
});

describe("catalogues", () => {
  it("transforms every message of a nested catalogue and keeps keys and structure", () => {
    const catalogue = { common: { save: "Save", cancel: "Cancel", nested: { hint: "Use {name}" } }, leads: { title: "Leads", count: "{n, plural, one {# lead} other {# leads}}" }, empty: {} };
    const out = pseudoLocalizeCatalogue(catalogue);
    expect(Object.keys(out)).toEqual(["common", "leads", "empty"]);
    expect(Object.keys(out.common as object)).toEqual(["save", "cancel", "nested"]);
    expect(out.common).toMatchObject({ save: "⟦Śáṽé~⟧", cancel: "⟦Çáńçéĺ~~⟧" });
    expect(((out.common as Record<string, unknown>).nested as Record<string, string>).hint).toContain("{name}");
    expect(out.empty).toEqual({});
    expect(pseudoLocalizeCatalogue({})).toEqual({}); // the real messages/en.json today
  });

  it("does not modify its input", () => {
    const catalogue = { a: { b: "Hello" } };
    const copy = JSON.parse(JSON.stringify(catalogue));
    pseudoLocalizeCatalogue(catalogue);
    expect(catalogue).toEqual(copy);
  });

  it("names the key of a malformed message, and rejects non-message values", () => {
    expect(() => pseudoLocalizeCatalogue({ a: { b: "Hello {name" } })).toThrow(/^a\.b: Malformed ICU message/);
    expect(() => pseudoLocalizeCatalogue({ a: 1 as unknown as string })).toThrow(/at a/);
    expect(() => pseudoLocalizeCatalogue({ a: ["x"] as unknown as string })).toThrow(PseudoLocaleError);
    expect(() => pseudoLocalizeCatalogue(null as unknown as Record<string, string>)).toThrow(PseudoLocaleError);
  });
});

describe("the generator stays outside the application (Phase 1.7a)", () => {
  const root = path.resolve(__dirname, "../..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? files(full) : [full];
    });

  it("only the pseudo-locale wiring mentions it: the build flag files, the next config, the Playwright config and the E2E pseudo specs", () => {
    const users = [...files(path.join(root, "src")), ...files(path.join(root, "e2e")), path.join(root, "next.config.mjs"), path.join(root, "playwright.config.ts")]
      .filter((file) => !file.endsWith(".test.ts")) // tests may use it (the catalogue test feeds it the real messages)
      .filter((file) => /pseudo-locale|en-XA/i.test(readFileSync(file, "utf8")))
      .map((f) => path.relative(root, f).split(path.sep).join("/"));
    expect(users.sort()).toEqual(["e2e/locale-isolation.spec.ts", "e2e/pseudo.spec.ts", "e2e/stack.mjs", "next.config.mjs", "playwright.config.ts", "src/i18n/enabled.ts", "src/i18n/messages.ts", "src/i18n/server-locale.ts"]);
  });

  it("en-XA is not enabled: SUPPORTED holds the real languages only and no en-XA catalogue exists", () => {
    expect([...SUPPORTED]).toEqual(["en", "ar"]);
    expect(readdirSync(path.join(root, "messages"))).toEqual(["ar.json", "en.json"]);
  });

  it("uses the declared ICU parser (exact version), reads nothing from disk and has no environment or time dependence", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies["@formatjs/icu-messageformat-parser"]).toBe("3.5.23");
    const code = readFileSync(path.join(root, "scripts/pseudo-locale.mjs"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/node:fs|readFile|writeFile|process\.env|Date\.now|new Date|Math\.random|fetch\(/);
    expect(code).toMatch(/from "@formatjs\/icu-messageformat-parser"/);
  });
});

// ---- Phase 1.7a focused verification gate -------------------------------------------------------------------------------------------------------

describe("expansion contract (about 35% of the transformable literal text)", () => {
  const fillers = (text: string) => (text.match(/~/g) ?? []).length;

  it.each([
    ["Hello", 2], // 5 characters, 35% = 1.75 -> 2
    ["Hi, you!", 3], // 8 characters: the space and the punctuation count (2.8 -> 3)
    ["Call 100 now", 3], // 12 characters minus the protected number (3) = 9 -> 3.15 -> 3
    ["See PR-00042 now", 3], // the reference code is excluded: 16 - 8 = 8 -> 2.8 -> 3
    ["Write to a@b.co or call 555", 6], // the e-mail address (6) and the number (3) are excluded: 27 - 9 = 18 -> 6.3 -> 6
  ])("%j gets %i filler characters", (text, expected) => {
    expect(fillers(pseudoLocalize(text))).toBe(expected);
  });

  it("counts spaces and punctuation: the same letters with more punctuation get more filler", () => {
    expect(fillers(pseudoLocalize("Hiyou"))).toBe(2); // 5 characters
    expect(fillers(pseudoLocalize("Hi, you!"))).toBe(3); // the same letters, 8 characters
  });

  it("excludes protected tokens from the length: a token-only message does not grow at all", () => {
    for (const text of ["PR-00042", "https://example.com/a", "crm_lang", "a@b.co", "2026-11-21", "{n, number}"]) expect(pseudoLocalize(text)).toBe(text);
  });

  it("is applied per literal, so the whole message is NOT guaranteed to grow by exactly 35%", () => {
    const messages = ["Hello", "Save {x} now", "{n, plural, one {# deal} other {# deals}}", "Write to a@b.co or call 555"];
    for (const message of messages) {
      const ratio = pseudoLocalize(message).length / message.length;
      expect(ratio, message).toBeGreaterThan(1.0);
      expect(Math.abs(ratio - 1.35), message).toBeGreaterThan(0.001); // never an exact 35% for the whole message: markers, rounding and protected parts differ
    }
  });
});

describe("marker-based idempotence: a genuine source message that is already wrapped in the markers", () => {
  it.each(["⟦Draft⟧", "⟦Draft⟧ and ⟦Final⟧", "⟦ Save ⟧ now ⟦done⟧", "⟦{name}⟧"])("%j is classified as already transformed and returned unchanged (a known false positive of the policy)", (source) => {
    expect(isPseudoLocalized(source)).toBe(true);
    expect(pseudoLocalize(source)).toBe(source); // the text inside is NOT expanded, although it is original English
  });

  it.each(["⟦Save changes", "Save changes⟧", " ⟦Save⟧", "⟦Save⟧ ", "Use ⟦this⟧ mark"])("%j is not wrapped on both ends, so it is transformed normally", (source) => {
    expect(isPseudoLocalized(source)).toBe(false);
    const out = pseudoLocalize(source);
    expect(out).not.toBe(source);
    expect(isPseudoLocalized(out)).toBe(true);
    expect(pseudoLocalize(out)).toBe(out); // and the result is stable (idempotent) even when the source contained a marker
  });

  it("the policy never makes the generator non-idempotent, whatever the input", () => {
    for (const source of ["⟦Draft⟧", "⟦A", "B⟧", " ⟦C⟧", "plain", "", "{n}", ...SAMPLES]) {
      const once = pseudoLocalize(source);
      expect(pseudoLocalize(once), source).toBe(once);
    }
  });
});

describe("semantic equivalence (formatting the original and the transformed message with next-intl's formatter)", () => {
  // The transformation only changes literal text, so undoing it (accents back to ASCII, fillers and markers removed) must give exactly the English
  // output for the SAME values: same plural/select branch, same numbers, dates and interpolated values.
  const LOWER = "áƀçďéƒĝĥíĵķĺḿńóṕǫŕśťúṽŵẍýž";
  const UPPER = "ÁƁÇĎÉƑĜĤÍĴĶĹḾŃÓṔǪŔŚŤÚṼŴẌÝŽ";
  const BACK = new Map<string, string>();
  for (let i = 0; i < 26; i++) {
    BACK.set(LOWER[i], String.fromCharCode(97 + i));
    BACK.set(UPPER[i], String.fromCharCode(65 + i));
  }
  const undo = (text: string) => [...text].map((ch) => BACK.get(ch) ?? ch).join("").replace(/[~⟦⟧]/g, "");

  type Values = Record<string, unknown>;
  type Format = ((key: string, values?: Values) => string) & { rich: (key: string, values?: Values) => unknown };
  const MESSAGES = {
    deals: "{n, plural, =0 {No deals yet} one {# deal} other {# deals}}",
    offset: "{n, plural, offset:1 =0 {Nobody} =1 {Only you} one {You and # other} other {You and # others}}",
    ordinal: "{n, selectordinal, one {#st lead} two {#nd lead} few {#rd lead} other {#th lead}}",
    gender: "{g, select, female {She has {n, plural, one {# lead} other {# leads}}} male {He has {n, plural, one {# lead} other {# leads}}} other {They have {n, plural, one {# lead} other {# leads}}}}",
    money: "Total {amount, number, ::currency/EGP} ({share, number, ::percent}) for {name}",
    when: "Viewing on {d, date, short} at {d, time, short}",
    apostrophes: "Don't worry, it's {name}'s file: '{literal}' stays text",
    rich: "Read <b>the {what}</b> and <i>accept</i> the <link>terms</link>",
  };
  // While messages/en.json is empty the AppConfig augmentation types every key as `never`: this test-only alias gives the formatter a loose signature.
  const make = (messages: object): Format => createTranslator({ locale: "en", timeZone: "UTC", messages }) as unknown as Format;
  const original = make(MESSAGES);
  const pseudo = make(pseudoLocalizeCatalogue(MESSAGES));
  const compare = (key: keyof typeof MESSAGES, values: Values) => expect(undo(pseudo(key, values)), `${key} ${JSON.stringify(values)}`).toBe(original(key, values));

  it("plural: the same branch and the same formatted count for every representative value", () => {
    for (const n of [0, 1, 2, 3, 5, 11, 21, 100, 1000, 1234567]) compare("deals", { n });
  });

  it("plural with an offset and exact-value clauses", () => {
    for (const n of [0, 1, 2, 3, 10]) compare("offset", { n });
  });

  it("selectordinal", () => {
    for (const n of [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101]) compare("ordinal", { n });
  });

  it("select with a plural nested in every branch, including a value that falls to `other`", () => {
    for (const g of ["female", "male", "other", "unknown"]) for (const n of [1, 2]) compare("gender", { g, n });
  });

  it("number skeletons, dates and times, and an interpolated value that is never transformed", () => {
    for (const amount of [0, 5, 1250.5, 1e6]) compare("money", { amount, share: 0.25, name: "Fatima" });
    compare("when", { d: new Date(Date.UTC(2026, 10, 21, 14, 5)) });
    expect(pseudo("money", { amount: 1, share: 0.5, name: "Fatima" })).toContain("Fatima");
  });

  it("apostrophes and quoted braces", () => {
    compare("apostrophes", { name: "Sara" });
    expect(pseudo("apostrophes", { name: "Sara" })).toContain("{ĺíťéŕáĺ"); // '{literal}' is plain text: it is shown with its braces, transformed
  });

  it("rich text: the tag functions receive the same chunks, in the same order, around the transformed text", () => {
    const wrap = (tag: string) => (chunks: unknown) => `<${tag}>${Array.isArray(chunks) ? chunks.join("") : String(chunks)}</${tag}>`;
    const values = { what: "policy", b: wrap("b"), i: wrap("i"), link: wrap("a") };
    const join = (r: unknown) => (Array.isArray(r) ? r.join("") : String(r));
    expect(undo(join(pseudo.rich("rich", values)))).toBe(join(original.rich("rich", values)));
    expect(join(pseudo.rich("rich", values))).toMatch(/<b>.*policy.*<\/b>/); // the interpolated value is inside the bold tag, untouched
  });

  it("the printer's normalization (spacing, plural clause order) does not change what is formatted", () => {
    const printed = pseudoLocalize(MESSAGES.deals); // `=0` is written first in the source
    expect(printed.indexOf("=0")).toBeGreaterThan(printed.indexOf("other")); // the printer moved the exact clause after `other`
    const plural = parse(printed).find(isPluralElement);
    expect(plural && Object.keys(plural.options).sort()).toEqual(["=0", "one", "other"].sort());
    for (const n of [0, 1, 2, 7]) expect(undo(pseudo("deals", { n }))).toBe(original("deals", { n })); // and the exact clause still wins for 0
  });
});

describe("protected tokens in realistic sentences", () => {
  it("URLs, e-mail addresses, reference codes and snake_case identifiers survive byte for byte", () => {
    const sentence = "Email support@keystone-crm.com or open https://crm.example.com/help/leads?ref=PR-00042#top about deal PR-00042 (cookie crm_lang, field first_name) for details.";
    const out = pseudoLocalize(sentence);
    for (const token of ["support@keystone-crm.com", "https://crm.example.com/help/leads?ref=PR-00042#top", "PR-00042", "crm_lang", "first_name"]) expect(out, token).toContain(token);
    expect(out).toContain("ďéťáíĺś"); // and the words around them are transformed
  });

  it("tokens inside rich-text tags and plural branches are protected too", () => {
    const out = pseudoLocalize("<a>support@x.com</a> and {n, plural, one {see https://x.io/a} other {see PR-1}}");
    expect(out).toContain("<a>support@x.com</a>");
    expect(out).toContain("https://x.io/a");
    expect(out).toContain("PR-1");
  });

  // Characterization of AMBIGUOUS cases: recorded as they are today, NOT endorsed; the heuristic list is not expanded without approval.
  it.each([
    ["a URL followed by sentence punctuation keeps the punctuation inside the protected token", "Visit https://example.com.", "https://example.com.⟧"],
    ["a version number keeps its digits but its letter prefix is transformed", "Version v1.2.3 now", "ṽ1.2.3"],
    ["letters next to digits are transformed (only the digit run is protected), and the filler can land between a letter and a digit that ends the text", "Use iOS17 or 2FA or Q4", "íÓŚ17 óŕ 2ƑÁ óŕ Ǫ~~~~~~4⟧"],
    ["a one-letter reference prefix is not a reference code", "Ref A-100 and AB-1", "Á-100"],
    ["leading and trailing underscores are not part of a snake_case token", "Use _private or trailing_ or first_name", "_ṕŕíṽáťé"],
    ["an address without a dotted domain is not recognised as an e-mail address", "Mail user@host or a@b", "úśéŕ@ĥóśť"],
  ])("%s", (_what, text, expected) => {
    expect(pseudoLocalize(text)).toContain(expected);
  });

  it("every ambiguity above still yields valid ICU that parses and prints back to itself", () => {
    for (const text of ["Visit https://example.com.", "Version v1.2.3 now", "Use iOS17 or 2FA or Q4", "Ref A-100 and AB-1", "Use _private or trailing_", "Mail user@host or a@b"]) {
      const out = pseudoLocalize(text);
      expect(printAST(parse(out)), text).toBe(out);
    }
  });
});
