import { FlatCompat } from "@eslint/eslintrc";

import { i18nConfigs } from "./eslint.i18n.mjs";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

// Next.js' recommended rules (React, hooks, accessibility basics, no <a> for internal links) plus a short list of rules that
// protect the next phases: no physical-direction assumptions are enforced here (that is the i18n/RTL audit), only correctness.
export default [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "playwright-report/**", "test-results/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  // the stack runner is a command-line tool: printing progress is its job
  { files: ["e2e/stack.mjs"], rules: { "no-console": "off" } },
  // localization guard (Phase 1.5): visible literals in src/**/*.tsx are warnings here; `npm run lint` then fails on any literal that is not in the baseline
  ...i18nConfigs({ severity: "warn" }),
];
