import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const supabaseUrl = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : undefined;
  } catch {
    return undefined;
  }
})();
const isLocalSupabase = !!supabaseUrl && ["127.0.0.1", "localhost"].includes(supabaseUrl.hostname);

/**
 * Baseline security headers for every response. The nonce-based
 * Content-Security-Policy is set per request in src/proxy.ts.
 */
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    rules: {
      // Tailwind CSS v4 compiler for Turbopack (dev + build).
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  images: {
    // Only PUBLIC buckets are ever rendered through next/image.
    remotePatterns: supabaseUrl
      ? (["product-images", "site-assets"] as const).map((bucket) => ({
          protocol: supabaseUrl.protocol.replace(":", "") as "http" | "https",
          hostname: supabaseUrl.hostname,
          port: supabaseUrl.port,
          pathname: `/storage/v1/object/public/${bucket}/**`,
        }))
      : [],
    // Only when Supabase itself runs on this machine (`supabase start`); a
    // deployed site always points at https://<ref>.supabase.co, so this is off.
    dangerouslyAllowLocalIP: isLocalSupabase,
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Installed app: the service worker must always be re-checked so updates reach phones quickly.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      // Private order links carry an access token: never leak it via Referer, never cache.
      {
        source: "/printing/jobs/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      {
        source: "/order-success/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
