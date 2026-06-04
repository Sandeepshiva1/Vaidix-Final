// ════════════════════════════════════════════════════════════════════════════
// NextAuth Proxy — auth gate + central CSRF enforcement for all routes
// ════════════════════════════════════════════════════════════════════════════
// Edge-runtime safe (uses auth.config only, no bcrypt/Prisma imports).
//
// Two responsibilities, both centralised here so individual route handlers
// can't forget them:
//   1. Auth gate — non-public routes require a session (mirrors the
//      `authorized` callback's decision via the shared isPublicPath predicate).
//   2. CSRF — every mutating (POST/PUT/PATCH/DELETE) request to a session-based
//      API route must carry a `x-csrf-token` header matching the `vaidix-csrf`
//      cookie (double-submit). Public token/guest/webhook/auth endpoints are
//      exempt — they don't rely on the session cookie and carry their own
//      token/signature/rate-limit protection.

import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig, isPublicPath } from './auth.config';

const { auth } = NextAuth(authConfig);

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

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Run proxy on everything except static files + Next internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
