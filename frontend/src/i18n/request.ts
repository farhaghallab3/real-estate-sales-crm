import { getRequestConfig } from "next-intl/server";

import { loadMessages } from "./messages";
import { resolveRequestLocale } from "./server-locale";

// The single place the request's language is decided (the next-intl plugin in next.config.mjs requires this module). The root layout reads it via getLocale().
export default getRequestConfig(async () => {
  const locale = await resolveRequestLocale();
  return { locale, messages: await loadMessages(locale) };
});
