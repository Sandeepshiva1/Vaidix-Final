// ════════════════════════════════════════════════════════════════════════════
// NextAuth — Edge-compatible config (no Node-only imports)
// ════════════════════════════════════════════════════════════════════════════
// Separated so middleware (edge runtime) can use the config without pulling in
// bcrypt / Prisma (which are Node-only). The full config (auth.ts) extends this
// with the credentials provider.

import type { NextAuthConfig } from 'next-auth';
import type { Role } from '@prisma/client';
import type { SessionProgramMembership } from '@/types/next-auth';

/**
 * Routes reachable without an authenticated session. The proxy middleware and
 * the `authorized` callback below both consult this, so the public surface is
 * defined in exactly one place. Mutating members here (guest join, share/promo
 * token resolvers, invitation accept, webhooks, captions ingest) are also CSRF
 * exempt in the middleware — they don't rely on the session cookie and carry
 * their own token/signature/rate-limit protection.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    // Root is public — `src/app/page.tsx` resolves the right destination
    // server-side (dashboard vs. login). Treating it as public keeps the
    // middleware from prepending `?callbackUrl=http://...` to the URL.
    pathname === '/' ||
    pathname === '/login' ||
    // Frontend-only client demo prototype — no DB / auth needed.
    pathname === '/demo' ||
    pathname.startsWith('/demo/') ||
    pathname.startsWith('/invitations/') ||
    pathname === '/forgot-password' ||
    pathname.startsWith('/reset-password/') ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/invitations/verify/') ||
    pathname.startsWith('/api/invitations/accept/') ||
    pathname === '/api/classroom/webhooks/livekit' ||
    // Probes for orchestrator / load balancer. Public by design.
    pathname === '/api/health' ||
    pathname === '/api/ready' ||
    // CSRF token bootstrap — needed before sign-in.
    pathname === '/api/csrf' ||
    // Recording share links are public by design — anyone with a valid
    // (sha256-hashed at rest) token can view. The route handler enforces
    // token + optional password + expiry/revoke.
    /^\/api\/recordings\/share\/[^/]+$/.test(pathname) ||
    /^\/recordings\/share\/[^/]+$/.test(pathname) ||
    // Promo share links (`/p/[token]` and `/api/p/[token]`) follow the same
    // hashed-token model. The handler enforces expiry/revoke.
    /^\/p\/[^/]+$/.test(pathname) ||
    /^\/api\/p\/[^/]+$/.test(pathname) ||
    // Public session share landing (`/s/[token]`) — no login required to view.
    // The page resolves the hashed token and enforces expiry/revoke server-side.
    /^\/s\/[^/]+$/.test(pathname) ||
    // Live-captions ingest is bearer-token authed inside the route handler
    // (LiveKit Agent uses a shared secret, not session cookies).
    /^\/api\/classroom\/sessions\/[^/]+\/live-captions\/ingest$/.test(pathname) ||
    // Anonymous guest join (Teams parity) — the (call) route page + /guest API
    // perform their own openToAll + approvalStatus gate. /classroom/[id]/edit,
    // /study, /recording, /pre-questions have an extra path segment, are not
    // matched here, and still require auth via the (platform) layout chain.
    /^\/classroom\/[^/]+$/.test(pathname) ||
    /^\/api\/classroom\/sessions\/[^/]+\/guest$/.test(pathname)
  );
}

// In production every auth cookie is TLS-only (`Secure`) and carries a
// `__Secure-`/`__Host-` prefix. A `__Host-` cookie is rejected by the browser
// unless it was set over HTTPS with Path=/ and no Domain, which structurally
// prevents a forged session cookie being injected over cleartext or from a
// sibling subdomain. Locally (http://localhost) the prefixes + Secure flag are
// dropped so dev sign-in still works.
const useSecureCookies = process.env.NODE_ENV === 'production';
const securePrefix = useSecureCookies ? '__Secure-' : '';
const hostPrefix = useSecureCookies ? '__Host-' : '';

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: '/login',
    error: '/login',
  },
  // Self-hosted behind nginx: trust X-Forwarded-* so Auth.js resolves the
  // canonical https origin and therefore issues Secure cookies. REQUIRES the
  // reverse proxy to set `X-Forwarded-Proto: https` — without it Auth.js can
  // fall back to http and silently drop the Secure flag.
  trustHost: true,
  // Explicit, audit-visible cookie hardening. The session token is the bearer
  // credential — HttpOnly (no JS/XSS read via document.cookie), Secure (never
  // sent over http), SameSite=Lax (rides top-level navigations so the login
  // callbackUrl redirect works, but not cross-site subrequests → CSRF defense).
  cookies: {
    sessionToken: {
      name: `${securePrefix}authjs.session-token`,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: useSecureCookies },
    },
    callbackUrl: {
      name: `${securePrefix}authjs.callback-url`,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: useSecureCookies },
    },
    // No Domain + Path=/ ⇒ qualifies for the strongest `__Host-` prefix in prod.
    csrfToken: {
      name: `${hostPrefix}authjs.csrf-token`,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: useSecureCookies },
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 8, // 8 hours
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        // Explicit so the display name reaches the LiveKit token mint —
        // Auth.js's default user→token copy isn't always reliable when
        // the session object is custom-shaped.
        token.name = (user as unknown as { name?: string | null }).name ?? token.name ?? null;
        token.email = (user as unknown as { email?: string | null }).email ?? token.email ?? null;
        token.role = (user as unknown as { role: Role }).role;
        token.passwordVersion = (user as unknown as { passwordVersion: number }).passwordVersion;
        // Hydrate programs[] + activeProgramId from the authorize()
        // payload at sign-in. After this they live in the JWT for the
        // session lifetime; only the switcher mutates activeProgramId via
        // the `update` trigger below.
        token.programs = (user as unknown as { programs?: SessionProgramMembership[] }).programs ?? [];
        token.activeProgramId =
          (user as unknown as { activeProgramId?: string | null }).activeProgramId ?? null;
      }

      // Program switcher path. Client calls `update({ activeProgramId })`
      // after the POST /api/me/active-program endpoint succeeds. We only allow
      // switching to a program already in token.programs — the server endpoint
      // is the authoritative gate; this is a defense-in-depth.
      if (trigger === 'update' && session && typeof session === 'object') {
        const next = (session as { activeProgramId?: unknown }).activeProgramId;
        if (typeof next === 'string') {
          const allowed = (token.programs as SessionProgramMembership[] | undefined)?.some(
            (p) => p.programId === next,
          );
          if (allowed) token.activeProgramId = next;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        // Explicit copy: Auth.js defaults rely on user→token→session passing
        // intact, but our custom session.user augmentation can shadow it.
        session.user.name = (token.name as string | null | undefined) ?? session.user.name ?? null;
        session.user.email = (token.email as string | null | undefined) ?? session.user.email ?? null;
        session.user.role = token.role as Role;
        // Required by requireAuth() for the per-request passwordVersion
        // re-check (session-revocation enforcement).
        session.user.passwordVersion = (token.passwordVersion as number) ?? 0;
        session.user.programs = (token.programs as SessionProgramMembership[] | undefined) ?? [];
        session.user.activeProgramId = (token.activeProgramId as string | null | undefined) ?? null;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      if (isPublicPath(nextUrl.pathname)) return true;
      return !!auth?.user;
    },
  },
  providers: [], // populated in auth.ts
};
