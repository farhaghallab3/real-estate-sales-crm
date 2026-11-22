import { SUPPORTED } from "./config";

/** The pseudo-locale of the layout tests (accented, about 35% longer English; scripts/pseudo-locale.mjs). It is NOT a language of the product. */
export const PSEUDO_LOCALE = "en-XA";

/**
 * The languages THIS BUILD accepts: the supported ones, and the pseudo-locale only when the build was made with `I18N_PSEUDO=1` (the E2E stack does that,
 * in its own build; nothing else sets it). The flag is read at BUILD time (next.config.mjs inlines it), so in every other build the condition is the constant
 * `false`, the pseudo-locale branch is removed from the bundle, and no cookie, header or setting can switch it on at run time. `SUPPORTED` itself, the
 * language resolution rules and the production behaviour do not change.
 */
export const ENABLED_LANGUAGES: readonly string[] = process.env.I18N_PSEUDO === "1" ? [...SUPPORTED, PSEUDO_LOCALE] : SUPPORTED;
