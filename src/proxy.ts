// ════════════════════════════════════════════════════════════════════════════
// NextAuth Proxy — protects all non-public routes
// ════════════════════════════════════════════════════════════════════════════
// Edge-runtime safe (uses auth.config only, no bcrypt/Prisma imports).

import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

export const { auth: proxy } = NextAuth(authConfig);

export default proxy;

export const config = {
  matcher: [
    // Run proxy on everything except static files + Next internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
