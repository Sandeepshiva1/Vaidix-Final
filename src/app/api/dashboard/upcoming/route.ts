// ════════════════════════════════════════════════════════════════════════════
// GET /api/dashboard/upcoming
// ════════════════════════════════════════════════════════════════════════════
// Returns the current user's next scheduled sessions in a Training[] shape
// suited to the dashboard's UpcomingCalendar widget.

import { jsonOk, requireAuthWithProgram, handleUnexpected } from '@/server/services/api-helpers';
import { db } from '@/lib/db';
import { SessionStatus, SessionType } from '@prisma/client';
import { buildApprovalGate, buildSessionVisibilityWhere } from '@/server/services/sessions/visibility';

interface UpcomingTraining {
  id: string;
  title: string;
  day: string;
  time: string;
  startsAt: string; // ISO — used for client-side countdown
  faculty: string;
  type: string;
  isLive: boolean;
  accent: string;
}

const TYPE_LABEL: Record<SessionType, string> = {
  LECTURE: 'Lecture',
  GRAND_ROUNDS: 'Grand Rounds',
  CASE_CONFERENCE: 'Case Disc.',
  JOURNAL_CLUB: 'Journal Club',
  SKILLS_WORKSHOP: 'Skills Lab',
  ASSESSMENT: 'Assessment',
};

const TYPE_ACCENT: Record<SessionType, string> = {
  LECTURE: 'blue',
  GRAND_ROUNDS: 'teal',
  CASE_CONFERENCE: 'purple',
  JOURNAL_CLUB: 'blue',
  SKILLS_WORKSHOP: 'amber',
  ASSESSMENT: 'rose',
};

function formatDay(start: Date, now: Date): string {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((startDay.getTime() - today.getTime()) / (24 * 3600 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tmrw';
  return start.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export async function GET() {
  try {
    // W6.11 — dashboard upcoming is tenant-scoped.
    const gate = await requireAuthWithProgram();
    if (!gate.ok) return gate.response;
    const { user } = gate;

    const now = new Date();
    const horizon = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    const visibility = await buildSessionVisibilityWhere({
      userId: user.id,
      role: user.role,
      activeProgramId: user.activeProgramId,
    });
    const approvalGate = buildApprovalGate({
      userId: user.id,
      role: user.role,
      activeProgramId: user.activeProgramId,
    });

    const sessions = await db.teachingSession.findMany({
      where: {
        programId: user.activeProgramId,
        deletedAt: null,
        scheduledEnd: { gt: now },
        scheduledStart: { lt: horizon },
        status: { in: [SessionStatus.SCHEDULED, SessionStatus.LIVE] },
        AND: [approvalGate, visibility],
      },
      include: { host: { select: { id: true, name: true } } },
      orderBy: { scheduledStart: 'asc' },
      take: 8,
    });

    const trainings: UpcomingTraining[] = sessions.map((s) => ({
      id: s.id,
      title: s.title,
      day: formatDay(s.scheduledStart, now),
      time: formatTime(s.scheduledStart),
      startsAt: s.scheduledStart.toISOString(),
      faculty: s.host?.name ?? 'TBA',
      type: TYPE_LABEL[s.sessionType] ?? s.sessionType,
      isLive: s.status === SessionStatus.LIVE,
      accent: TYPE_ACCENT[s.sessionType] ?? 'blue',
    }));

    return jsonOk({ trainings });
  } catch (err) {
    return handleUnexpected(err);
  }
}
