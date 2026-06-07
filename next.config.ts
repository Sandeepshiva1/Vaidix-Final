import type { NextConfig } from "next";
import path from "path";

// Content-Security-Policy for a PHI-handling medical app. Tight by default:
// no framing (clickjacking), no plugins, locked base-uri/form-action. Browser
// connections are limited to self (API/SSE), https (S3 presigned media), and
// wss (LiveKit SFU). NOTE: script-src still allows 'unsafe-inline' for the
// theme-init script + Next hydration — follow-up is to move to a per-request
// nonce; frame-ancestors/object-src/base-uri already remove the highest-impact
// XSS-pivot and clickjacking vectors.
// Dev (next dev / Turbopack HMR) needs eval() for fast-refresh + debug
// reconstruction; the production build never does. So we only relax script-src
// with 'unsafe-eval' in development — prod stays tight.
const isDev = process.env.NODE_ENV !== 'production';
// Slide/avatar/promo media is served as presigned URLs signed against the
// browser-facing S3 endpoint (S3_PUBLIC_ENDPOINT, falling back to S3_ENDPOINT).
// Locally that's MinIO over http://localhost:9000 — and crucially it stays http
// even when the app is run via `next build && next start` (NODE_ENV=production),
// so we MUST whitelist it by actual endpoint, not by NODE_ENV. Real prod points
// these at an https CloudFront/S3 domain, already covered by the `https:`
// source, so this only ever adds an insecure (http://) origin in local setups —
// prod CSP stays tight. https endpoints contribute nothing (the empty string).
function s3MediaOrigin(): string {
  const raw = process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || '';
  try {
    const { protocol, origin } = new URL(raw);
    return protocol === 'http:' ? ` ${origin}` : '';
  } catch {
    return '';
  }
}
const devS3 = s3MediaOrigin();
// Local dev runs the LiveKit SFU over ws://localhost:7880 (signal) + http for
// the /rtc/v1/validate fetch. Prod uses wss:// (already covered by `wss:`), so
// these insecure origins are dev-only on connect-src — prod CSP stays tight.
const devConnect = isDev ? ' http://localhost:9000 ws://localhost:7880 http://localhost:7880' : '';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  // The deck editor loads its slide fonts (Inter + the Google-Fonts family
  // picker) from fonts.googleapis.com (the @font-face stylesheet) with the
  // actual font files on fonts.gstatic.com — whitelist both, else the
  // stylesheet is CSP-blocked and slides fall back to the system font.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  `img-src 'self' data: blob: https:${devS3}`,
  `media-src 'self' blob: https:${devS3}`,
  // The shared whiteboard (tldraw) loads its UI + drawing fonts from its
  // versioned CDN. img-src/connect-src already permit https: so tldraw's icon
  // sprite + asset fetches resolve; fonts are the one class still blocked,
  // which left the whiteboard toolbar glyphs + drawn text in fallback fonts.
  // Scope the exception to tldraw's host instead of opening font-src to all
  // https. (Self-hosting tldraw assets under /public is the zero-external-
  // dependency hardening if a future review wants no third-party origin.)
  "font-src 'self' data: https://fonts.gstatic.com https://cdn.tldraw.com",
  `connect-src 'self' https: wss:${devConnect}`,
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
  // PDF rasterisation (faithful-import "Original" preview) runs server-side via
  // pdf-to-img → pdfjs-dist (legacy build uses top-level await) + @napi-rs/canvas
  // (prebuilt native binary). Bundling either breaks them, so keep them external
  // and let Node require them at runtime on the server only.
  serverExternalPackages: ['pdf-to-img', 'pdfjs-dist', '@napi-rs/canvas'],
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
