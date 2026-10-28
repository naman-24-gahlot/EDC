import type { NextConfig } from "next";

// Content-Security-Policy. What the browser may load or talk to: this site, plus Cloudflare's
// "I'm human" check (script + frame) and the breached-password range lookup. Data can't be sent
// anywhere else, and plugins, <base> and foreign form targets are blocked. Inline scripts stay
// allowed: per-request nonces would make the static pages (/register, /forgot) server-rendered on
// every visit. Dev needs eval for React's tooling.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://api.pwnedpasswords.com https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  experimental: {
    // Keep pages already visited in the browser for 2 minutes, so moving back and forth between
    // them makes no request. Every action calls router.refresh(), which discards this cache, and
    // each page shows when its data was fetched with a Refresh button. Sign-in and sign-out are
    // full page loads, so one account's cached pages are never shown to the next.
    staleTimes: { dynamic: 120 },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // No framing anywhere: the pass, the gate and the admin actions are all clickable UI.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The guard scanner needs the camera; nothing needs mic or location.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
      // Pass links work for whoever holds them: never indexed, cached or passed on as a referrer.
      ...["/v/:path*", "/print/:path*", "/api/pass/:path*"].map((source) => ({
        source,
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
        ],
      })),
    ];
  },
};

export default nextConfig;
