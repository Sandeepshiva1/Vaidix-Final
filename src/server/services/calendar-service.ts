// ════════════════════════════════════════════════════════════════════════════
// Calendar Service — SERVER-ONLY
// ════════════════════════════════════════════════════════════════════════════
// Role-scoped calendar event feed + recurrence expansion.

import { RRule, rrulestr } from 'rrule';
import { db } from '@/lib/db';
import { buildApprovalGate, buildSessionVisibilityWhere } from './sessions/visibility';
import {
  SessionApprovalStatus,
  SessionStatus,
  Role,
  type TeachingSession,
} from '@prisma/client';

export interface CalendarEvent {
  id: string;                  // session id (or `${sessionId}@${iso}` for recurrence occurrence)
  sessionId: string;
  title: string;
  start: string;               // ISO
  end: string;                 // ISO
  status: SessionStatus;
  approvalStatus: SessionApprovalStatus;
  openToAll: boolean;
  sessionType: string;
  host: { id: string; name: string; role: string } | null;
  isRecurring: boolean;
  isOccurrence: boolean;       // true when expanded from an RRULE
  cohortId: string | null;
  cohortName: string | null;
}

// ----------------------------------------------------------------------------
// Visibility filter. Returns a Prisma `where` clause describing sessions the
// given user may see on their calendar for the given date range.
//
// Visibility rules live in `sessions/visibility.ts` so the same logic is
// applied to the classroom feed, calendar, and per-session detail pages.
// ADMIN / PD bypass approvalStatus too (they need to see drafts/pending in
// the calendar to approve them); other roles see APPROVED only.
// ----------------------------------------------------------------------------
async function buildVisibilityWhere(userId: string, role: Role, from: Date, to: Date, activeProgramId?: string) {
  const visibility = await buildSessionVisibilityWhere({ userId, role, activeProgramId });
  const approvalGate = buildApprovalGate({ userId, role });

  // Compose under `AND` so the two independent OR-clauses (time-window vs.
  // visibility) don't collide on a shared top-level `OR` key.
  return {
    // narrow to the actor's active program. Defensive when missing.
    ...(activeProgramId ? { programId: activeProgramId } : {}),
    deletedAt: null,
    scheduledStart: { lt: to },
    AND: [
      approvalGate,
      // Single sessions must overlap [from, to]; recurring masters may start
      // earlier but still have occurrences in-window (filtered in JS below).
      { OR: [{ scheduledEnd: { gt: from } }, { recurrenceRule: { not: null } }] },
      visibility,
    ],
  };
}

// ----------------------------------------------------------------------------
// Expand recurring sessions into individual occurrences within [from, to].
// ----------------------------------------------------------------------------
function expandOccurrences(
  session: Pick<
    TeachingSession,
    'id' | 'title' | 'sessionType' | 'scheduledStart' | 'scheduledEnd' | 'recurrenceRule' | 'recurrenceUntil' | 'status' | 'approvalStatus' | 'openToAll' | 'cohortId'
  > & { host: { id: string; name: string; role: string } | null; cohortName: string | null },
  from: Date,
  to: Date
): CalendarEvent[] {
  const durationMs = session.scheduledEnd.getTime() - session.scheduledStart.getTime();

  if (!session.recurrenceRule) {
    // Single event — only include if it intersects the window
    if (session.scheduledEnd <= from || session.scheduledStart >= to) return [];
    return [
      {
        id: session.id,
        sessionId: session.id,
        title: session.title,
        start: session.scheduledStart.toISOString(),
        end: session.scheduledEnd.toISOString(),
        status: session.status,
        approvalStatus: session.approvalStatus,
        openToAll: session.openToAll,
        sessionType: session.sessionType,
        host: session.host,
        isRecurring: false,
        isOccurrence: false,
        cohortId: session.cohortId,
        cohortName: session.cohortName,
      },
    ];
  }

  let rule: RRule;
  try {
    const full = `DTSTART:${formatICalDate(session.scheduledStart)}\nRRULE:${session.recurrenceRule}`;
    rule = rrulestr(full, { forceset: false }) as RRule;
  } catch {
    return [];
  }

  const windowEnd = session.recurrenceUntil
    ? new Date(Math.min(to.getTime(), session.recurrenceUntil.getTime()))
    : to;

  const occurrences = rule.between(from, windowEnd, true);
  return occurrences.map((occStart) => {
    const occEnd = new Date(occStart.getTime() + durationMs);
    return {
      id: `${session.id}@${occStart.toISOString()}`,
      sessionId: session.id,
      title: session.title,
      start: occStart.toISOString(),
      end: occEnd.toISOString(),
      status: session.status,
      approvalStatus: session.approvalStatus,
      openToAll: session.openToAll,
      sessionType: session.sessionType,
      host: session.host,
      isRecurring: true,
      isOccurrence: true,
      cohortId: session.cohortId,
      cohortName: session.cohortName,
    };
  });
}

function formatICalDate(d: Date): string {
  // RRULE DTSTART format: YYYYMMDDTHHMMSSZ
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

// ----------------------------------------------------------------------------
// Public: list events for user in range, with recurrence expansion applied.
//
// Hosts are resolved via a separate batched query rather than a Prisma include.
// The TeachingSession.host relation is required at the schema level, but
// orphaned FKs (e.g. a host that was hard-deleted) make `findMany` throw:
//   "Field host is required to return data, got `null` instead."
// Looking the host up separately lets the calendar degrade gracefully —
// orphaned sessions still appear, just with no host name.
// ----------------------------------------------------------------------------
export async function listCalendarEvents(
  userId: string,
  role: Role,
  from: Date,
  to: Date,
  activeProgramId?: string,
): Promise<CalendarEvent[]> {
  const where = await buildVisibilityWhere(userId, role, from, to, activeProgramId);
  const sessions = await db.teachingSession.findMany({
    where,
    select: {
      id: true,
      title: true,
      sessionType: true,
      scheduledStart: true,
      scheduledEnd: true,
      recurrenceRule: true,
      recurrenceUntil: true,
      status: true,
      approvalStatus: true,
      openToAll: true,
      cohortId: true,
      hostId: true,
    },
    orderBy: { scheduledStart: 'asc' },
  });

  const hostIds = Array.from(new Set(sessions.map((s) => s.hostId)));
  const cohortIds = Array.from(new Set(sessions.map((s) => s.cohortId).filter((id): id is string => !!id)));

  const [hosts, cohorts] = await Promise.all([
    hostIds.length
      ? db.user.findMany({
          where: { id: { in: hostIds } },
          select: { id: true, name: true, role: true },
        })
      : [],
    cohortIds.length
      ? db.cohort.findMany({
          where: { id: { in: cohortIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);

  const hostById = new Map(hosts.map((h) => [h.id, h]));
  const cohortById = new Map(cohorts.map((c) => [c.id, c]));

  return sessions.flatMap((s) =>
    expandOccurrences(
      {
        ...s,
        host: hostById.get(s.hostId) ?? null,
        cohortName: s.cohortId ? (cohortById.get(s.cohortId)?.name ?? null) : null,
      },
      from,
      to
    )
  );
}
