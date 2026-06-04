// ════════════════════════════════════════════════════════════════════════════
// GET /api/calendar/ics/user/[userId]?token=...
// ════════════════════════════════════════════════════════════════════════════
// Subscribable per-user iCal feed. External calendar clients (Google Calendar,
// Outlook, Apple Calendar) poll this URL on their own schedule. Auth is the
// signed `token` query param stored on the user row — NO cookie / session.

import { NextResponse } from 'next/server';
import { buildFeedForUser, verifyFeedToken } from '@/server/services/ical-feed-service';

export async function GET(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  const { userId } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return new NextResponse('Missing token', { status: 401 });
  }

  const ok = await verifyFeedToken(userId, token);
  if (!ok) {
    return new NextResponse('Invalid or expired feed token', { status: 403 });
  }

  try {
    const ics = await buildFeedForUser(userId);
    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        // External calendars cache aggressively; keep it fresh.
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch (err) {
    console.error('[ical-feed] build failed', err);
    return new NextResponse('Feed build failed', { status: 500 });
  }
}
