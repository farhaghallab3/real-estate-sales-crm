/** @type {import('next').NextConfig} */

// Two ways to reach Django:
//  - Production (Vercel): set NEXT_PUBLIC_API_URL; the browser calls the API directly, no proxy needed.
//  - Local / Docker: leave it unset; Next proxies /api and /media to BACKEND_INTERNAL_URL.
const publicApi = process.env.NEXT_PUBLIC_API_URL;
const internalApi =
  process.env.BACKEND_INTERNAL_URL || (process.env.NODE_ENV !== "production" ? "http://localhost:8000" : "");

const nextConfig = {
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

export default nextConfig;
