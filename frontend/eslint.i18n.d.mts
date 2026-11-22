import type { Linter } from "eslint";

export const I18N_FILES: string[];
export const I18N_IGNORES: string[];
export const MIGRATED: string[];
export const I18N_OPTIONS: Record<string, unknown>;
export function i18nConfigs(options?: { severity?: "warn" | "error"; migrated?: string[] }): Linter.Config[];
