import type { NextConfig } from "next";

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
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The guard scanner needs the camera; nothing needs mic or location.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
