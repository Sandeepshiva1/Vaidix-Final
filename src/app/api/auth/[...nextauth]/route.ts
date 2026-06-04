// NextAuth v5 catch-all route handler.
// Handles: /api/auth/signin, /api/auth/signout, /api/auth/session,
// /api/auth/providers, /api/auth/csrf, /api/auth/callback/credentials.

import { handlers } from '@/auth';
export const { GET, POST } = handlers;
