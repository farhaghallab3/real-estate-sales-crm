import i18next from "eslint-plugin-i18next";

// The localization lint guard (Phase 1.5): visible text must come from the message catalogue, not from a literal in a component.
//
//  * `npm run lint` shows every existing literal as a WARNING (eslint.config.mjs uses these configs with severity "warn"), then runs the same rule
//    at severity "error" against the committed baseline `eslint-i18n-baseline.json` (eslint.i18n.config.mjs): a literal that is not in the baseline
//    fails the build. `npm run lint:i18n` is that second step on its own.
//  * The baseline is a per-file COUNT (ESLint bulk suppressions), written once and then only edited by a person:
//      - it is never regenerated or pruned by any script (regenerate: `eslint -c eslint.i18n.config.mjs --suppress-rule i18next/no-literal-string
//        --suppressions-location eslint-i18n-baseline.json src`; prune: the same with `--prune-suppressions`; both need a review);
//      - KNOWN LIMITATION: because it counts per file, REPLACING one baselined literal with a different one in the same file keeps the count equal and
//        is not detected; adding one (count + 1) fails and reports every literal of that file, not only the new one;
//      - fixing a literal makes the check FAIL (exit 2, "suppressions left that do not occur anymore") until a person prunes the baseline: on purpose,
//        so that no slack is left for a new literal to hide in. The scripts do not pass `--pass-on-unpruned-suppressions`.
//  * Scope: `src/**/*.tsx` only. Not `e2e`, not tests, not type-check fixtures, not `src/i18n/`. Non-JSX visible strings (toast messages, labels in
//    `constants.ts`) are not covered yet: they belong to Phase 3 (message extraction), as does Arabic.

/** Files the guard applies to. */
export const I18N_FILES = ["src/**/*.tsx"];

/** Never checked, even inside I18N_FILES. */
export const I18N_IGNORES = ["src/i18n/**", "**/*.test.{ts,tsx}", "**/*.typecheck.ts"];

/** Directories already moved to the catalogue: any literal there is an ERROR, baseline or not. Since Phase 3 that is all of the application (the pages and the components). Globs ending in `.tsx`. */
export const MIGRATED = ["src/app/**/*.tsx", "src/components/**/*.tsx"];

const VISIBLE_ATTRIBUTES = [
  "placeholder", "title", "aria-label", "aria-description", "alt", "label", "hint", "description", "message", "helperText", "emptyLabel", "emptyTitle", "emptyText",
];

/** Rule options (measured in the Gate 1 spike: 514 literals in 31 files). */
export const I18N_OPTIONS = {
  mode: "jsx-only", // JSX text and JSX attributes
  "jsx-attributes": { include: VISIBLE_ATTRIBUTES }, // only attributes a person reads (not className, href, variant, size, type...)
  callees: { exclude: ["register", "t", "tr", "enums.label", "enums.options", "enums.labelOrRaw"] }, // form field names, calls of the translator (`t`, or `tr` in a file that already uses `t` for something else) and the enum labels (useEnums)
  // Replaces the plugin's default list on purpose: all-caps words ("OK", "CANCEL") are visible text, so they are NOT excluded.
  words: { exclude: [/^[a-z0-9_./:-]+$/, /^[\s\d\p{P}\p{S}]+$/u] }, // identifier-like lowercase tokens; digits, punctuation and symbols only
};

/**
 * The flat-config objects of the guard. `severity` is what an unmigrated file gets ("warn" for the everyday lint, "error" for the baseline check);
 * `migrated` (default: MIGRATED) always gets "error".
 */
export function i18nConfigs({ severity = "warn", migrated = MIGRATED } = {}) {
  const rule = (level) => ({ "i18next/no-literal-string": [level, I18N_OPTIONS] });
  return [
    { files: I18N_FILES, ignores: I18N_IGNORES, plugins: { i18next }, rules: rule(severity) },
    ...(migrated.length > 0 ? [{ files: migrated, ignores: I18N_IGNORES, plugins: { i18next }, rules: rule("error") }] : []),
  ];
}
