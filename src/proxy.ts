// ════════════════════════════════════════════════════════════════════════════
// NextAuth Proxy — auth gate + CSRF enforcement + opaque-URL rewriting
// ════════════════════════════════════════════════════════════════════════════
// Edge-runtime safe (uses auth.config + the isomorphic secure-id helpers only,
// no bcrypt/Prisma imports).
//
// Next 16 renamed `middleware.ts` → `proxy.ts` and allows only ONE such file,
// so the former opaque-URL middleware is folded in here (step 3 below).
//
// Three responsibilities, all centralised here so individual route handlers
// can't forget them:
//   1. CSRF — every mutating (POST/PUT/PATCH/DELETE) request to a session-based
//      API route must carry a `x-csrf-token` header matching the `vaidix-csrf`
//      cookie (double-submit). Public token/guest/webhook/auth endpoints are
//      exempt — they don't rely on the session cookie and carry their own
//      token/signature/rate-limit protection.
//   2. Auth gate — non-public routes require a session (mirrors the
//      `authorized` callback's decision via the shared isPublicPath predicate).
//   3. Opaque-URL rewriting — keeps database ids out of the address bar for the
//      id-bearing route families (obfuscation + tamper-evidence, NOT authz).

import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig, isPublicPath } from './auth.config';
import { decodeId } from '@/lib/secure-id';

const { auth } = NextAuth(authConfig);

// ── Opaque-URL config (merged from the former src/middleware.ts) ──────────────
// seg = 0-based index of the id within pathname.split('/'). REWRITE-ONLY: a
// valid opaque token is served internally as its real id; everything else passes
// through untouched. We never redirect here (see the loop note in step 3).
const ID_ROUTES: { test: RegExp; seg: number }[] = [
  { test: /^\/session\//, seg: 2 },                    // /session/<id>/...
  { test: /^\/classroom\//, seg: 2 },                  // /classroom/<id>/...
  { test: /^\/api\/classroom\/sessions\//, seg: 4 },   // /api/classroom/sessions/<id>/...
];

const CSRF_COOKIE_NAME = 'vaidix-csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Mutating endpoints that authenticate by their own shared secret / signature /
// one-time token rather than the session cookie, so the double-submit check
// doesn't apply. Kept in sync with the public members of isPublicPath().
function isCsrfExempt(pathname: string): boolean {
  return (
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/csrf' ||
    pathname.startsWith('/api/invitations/accept/') ||
    pathname.startsWith('/api/invitations/verify/') ||
    pathname === '/api/invitations/check-email' ||
    pathname === '/api/classroom/webhooks/livekit' ||
    /^\/api\/classroom\/sessions\/[^/]+\/live-captions\/ingest$/.test(pathname) ||
    /^\/api\/classroom\/sessions\/[^/]+\/breakouts\/[^/]+\/agent-log\/ingest$/.test(pathname) ||
    /^\/api\/classroom\/sessions\/[^/]+\/guest$/.test(pathname) ||
    /^\/api\/recordings\/share\/[^/]+$/.test(pathname) ||
    /^\/api\/p\/[^/]+$/.test(pathname)
  );
}

// Constant-time string comparison. node:crypto's timingSafeEqual isn't
// available in the Edge runtime, so this is the equal-length XOR-accumulate
// equivalent. For a double-submit token (no server secret to leak) a plain
// compare would suffice, but constant-time keeps the property uniform with the
// Node-side requireCsrf helper.
function timingSafeStrEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function csrfFailure(): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: 'CSRF_REQUIRED', message: 'CSRF token missing or invalid' } },
    { status: 403 },
  );
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // 1. CSRF — enforce before anything else for mutating, non-exempt API routes.
  if (
    MUTATING_METHODS.has(req.method) &&
    pathname.startsWith('/api/') &&
    !isCsrfExempt(pathname)
  ) {
    const cookie = req.cookies.get(CSRF_COOKIE_NAME)?.value ?? '';
    const header = req.headers.get(CSRF_HEADER_NAME) ?? '';
    if (!cookie || !header || !timingSafeStrEqual(cookie, header)) {
      return csrfFailure();
    }
  }

  // 2. Auth gate — the functional middleware form bypasses the `authorized`
  // callback's redirect, so we reproduce it here (sign-in redirect with
  // callbackUrl) for non-public routes without a session.
  if (!isPublicPath(pathname) && !req.auth?.user) {
    const signInUrl = req.nextUrl.clone();
    signInUrl.pathname = '/login';
    signInUrl.searchParams.set('callbackUrl', req.nextUrl.href);
    return NextResponse.redirect(signInUrl);
  }

  // 3. Opaque-URL rewriting — REWRITE-ONLY, never redirect. For the id-bearing
  //    route families:
  //      • valid opaque token  → rewrite INTERNALLY to the real id (URL stays opaque)
  //      • raw id / tampered    → pass through verbatim; a tampered token then
  //                               404s at the route's own lookup.
  //
  //    We do NOT redirect raw ids to their opaque form. The app already performs
  //    its own redirects using raw ids (auth callbackUrl, canonical
  //    self-redirects, etc.); pairing those with a raw→opaque redirect here
  //    produced an infinite loop (ERR_TOO_MANY_REDIRECTS). Opaque URLs are
  //    instead introduced by encoding links at their source.
  for (const route of ID_ROUTES) {
    if (!route.test.test(pathname)) continue;
    const parts = pathname.split('/');
    const seg = parts[route.seg];
    if (!seg) break;

    const decoded = decodeId(seg);
    if (decoded !== seg) {
      // valid opaque token → serve the real id, keep the URL opaque
      parts[route.seg] = decoded;
      const url = req.nextUrl.clone();
      url.pathname = parts.join('/');
      return NextResponse.rewrite(url);
    }
    break;
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Run proxy on everything except static files + Next internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
