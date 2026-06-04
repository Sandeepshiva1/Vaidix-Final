// ════════════════════════════════════════════════════════════════════════════
// iCal Feed Service — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Per-user subscribable calendar feed. A signed token stored on the user row
// authenticates the feed URL; external calendar clients (Google / Outlook /
// Apple) poll the URL without cookies, so token-in-URL is the auth.

import { randomBytes, timingSafeEqual } from 'crypto';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import {
  SessionApprovalStatus,
  SessionStatus,
} from '@prisma/client';
import { buildUserFeedIcs, sessionJoinUrl } from './ics-service';
import { buildSessionVisibilityWhere } from './sessions/visibility';

const FEED_WINDOW_DAYS_PAST = 30;
const FEED_WINDOW_DAYS_FUTURE = 180;

export async function getOrMintFeedToken(userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { icalFeedToken: true },
  });
  if (!user) throw new Error('USER_NOT_FOUND');
  if (user.icalFeedToken) return user.icalFeedToken;

  const token = randomBytes(24).toString('base64url');
  await db.user.update({ where: { id: userId }, data: { icalFeedToken: token } });
  return token;
}

export async function rotateFeedToken(userId: string): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await db.user.update({ where: { id: userId }, data: { icalFeedToken: token } });
  return token;
}

export function feedUrlFor(userId: string, token: string): string {
  const base = env.NEXTAUTH_URL.replace(/\/$/, '');
  return `${base}/api/calendar/ics/user/${userId}?token=${token}`;
}

function safeTokenEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function verifyFeedToken(userId: string, token: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { icalFeedToken: true, status: true },
  });
  if (!user?.icalFeedToken) return false;
  if (user.status !== 'ACTIVE') return false;
  return safeTokenEquals(user.icalFeedToken, token);
}

// ----------------------------------------------------------------------------
// Feed builder — returns the full .ics text for the user's upcoming sessions.
// Rules match calendar-service.buildVisibilityWhere — keep them in sync.
// ----------------------------------------------------------------------------
export async function buildFeedForUser(userId: string): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, name: true, activeProgramId: true },
  });
  if (!user) throw new Error('USER_NOT_FOUND');

  const from = new Date(Date.now() - FEED_WINDOW_DAYS_PAST * 24 * 3600 * 1000);
  const to = new Date(Date.now() + FEED_WINDOW_DAYS_FUTURE * 24 * 3600 * 1000);

  // Reuse the shared visibility helper so the feed and the in-app Classroom
  // list cannot drift. Same rule everywhere: cohort/invite/host scoping —
  // `openToAll` alone is link-only and not auto-listed.
  const visibility = await buildSessionVisibilityWhere({
    userId,
    role: user.role,
    activeProgramId: user.activeProgramId ?? undefined,
  });

  const sessions = await db.teachingSession.findMany({
    where: {
      ...(user.activeProgramId ? { programId: user.activeProgramId } : {}),
      deletedAt: null,
      approvalStatus: SessionApprovalStatus.APPROVED,
      status: { in: [SessionStatus.SCHEDULED, SessionStatus.LIVE] },
      AND: [
        {
          OR: [
            { scheduledEnd: { gt: from }, scheduledStart: { lt: to } },
            { recurrenceRule: { not: null } },
          ],
        },
        visibility,
      ],
    },
    select: {
      id: true,
      title: true,
      description: true,
      scheduledStart: true,
      scheduledEnd: true,
      recurrenceRule: true,
      recurrenceUntil: true,
      approvalStatus: true,
      host: { select: { name: true, email: true } },
    },
    orderBy: { scheduledStart: 'asc' },
  });

  return buildUserFeedIcs({
    calendarName: `Vaidix — ${user.name}`,
    events: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      start: s.scheduledStart,
      end: s.scheduledEnd,
      host: { name: s.host.name, email: s.host.email },
      joinUrl: sessionJoinUrl(s.id),
      recurrenceRule: s.recurrenceRule,
      recurrenceUntil: s.recurrenceUntil,
      status: 'CONFIRMED',
    })),
  });
}
