import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { directionFor } from "@/i18n/config";
import { CompanyProvider } from "@/lib/company";
import { DEFAULT_COMPANY } from "@/lib/company-defaults";
import { getCompany } from "@/lib/company-server";

import { Providers } from "./providers";
import "./globals.css";

// Branding is read at request time from this instance's own backend, so ONE build serves every customer.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const company = (await getCompany()) ?? DEFAULT_COMPANY;
  const t = await getTranslations();
  return {
    title: { default: `${company.company_name} — ${company.workspace_label}`, template: `%s · ${company.company_name}` },
    description: t("shell.appDescription"),
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#463F3A",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const company = await getCompany();
  const locale = await getLocale(); // decided once, in src/i18n/request.ts
  const messages = await getMessages();
  return (
    <html lang={locale} dir={directionFor(locale)}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <CompanyProvider initial={company}>
            <Providers>{children}</Providers>
          </CompanyProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
