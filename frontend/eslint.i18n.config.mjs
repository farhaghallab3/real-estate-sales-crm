import base from "./eslint.config.mjs";
import { i18nConfigs } from "./eslint.i18n.mjs";

// The baseline check of the localization guard (`npm run lint:i18n`, and the second step of `npm run lint`): the everyday configuration with the
// guard raised from "warn" to "error", so that only literals that are NOT in eslint-i18n-baseline.json fail. See eslint.i18n.mjs.
const config = [...base, ...i18nConfigs({ severity: "error" })];

export default config;
