// ════════════════════════════════════════════════════════════════════════════
// /teacher/readiness/[sessionId] — Pre-session Readiness Dashboard (4.1.5)
// ════════════════════════════════════════════════════════════════════════════
// Faculty / PD / admin landing surface for "is the cohort prepared?". Reuses
// the deterministic computeSessionReadiness scorer; adds a 7-day engagement
// timeline computed straight from EngagementSignal so the timeline matches
// "what the resident actually did" rather than the score formula's lossy
// projection.

import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { Role, EngagementSignalKind } from '@prisma/client';
import {
  computeSessionReadiness,
  ReadinessAccessError,
} from '@/server/services/readiness/readiness-service';
import { ReadinessDashboardClient } from './readiness-client';

export const dynamic = 'force-dynamic';

const FACULTY_LIKE: Role[] = [Role.FACULTY, Role.PROGRAM_DIRECTOR, Role.ADMIN];

const ENGAGEMENT_KINDS = [
  EngagementSignalKind.PRE_READING_VIEWED,
  EngagementSignalKind.PRE_VIDEO_WATCHED,
  EngagementSignalKind.PRE_CASE_STARTED,
  EngagementSignalKind.PRE_CASE_COMPLETED,
];

interface DailyBucket {
  date: string;
  engaged: number;
  partial: number;
  loggedInOnly: number;
  weekday: string;
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function buildDailyTimeline(sessionId: string): Promise<DailyBucket[]> {
  // Window: today + 6 prior days, midnight-aligned.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);

  const signals = await db.engagementSignal.findMany({
    where: {
      sessionId,
      kind: { in: ENGAGEMENT_KINDS },
      createdAt: { gte: start },
    },
    select: { userId: true, kind: true, createdAt: true },
  });

  // Per-day, per-user: track what they did. "Fully engaged" = at least one
  // PRE_CASE_COMPLETED on that day. "Partial" = any other signal. "Logged-in
  // only" cannot be derived from the engagement table alone — left at 0.
  const buckets: Record<string, { engaged: Set<string>; partial: Set<string> }> = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    buckets[dayKey(d)] = { engaged: new Set(), partial: new Set() };
  }
  for (const s of signals) {
    const k = dayKey(s.createdAt);
    const b = buckets[k];
    if (!b) continue;
    if (s.kind === EngagementSignalKind.PRE_CASE_COMPLETED) {
      b.engaged.add(s.userId);
      b.partial.delete(s.userId); // engaged supersedes partial
    } else if (!b.engaged.has(s.userId)) {
      b.partial.add(s.userId);
    }
  }

  return Object.entries(buckets)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, b]) => {
      const d = new Date(date);
      return {
        date,
        weekday: WEEKDAYS[d.getDay()],
        engaged: b.engaged.size,
        partial: b.partial.size,
        loggedInOnly: 0,
      };
    });
}

export default async function ReadinessPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?next=/teacher/readiness/${sessionId}`);
  if (!FACULTY_LIKE.includes(session.user.role)) redirect('/dashboard');

  const sessionRow = await db.teachingSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      title: true,
      scheduledStart: true,
      status: true,
      deletedAt: true,
    },
  });
  if (!sessionRow || sessionRow.deletedAt) notFound();

  let snapshot;
  try {
    snapshot = await computeSessionReadiness(
      { userId: session.user.id, role: session.user.role },
      sessionId,
    );
  } catch (err) {
    if (err instanceof ReadinessAccessError && err.code === 'FORBIDDEN') {
      redirect('/dashboard');
    }
    throw err;
  }

  const daily = await buildDailyTimeline(sessionId);

  // eslint-disable-next-line react-hooks/purity -- async Server Component, single server-side render — deterministic wall-clock read
  const nowMs = Date.now();
  const daysUntil = sessionRow.scheduledStart
    ? Math.max(
        0,
        Math.ceil((sessionRow.scheduledStart.getTime() - nowMs) / 86_400_000),
      )
    : null;

  return (
    <ReadinessDashboardClient
      session={{
        id: sessionRow.id,
        title: sessionRow.title,
        scheduledStart: sessionRow.scheduledStart?.toISOString() ?? null,
        status: sessionRow.status,
        daysUntil,
      }}
      snapshot={snapshot}
      daily={daily}
    />
  );
}
