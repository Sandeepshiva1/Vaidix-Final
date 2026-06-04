// ════════════════════════════════════════════════════════════════════════════
// NextAuth — Edge-compatible config (no Node-only imports)
// ════════════════════════════════════════════════════════════════════════════
// Separated so middleware (edge runtime) can use the config without pulling in
// bcrypt / Prisma (which are Node-only). The full config (auth.ts) extends this
// with the credentials provider.

import type { NextAuthConfig } from 'next-auth';
import type { Role } from '@prisma/client';
import type { SessionProgramMembership } from '@/types/next-auth';

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: '/login',
    error: '/login',
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
        // W6.11: hydrate programs[] + activeProgramId from the authorize()
        // payload at sign-in. After this they live in the JWT for the
        // session lifetime; only the switcher mutates activeProgramId via
        // the `update` trigger below.
        token.programs = (user as unknown as { programs?: SessionProgramMembership[] }).programs ?? [];
        token.activeProgramId =
          (user as unknown as { activeProgramId?: string | null }).activeProgramId ?? null;
      }

      // W6.11: program switcher path. Client calls `update({ activeProgramId })`
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
        // re-check (HARDENING-PLAN item #13).
        session.user.passwordVersion = (token.passwordVersion as number) ?? 0;
        session.user.programs = (token.programs as SessionProgramMembership[] | undefined) ?? [];
        session.user.activeProgramId = (token.activeProgramId as string | null | undefined) ?? null;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isPublic =
        // Root is public — `src/app/page.tsx` resolves the right destination
        // server-side (dashboard vs. login). Treating it as public keeps the
        // middleware from prepending `?callbackUrl=http://...` to the URL.
        nextUrl.pathname === '/' ||
        nextUrl.pathname === '/login' ||
        // Frontend-only client demo prototype — no DB / auth needed.
        nextUrl.pathname === '/demo' ||
        nextUrl.pathname.startsWith('/demo/') ||
        nextUrl.pathname.startsWith('/invitations/') ||
        nextUrl.pathname === '/forgot-password' ||
        nextUrl.pathname.startsWith('/reset-password/') ||
        nextUrl.pathname.startsWith('/api/auth/') ||
        nextUrl.pathname.startsWith('/api/invitations/verify/') ||
        nextUrl.pathname.startsWith('/api/invitations/accept/') ||
        nextUrl.pathname === '/api/classroom/webhooks/livekit' ||
        // Probes for orchestrator / load balancer. Public by design.
        nextUrl.pathname === '/api/health' ||
        nextUrl.pathname === '/api/ready' ||
        // CSRF token bootstrap — needed before sign-in (HARDENING-PLAN #15).
        nextUrl.pathname === '/api/csrf' ||
        // Recording share links are public by design — anyone with a valid
        // (sha256-hashed at rest, HARDENING-PLAN #12) token can view. The
        // route handler enforces token + optional password + expiry/revoke.
        /^\/api\/recordings\/share\/[^/]+$/.test(nextUrl.pathname) ||
        /^\/recordings\/share\/[^/]+$/.test(nextUrl.pathname) ||
        // W9 — Promo share links (`/p/[token]` and `/api/p/[token]`) follow
        // the same hashed-token model. The handler enforces expiry/revoke;
        // middleware just needs to let the request through.
        /^\/p\/[^/]+$/.test(nextUrl.pathname) ||
        /^\/api\/p\/[^/]+$/.test(nextUrl.pathname) ||
        // Live-captions ingest is bearer-token authed inside the route handler
        // (LiveKit Agent uses a shared secret, not session cookies).
        /^\/api\/classroom\/sessions\/[^/]+\/live-captions\/ingest$/.test(nextUrl.pathname) ||
        // Anonymous guest join (Teams parity) — middleware lets these through
        // so the (call) route page + /guest API can perform their own
        // openToAll + approvalStatus gate. /classroom/[id]/edit, /study,
        // /recording, /pre-questions are NOT matched by this regex (they
        // have an additional path segment) and still require auth via the
        // (platform) layout chain.
        //   - /classroom/<id>         → renders authed live-session OR
        //                                <GuestPrejoin> OR redirects to
        //                                /login depending on openToAll.
        //   - /api/.../guest          → POST registers a guest + sets cookie;
        //                                GET polls + mints LiveKit token.
        //
        // Re-applied after a same-day revert (110f458) — the prior deploy
        // didn't rebuild the Edge middleware artefact, so the change appeared
        // not to work and got rolled back. NextAuth middleware lives in the
        // .next/server bundle; pulling auth.config.ts and restarting alone
        // won't pick it up. Re-deploy MUST include `docker compose ... build app`.
        /^\/classroom\/[^/]+$/.test(nextUrl.pathname) ||
        /^\/api\/classroom\/sessions\/[^/]+\/guest$/.test(nextUrl.pathname);
      if (isPublic) return true;
      if (!isLoggedIn) return false;
      return true;
    },
  },
  providers: [], // populated in auth.ts
};
