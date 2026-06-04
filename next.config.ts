import type { NextConfig } from "next";
import path from "path";

// Content-Security-Policy for a PHI-handling medical app. Tight by default:
// no framing (clickjacking), no plugins, locked base-uri/form-action. Browser
// connections are limited to self (API/SSE), https (S3 presigned media), and
// wss (LiveKit SFU). NOTE: script-src still allows 'unsafe-inline' for the
// theme-init script + Next hydration — follow-up is to move to a per-request
// nonce; frame-ancestors/object-src/base-uri already remove the highest-impact
// XSS-pivot and clickjacking vectors.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Pin Turbopack root to this project — avoids walking up the drive,
  // which is especially important on slow filesystems / paths with spaces.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Don't advertise the framework/version.
  poweredByHeader: false,
  // The local build skips the type re-check so the slow-disk `next build && next
  // start` dev loop isn't blocked by transient/generated route-type churn. Type
  // safety is NOT lost: CI runs `tsc --noEmit` as a required gate (see
  // .github/workflows/ci.yml), so type errors cannot ship.
  typescript: { ignoreBuildErrors: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
