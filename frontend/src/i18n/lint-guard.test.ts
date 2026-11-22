import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import parser from "@typescript-eslint/parser";
import { ESLint } from "eslint";
import { afterAll, describe, expect, it } from "vitest";

import { I18N_IGNORES, MIGRATED, i18nConfigs } from "../../eslint.i18n.mjs";

// The localization lint guard (Phase 1.5): rule options and severity by file scope (ESLint's Node API, in memory), and the baseline check that
// `npm run lint` and `npm run lint:i18n` run (the ESLint command line: bulk suppressions exist only there; temporary baseline copies in the system temp folder).
const ROOT = path.resolve(__dirname, "../..");
const RULE = "i18next/no-literal-string";
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

const lang = { parser, parserOptions: { ecmaFeatures: { jsx: true } } };
const api = (severity: "warn" | "error", migrated: string[] = []) =>
  new ESLint({
    overrideConfigFile: true,
    cwd: ROOT,
    overrideConfig: [{ files: ["**/*.{ts,tsx}"], languageOptions: lang }, ...i18nConfigs({ severity, migrated })],
  });

/** The severities (1 = warn, 2 = error) of the guard's reports for `code` as if it were the file `file`; `null` when the file is outside the guard. */
async function reports(eslint: ESLint, file: string, code: string): Promise<number[] | null> {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  if (result.messages.some((m) => /ignored/i.test(m.message))) return null;
  return result.messages.filter((m) => m.ruleId === RULE).map((m) => m.severity);
}

const HELLO = `export function View() { return <p>Hello world</p>; }`;

describe("rule scope and severity (Node API, in memory)", () => {
  const warn = api("warn");

  it("warns about visible JSX text in an unmigrated source file", async () => {
    expect(await reports(warn, "src/app/x.tsx", HELLO)).toEqual([1]);
  });

  it.each([
    ["placeholder", `<input placeholder="Search leads" />`],
    ["title", `<button title="Close dialog" />`],
    ["aria-label", `<button aria-label="Open menu" />`],
    ["label", `<Field label="Email" />`],
    ["a visible string in a ternary", `<p>{ok ? "Your leads at a glance." : "Team leads."}</p>`],
  ])("detects a hard-coded %s", async (_what, jsx) => {
    const found = await reports(warn, "src/app/x.tsx", `export function View({ ok }: { ok: boolean }) { return <>${jsx}</>; }`);
    expect(found?.length, jsx).toBeGreaterThan(0);
    expect(new Set(found)).toEqual(new Set([1]));
  });

  it.each([
    ["className, href, type, variant, size, data-*", `<a className="p-4 text-sm" href="/leads" type="button" variant="primary" size="sm" data-x="y" />`],
    ["an already translated text, t(...)", `<p>{t("leads.title")}</p>`],
    ["a form field name, register(...)", `<input {...register("first_name")} />`],
    ["identifier-like lowercase tokens", `<p>{ok ? "pending" : "/users/"}</p>`],
    ["digits, punctuation and symbols only", `<p>— · 100% € 1,000 2026</p>`],
  ])("does not report %s", async (_what, jsx) => {
    const found = await reports(warn, "src/app/x.tsx", `declare const t: (k: string) => string; declare const register: (n: string) => object; declare const ok: boolean;\nexport function View() { return <>${jsx}</>; }`);
    expect(found, jsx).toEqual([]);
  });

  it("treats all-caps words as visible text (they are not excluded)", async () => {
    expect((await reports(warn, "src/app/x.tsx", `export function View() { return <b>CANCEL</b>; }`))?.length).toBe(1);
  });

  it("a migrated path is an ERROR, a path outside it stays a warning", async () => {
    const eslint = api("warn", ["src/migrated/**/*.tsx"]);
    expect(await reports(eslint, "src/migrated/x.tsx", HELLO)).toEqual([2]);
    expect(await reports(eslint, "src/migrated/deep/y.tsx", HELLO)).toEqual([2]);
    expect(await reports(eslint, "src/app/x.tsx", HELLO)).toEqual([1]);
  });

  it("the baseline check raises everything unmigrated to an error", async () => {
    expect(await reports(api("error"), "src/app/x.tsx", HELLO)).toEqual([2]);
  });

  it.each([
    ["src/i18n/x.tsx", "the i18n folder"],
    ["src/app/x.test.tsx", "a test file"],
    ["src/i18n/typed-messages.typecheck.ts", "a type-check fixture"],
    ["e2e/x.tsx", "the e2e folder"],
    ["src/lib/x.ts", "a non-JSX module"],
  ])("%s (%s) has no i18next report", async (file) => {
    const found = await reports(api("error", ["src/**/*.tsx"]), file, HELLO);
    expect(found === null || found.length === 0, file).toBe(true);
  });

  it("every directory of the application is migrated (Phase 3): a literal there is an ERROR even at warning severity", async () => {
    expect(MIGRATED).toEqual(["src/app/**/*.tsx", "src/components/**/*.tsx"]);
    expect(I18N_IGNORES).toEqual(expect.arrayContaining(["src/i18n/**"]));
    const eslint = api("warn", MIGRATED);
    expect(await reports(eslint, "src/app/(app)/leads/page.tsx", HELLO)).toEqual([2]);
    expect(await reports(eslint, "src/components/ui/x.tsx", HELLO)).toEqual([2]);
  });
});

// The command line, the way `npm run lint:i18n` runs it. ESLint applies bulk suppressions to files only (not to stdin), and the working tree must not be
// touched, so "a new violation" is simulated on the BASELINE side: a temporary copy of the baseline in the system temp folder that allows one literal
// fewer in a real file (or none for a file), which is exactly the situation after someone adds one.
function cli(targets: string[], baselineFile: string): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["node_modules/eslint/bin/eslint.js", "-c", "eslint.i18n.config.mjs", "--suppressions-location", baselineFile, ...targets], { cwd: ROOT });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (status) => resolve({ status, output }));
  });
}

type Baseline = Record<string, Record<string, { count: number }>>;

describe("the baseline check run by `npm run lint` and `npm run lint:i18n`", () => {
  const real = JSON.parse(read("eslint-i18n-baseline.json")) as Baseline;
  const dir = mkdtempSync(path.join(tmpdir(), "i18n-baseline-"));
  const made: string[] = [];
  const variant = (name: string, edit: (b: Baseline) => void) => {
    const copy = JSON.parse(JSON.stringify(real)) as Baseline;
    edit(copy);
    const file = path.join(dir, name);
    writeFileSync(file, JSON.stringify(copy));
    made.push(file);
    return file;
  };
  afterAll(() => {
    for (const file of made) unlinkSync(file); // only the files created above, then the (now empty) folder
    rmdirSync(dir);
  });

  it("the whole of src has no literal outside the catalogue: the check passes with the committed (empty) baseline", async () => {
    const run = await cli(["src"], "eslint-i18n-baseline.json");
    expect(run.status, run.output).toBe(0);
    expect(run.output).not.toContain(RULE);
  }, 180_000);

  it("a baseline entry that no longer occurs is stale: the check fails (exit 2) and says how to prune, so no slack lets a new literal hide", async () => {
    const baseline = variant("stale.json", (b) => {
      b["src/components/ui/modal.tsx"] = { [RULE]: { count: 1 } };
    });
    const run = await cli(["src/components/ui/modal.tsx"], baseline);
    expect(run.status, run.output).toBe(2);
    expect(run.output).toContain("--prune-suppressions");
  }, 120_000);

  it("the baseline file the scripts use is the committed one, and `--suppressions-location` is the only way it is read", () => {
    expect(pkg.scripts["lint:i18n"]).toContain("--suppressions-location eslint-i18n-baseline.json");
  });
});

describe("the scripts and the baseline file", () => {
  const second = "eslint -c eslint.i18n.config.mjs --suppressions-location eslint-i18n-baseline.json src";

  it("`npm run lint` runs the everyday lint and then the baseline check; `lint:i18n` is the baseline check alone", () => {
    expect(pkg.scripts["lint"]).toBe(`eslint src e2e && ${second}`);
    expect(pkg.scripts["lint:i18n"]).toBe(second);
  });

  it("no script calls npm recursively and none regenerates or prunes the baseline", () => {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      expect(command, name).not.toMatch(/\bnpm (run|exec)\b|\bnpx\b/);
      expect(command, name).not.toMatch(/--suppress-(all|rule)|--prune-suppressions/);
    }
  });

  it("the baseline is empty since Phase 3 (every literal moved to the catalogue); any entry would be only this rule, with a positive count, in a guarded source file", () => {
    const baseline = JSON.parse(read("eslint-i18n-baseline.json")) as Record<string, Record<string, { count: number }>>;
    const files = Object.keys(baseline);
    expect(files).toEqual([]);
    for (const file of files) {
      expect(Object.keys(baseline[file]), file).toEqual([RULE]);
      expect(Number.isInteger(baseline[file][RULE].count) && baseline[file][RULE].count > 0, file).toBe(true);
      expect(file, file).toMatch(/^src\/.*\.tsx$/);
      expect(file, file).not.toMatch(/^src\/i18n\/|\.test\.tsx$/);
    }
  });
});
