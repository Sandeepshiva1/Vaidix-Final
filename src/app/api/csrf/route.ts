// HARDENING-PLAN item #15 — bootstrap a CSRF token cookie for the SPA.
// Browser fetches GET /api/csrf on first load (or after sign-in); server
// either confirms the existing token or mints a new one and sets the cookie.
// Response body returns the token so the SPA can keep it in memory and
// echo it on the x-csrf-token header for mutations.

import { NextResponse } from 'next/server';
import { ensureCsrfCookie } from '@/server/services/api-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const token = await ensureCsrfCookie();
  return NextResponse.json(
    { ok: true, data: { csrfToken: token } },
    { headers: { 'cache-control': 'no-store' } }
  );
}
