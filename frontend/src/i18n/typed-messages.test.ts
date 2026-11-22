import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// Typed message keys (ADR-0001 2.5): `AppConfig["Messages"]` makes a missing key or namespace a compile error.
//  - The REAL augmentation (global.d.ts, empty catalogue) is checked by `npm run typecheck`: src/i18n/typed-messages.typecheck.ts holds the negative cases.
//    An empty catalogue has no valid key, so the positive cases cannot be shown on it.
//  - This file proves BOTH directions with next-intl's real typings and a NON-EMPTY FIXTURE catalogue declared in memory: no dummy key is added to
//    messages/en.json, and no project file or configuration is touched. Production key coverage stays limited until real messages exist.
const DIR = path.resolve(__dirname, "__virtual__").replace(/\\/g, "/");

const FIXTURE_AUGMENTATION = `
export {};
declare module "next-intl" {
  interface AppConfig {
    Messages: { common: { save: string; cancel: string }; leads: { title: string; empty: { hint: string } } };
  }
}
`;

const VALID = `
import { useTranslations } from "next-intl";
export function valid() {
  const common = useTranslations("common");
  common("save");
  common("cancel");
  const leads = useTranslations("leads");
  leads("title");
  leads("empty.hint");
  const root = useTranslations();
  root("common.save");
  root("leads.empty.hint");
}
`;

// One error expected on every line that is marked with "// error".
const INVALID = `
import { useTranslations } from "next-intl";
export function invalid() {
  useTranslations("nope"); // error
  const common = useTranslations("common");
  common("missing"); // error
  common("save.extra"); // error
  const root = useTranslations();
  root("common.missing"); // error
  root("missing"); // error
  root("common.save");
}
`;

function check(files: Record<string, string>): { line: number; message: string }[] {
  const virtual = new Map(Object.entries(files).map(([name, text]) => [`${DIR}/${name}`, text]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    jsx: ts.JsxEmit.Preserve,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (f) => virtual.has(f) || fileExists(f);
  host.readFile = (f) => virtual.get(f) ?? readFile(f);
  host.getSourceFile = (f, languageVersion, onError, shouldCreate) => {
    const text = virtual.get(f);
    return text === undefined ? getSourceFile(f, languageVersion, onError, shouldCreate) : ts.createSourceFile(f, text, languageVersion, true);
  };
  const program = ts.createProgram({ rootNames: [...virtual.keys()], options, host });
  const out: { line: number; message: string }[] = [];
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    if (d.file && virtual.has(d.file.fileName)) out.push({ line: d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1, message });
    else out.push({ line: 0, message: `${d.file?.fileName ?? "(global)"}: ${message}` });
  }
  return out;
}

const markedLines = (text: string) =>
  text.split("\n").flatMap((l, i) => (l.includes("// error") ? [i + 1] : []));

describe("typed message keys with a non-empty fixture catalogue", () => {
  it("accepts every real namespace and key", () => {
    expect(check({ "fixture.d.ts": FIXTURE_AUGMENTATION, "valid.ts": VALID })).toEqual([]);
  }, 120_000);

  it("rejects each missing namespace and key, and only those", () => {
    const errors = check({ "fixture.d.ts": FIXTURE_AUGMENTATION, "invalid.ts": INVALID });
    expect(errors.map((e) => e.line)).toEqual(markedLines(INVALID));
    expect(errors.length).toBe(5);
  }, 120_000);

  it("control: without the augmentation the same invalid file compiles, so the check above really measures the types", () => {
    expect(check({ "invalid.ts": INVALID })).toEqual([]);
  }, 120_000);
});

describe("the real augmentation", () => {
  it("is declared for Messages only, from the English catalogue, and never for Locale", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(path.resolve(__dirname, "../../global.d.ts"), "utf8");
    expect(text).toMatch(/Messages:\s*typeof en/);
    expect(text).toMatch(/import type en from "\.\/messages\/en\.json"/);
    expect(text).not.toMatch(/^\s*Locale\s*:/m);
    expect(text).not.toMatch(/Record<string,\s*any>|\bas\s+any\b/);
  });
});
