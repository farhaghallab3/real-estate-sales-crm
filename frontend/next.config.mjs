import createNextIntlPlugin from "next-intl/plugin";

// Localization (ADR-0001): next-intl WITHOUT i18n routing (no locale prefixes, no middleware, no redirects); request config in src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */

// Two ways to reach Django:
//  - Production (Vercel): set NEXT_PUBLIC_API_URL; the browser calls the API directly, no proxy needed.
//  - Local / Docker: leave it unset; Next proxies /api and /media to BACKEND_INTERNAL_URL.
const publicApi = process.env.NEXT_PUBLIC_API_URL;
const internalApi =
  process.env.BACKEND_INTERNAL_URL || (process.env.NODE_ENV !== "production" ? "http://localhost:8000" : "");

// The pseudo-locale of the layout tests (src/i18n/enabled.ts) exists only in a build made with I18N_PSEUDO=1: the E2E stack builds that on its own. The flag is
// inlined into the bundles at build time (so a normal build contains no pseudo-locale code), and it is refused for the builds that are deployed.
const pseudo = process.env.I18N_PSEUDO === "1";
if (pseudo && (process.env.NEXT_OUTPUT === "standalone" || process.env.VERCEL)) {
  throw new Error("I18N_PSEUDO=1 is for the E2E test build only: it cannot be combined with NEXT_OUTPUT=standalone or a Vercel build.");
}

const nextConfig = {
  env: { I18N_PSEUDO: pseudo ? "1" : "" },
  // Self-hosted container builds use the standalone server (Dockerfile sets NEXT_OUTPUT=standalone);
  // Vercel uses its own output.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: false },
  async rewrites() {
    if (publicApi || !internalApi) return [];
    return [
      // Next strips trailing slashes while matching, but every Django route ends with one, so re-append it.
      { source: "/api/:path*", destination: `${internalApi}/api/:path*/` },
      // Property images are returned as relative /media/... URLs; proxy them (files, so no trailing slash).
      { source: "/media/:path*", destination: `${internalApi}/media/:path*` },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default withNextIntl(nextConfig);
