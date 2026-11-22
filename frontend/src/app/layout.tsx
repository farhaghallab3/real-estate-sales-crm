import type { Metadata, Viewport } from "next";

import { CompanyProvider, DEFAULT_COMPANY, type CompanyConfig } from "@/lib/company";

import { Providers } from "./providers";
import "./globals.css";

// Branding is read at request time from this instance's own backend, so ONE build serves every customer.
export const dynamic = "force-dynamic";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? process.env.BACKEND_INTERNAL_URL ?? "").trim().replace(/\/+$/, "") ||
  (process.env.NODE_ENV !== "production" ? "http://localhost:8000" : "");

async function loadCompany(): Promise<CompanyConfig | null> {
  if (!API_BASE) return null;
  try {
    const res = await fetch(`${API_BASE}/api/config/`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<CompanyConfig>;
    return { ...DEFAULT_COMPANY, ...data };
  } catch {
    return null; // backend unreachable: render with the defaults, the browser retries
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const company = (await loadCompany()) ?? DEFAULT_COMPANY;
  return {
    title: { default: `${company.company_name} — ${company.workspace_label}`, template: `%s · ${company.company_name}` },
    description: "Real estate sales CRM",
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#463F3A",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const company = await loadCompany();
  const active = company ?? DEFAULT_COMPANY;
  return (
    <html lang={active.language} dir={active.direction}>
      <body>
        <CompanyProvider initial={company}>
          <Providers>{children}</Providers>
        </CompanyProvider>
      </body>
    </html>
  );
}
