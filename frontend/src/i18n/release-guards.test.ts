import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Final localization QA: guards for defects that the lint guard (JSX text and attributes only) cannot see.
const SRC = path.resolve(__dirname, "..");
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []));
const sources = walk(SRC).map((file) => ({ file: path.relative(SRC, file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }));

describe("browser dialogs", () => {
  it("window.confirm, alert and prompt never get a literal or template string: their text comes from the catalogue", () => {
    const offenders = sources.flatMap(({ file, text }) => (text.match(/\b(?:window\.)?(?:confirm|alert|prompt)\(\s*[`"']/g) ?? []).map((m) => `${file}: ${m}`));
    expect(offenders).toEqual([]);
  });

  it("the confirm dialogs that exist read the catalogue", () => {
    const calls = sources.flatMap(({ file, text }) => (text.match(/window\.confirm\([^)]*\)/g) ?? []).map((m) => `${file}: ${m}`));
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) expect(call).toMatch(/\btr?\("/);
  });
});

describe("English text hidden in code that the lint guard does not read", () => {
  // a default parameter ("placeholder = "Search…""), or a fallback after || or ?? ("... || "Passwords do not match""), in a component
  const hidden = /(?:\w+\s*=|\|\||\?\?)\s*"[A-Z][a-z]+(?: [A-Za-z']+)*[.…?]?"/;

  it("no component has an English default parameter or an English fallback (placeholders, empty labels, validation messages)", () => {
    const offenders = sources
      .filter(({ file }) => file.endsWith(".tsx"))
      .flatMap(({ file, text }) => text.split("\n").map((line, i) => ({ file, line, n: i + 1 })))
      .filter(({ line }) => !/^\s*(\/\/|\*)/.test(line) && !/className|key=|type=|role=|variant=|size=|aria-haspopup|^\s*import /.test(line) && hidden.test(line))
      .map(({ file, n, line }) => `${file}:${n}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
